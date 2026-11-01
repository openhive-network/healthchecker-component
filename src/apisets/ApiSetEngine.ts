import { HealthChecker, TScoredEndpoint, WaxHealthCheckerError, WaxHealthCheckerValidatorFailedError } from "@hiveio/wax";
import { Availability, Candidate, chooseDefaults, compareCandidates } from "./defaults";
import { canonicalNodeUrl, normalizeNodeUrl } from "./nodeUrl";
import { parseSelection, serializeSelection } from "./selection";
import { readSnapshot } from "./snapshot";
import { NodeStats } from "./stats";
import { memoryStorage, SelectionStorage } from "./storage";
import { ApiTransport, fetchTransport, TransportError } from "./transport";
import type {
  ApiSet,
  ApiSetEngineEvents,
  ApiSetEngineOptions,
  ApiSetSnapshot,
  EngineTiming,
  GroupStatus,
  NodeRanking,
  NodeSnapshot,
  NodeState,
  ReportOutcome,
} from "./types";

const DEFAULT_TIMING: EngineTiming = {
  probeTimeoutMs: 5_000,
  eligibleRecheckMs: 10 * 60_000,
  downCooldownMs: 30_000,
  unsupportedTtlMs: 6 * 60 * 60_000,
  freshnessIntervalMs: 60_000,
  tickMs: 15_000,
  snapshotMaxAgeMs: 30 * 60_000,
};
// An error rate from fewer outcomes than this says nothing yet.
const MIN_OUTCOMES_FOR_ERROR_RATE = 4;

interface NodeEntry {
  state: NodeState;
  reason?: string;
  features?: string[];
  invalidData?: string;
  /** Counts state changes, so a probe that started before one drops its answer. */
  generation: number;
  probing: boolean;
  nextProbeAt: number;
  lastProbeAt?: number;
  freshnessLag?: number;
  freshnessCheckedAt?: number;
  stats: NodeStats;
}

// The transport of a `forRequest` engine: it must never fetch, least of all a cookie's custom node.
const noProbeTransport: ApiTransport = {
  jsonRpc: async (node) => {
    throw new TransportError(`${node}: a per-request engine does not probe`);
  },
  restGet: async (node) => {
    throw new TransportError(`${node}: a per-request engine does not probe`);
  },
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Decides, per API set, which nodes serve it, which one to use and how they rank. Framework-free: it
 * touches no `window` (storage goes through the injected adapter) and runs in Node and the browser.
 * Active probing and wax health checks run between `start()` and `stop()`; `refresh()` runs one round.
 */
export class ApiSetEngine extends EventTarget {
  private readonly options: ApiSetEngineOptions;
  private readonly catalog: string[];
  private readonly setsById: Map<string, ApiSet>;
  private readonly tiers: Map<string, Map<string, number>>;
  private readonly transport: ApiTransport;
  private readonly storage: SelectionStorage;
  private readonly createHealthChecker: () => HealthChecker;
  private readonly now: () => number;
  private readonly timing: EngineTiming;
  private readonly stickinessMargin: number;
  private readonly downAfterFailures: number;
  private readonly maxErrorRate: number;

  private customNodes: string[] = [];
  private choices = new Map<string, string>();
  private entries = new Map<string, Map<string, NodeEntry>>();
  private defaults = new Map<string, string | undefined>();
  private active = new Map<string, string | undefined>();
  private groupStatuses = new Map<string, GroupStatus>();
  private fallbacks = new Set<string>();
  private checkers = new Map<string, { checker: HealthChecker; nodes: string }>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing?: Promise<void>;

  constructor(options: ApiSetEngineOptions) {
    super();
    this.options = options;
    this.catalog = [
      ...new Set(
        options.nodes.map((node) => {
          const url = normalizeNodeUrl(node);
          if (!url) throw new TypeError(`Not an http(s) node URL: ${node}`);
          return url;
        }),
      ),
    ];
    this.setsById = new Map(options.sets.map((set) => [set.id, set]));
    this.tiers = new Map(
      options.sets.map((set) => {
        const order = options.preferences?.[set.id] ?? this.catalog;
        const ranks = order.map((rank) => (Array.isArray(rank) ? rank : [rank]).map(canonicalNodeUrl));
        return [set.id, new Map(ranks.flatMap((rank, tier) => rank.map((node) => [node, tier])))];
      }),
    );
    this.transport = options.transport ?? fetchTransport;
    this.storage = options.storage ?? memoryStorage();
    this.createHealthChecker = options.createHealthChecker ?? (() => new HealthChecker());
    this.now = options.now ?? Date.now;
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.stickinessMargin = options.stickinessMargin ?? 0.2;
    this.downAfterFailures = options.downAfterFailures ?? 3;
    this.maxErrorRate = options.maxErrorRate ?? 0.5;
    for (const set of options.sets) this.entries.set(set.id, new Map());
    for (const node of this.catalog) this.track(node);
    const saved = this.storage.load();
    if (!saved || !this.restore(saved)) this.recompute();
  }

  /**
   * A fresh engine for one server-side request: `shared`'s options and node health (its
   * {@link snapshot}), and the user's `cookieState` ({@link serialize}d), kept in memory. It never probes:
   * its transport refuses every call, so a cookie's custom node is never fetched by the server. Such a
   * node has no health in `shared`'s snapshot, so a choice of it uses `auto` until a browser engine probes
   * it. `shared` is the process's long-lived engine probing the operator catalog only; never `hydrate` a
   * cookie into it or add a cookie's node to it.
   */
  static forRequest(shared: ApiSetEngine, cookieState?: string): ApiSetEngine {
    const engine = new ApiSetEngine({ ...shared.options, transport: noProbeTransport, storage: memoryStorage() });
    if (cookieState !== undefined) engine.hydrate(cookieState);
    engine.hydrateSnapshot(shared.snapshot());
    return engine;
  }

  // Events

  /** Subscribes to an engine event; returns the unsubscribe function. */
  on<K extends keyof ApiSetEngineEvents>(type: K, listener: (detail: ApiSetEngineEvents[K]) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<ApiSetEngineEvents[K]>).detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  private emit<K extends keyof ApiSetEngineEvents>(type: K, detail: ApiSetEngineEvents[K]) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Queries

  sets(): ApiSet[] {
    return [...this.setsById.values()];
  }

  nodes(): string[] {
    return [...this.catalog, ...this.customNodes];
  }

  /** The node to send the set's calls to: the user's choice while usable, else the auto default. */
  bestNode(setId: string): string | undefined {
    return this.active.get(setId);
  }

  /** `bestNode` first, then the set's other eligible nodes by rank: the order to fail over in. */
  fallbackOrder(setId: string): string[] {
    const eligible = this.rankings(setId).filter((r) => r.state === "eligible").map((r) => r.node);
    const best = this.bestNode(setId);
    return best ? [best, ...eligible.filter((node) => node !== best)] : eligible;
  }

  /** Every known node for the set, best first. */
  rankings(setId: string): NodeRanking[] {
    const entries = this.entries.get(setId);
    if (!entries) return [];
    return this.candidates(setId).sort(compareCandidates).map(({ node, availability }) => {
      const entry = entries.get(node)!;
      return {
        node,
        state: entry.state,
        reason: entry.reason ?? entry.invalidData,
        features: entry.features,
        degraded: availability === Availability.Degraded,
        medianLatencyMs: entry.stats.median(),
        p95LatencyMs: entry.stats.p95(),
        errorRate: entry.stats.errorRate(),
        freshnessLag: entry.freshnessLag,
        lastProbeAt: entry.lastProbeAt,
        isDefault: this.defaults.get(setId) === node,
        isSelected: this.choices.get(setId) === node,
        isActive: this.active.get(setId) === node,
        isCustom: this.customNodes.includes(node),
      };
    });
  }

  /** The user's choice for the set, or `"auto"`. */
  selection(setId: string): string {
    return this.choices.get(setId) ?? "auto";
  }

  groups(): GroupStatus[] {
    return [...this.groupStatuses.values()];
  }

  // User choice

  /** Chooses `node` for the set, or `"auto"`. Refused (false) unless the node is eligible for the set. */
  select(setId: string, node: string | "auto"): boolean {
    if (!this.setsById.has(setId)) return false;
    if (node === "auto") {
      this.choices.delete(setId);
    } else {
      const url = canonicalNodeUrl(node);
      if (this.entries.get(setId)?.get(url)?.state !== "eligible") return false;
      this.choices.set(setId, url);
    }
    this.persist();
    this.recompute();
    return true;
  }

  /**
   * Chooses `node` for every set it is eligible for, and `auto` for the other sets. Returns the ids of
   * the sets that use it; nothing changes (and none are returned) for a node the engine does not know.
   */
  selectEverywhere(node: string): string[] {
    const url = canonicalNodeUrl(node);
    if (!this.nodes().includes(url)) return [];
    const applied: string[] = [];
    for (const { id } of this.sets()) {
      if (this.entries.get(id)?.get(url)?.state === "eligible") {
        this.choices.set(id, url);
        applied.push(id);
      } else {
        this.choices.delete(id);
      }
    }
    this.persist();
    this.recompute();
    return applied;
  }

  /** Adds a user node; while started, it is probed at once. It is offered for a set once found eligible. */
  addNode(node: string): boolean {
    const url = normalizeNodeUrl(node);
    if (!url || this.nodes().includes(url)) return false;
    this.customNodes = [...this.customNodes, url];
    this.track(url);
    this.persist();
    this.recompute();
    if (this.timer) void this.probeNode(url);
    return true;
  }

  /** Removes a user node, and any choice of it. Catalog nodes cannot be removed. */
  removeNode(node: string): boolean {
    const url = canonicalNodeUrl(node);
    if (!this.customNodes.includes(url)) return false;
    this.customNodes = this.customNodes.filter((custom) => custom !== url);
    for (const entries of this.entries.values()) entries.delete(url);
    for (const [setId, chosen] of this.choices) if (chosen === url) this.choices.delete(setId);
    this.persist();
    this.syncChecks();
    this.recompute();
    return true;
  }

  // Serialization

  /** The user's choices and nodes as a compact, cookie-safe string. */
  serialize(): string {
    return serializeSelection({ choices: this.choices, customNodes: this.customNodes }, this.catalog);
  }

  /**
   * Replaces the user's choices and nodes with a {@link serialize}d state, e.g. from a cookie during SSR,
   * and saves it to the engine's storage. A restored choice is used once its node is eligible for the set
   * (probed, or eligible in a {@link hydrateSnapshot}); until then the set uses the auto default.
   * Returns false for an unreadable state.
   */
  hydrate(state: string): boolean {
    if (!this.restore(state)) return false;
    this.persist();
    return true;
  }

  private restore(state: string): boolean {
    const parsed = parseSelection(state, this.catalog, new Set(this.setsById.keys()));
    if (!parsed) return false;
    for (const node of this.customNodes) if (!parsed.customNodes.includes(node)) for (const e of this.entries.values()) e.delete(node);
    this.customNodes = parsed.customNodes;
    for (const node of this.customNodes) this.track(node);
    this.choices = parsed.choices;
    this.syncChecks();
    this.recompute();
    return true;
  }

  /**
   * The engine's view of node health: per set, each node's state, features and samples, and the current
   * default. JSON-safe; pass it with {@link serialize}'s state from a server render to the browser's
   * engine ({@link hydrateSnapshot}) so both pick the same nodes before the browser probes anything.
   */
  snapshot(): ApiSetSnapshot {
    const now = this.now();
    const sets: ApiSetSnapshot["sets"] = {};
    for (const [setId, entries] of this.entries) {
      const nodes: Record<string, NodeSnapshot> = {};
      for (const [node, entry] of entries) {
        nodes[node] = {
          state: entry.state,
          reason: entry.reason,
          features: entry.features,
          invalidData: entry.invalidData,
          ...entry.stats.snapshot(),
          freshnessLag: entry.freshnessLag,
          lastProbeAt: entry.lastProbeAt,
          nextProbeInMs: Math.max(0, entry.nextProbeAt - now),
        };
      }
      sets[setId] = { default: this.defaults.get(setId), nodes };
    }
    return { v: 1, createdAt: now, sets };
  }

  /**
   * Takes over a {@link snapshot} (e.g. a server engine's, read from the page), for the sets and nodes
   * this engine knows; restore the user's custom nodes with {@link hydrate} first. Nodes are probed again
   * when the snapshot says they are due, at the latest when this engine's timing for their state says so,
   * counted from the snapshot's creation. Returns false (and takes nothing) for an unreadable snapshot, or
   * one older than `timing.snapshotMaxAgeMs`.
   */
  hydrateSnapshot(snapshot: unknown): boolean {
    const parsed = readSnapshot(snapshot);
    if (!parsed) return false;
    const now = this.now();
    // A snapshot "from the future" is clock skew between server and browser, not a reason to trust it longer.
    const age = Math.max(0, now - parsed.createdAt);
    if (age > this.timing.snapshotMaxAgeMs) return false;
    for (const [setId, { default: defaultNode, nodes }] of Object.entries(parsed.sets)) {
      const entries = this.entries.get(setId);
      if (!entries) continue;
      for (const [node, saved] of Object.entries(nodes)) {
        const entry = entries.get(canonicalNodeUrl(node));
        if (!entry) continue;
        entry.state = saved.state;
        entry.reason = saved.reason;
        entry.features = saved.features;
        entry.invalidData = saved.invalidData;
        entry.stats.restore(saved);
        entry.freshnessLag = saved.freshnessLag;
        entry.freshnessCheckedAt = saved.freshnessLag === undefined ? undefined : now - age;
        entry.lastProbeAt = saved.lastProbeAt;
        entry.nextProbeAt = now + Math.max(0, Math.min(saved.nextProbeInMs, this.recheckMs(saved.state)) - age);
        entry.generation += 1;
      }
      const url = defaultNode === undefined ? undefined : canonicalNodeUrl(defaultNode);
      if (url && entries.has(url)) this.defaults.set(setId, url);
    }
    this.syncChecks();
    this.recompute();
    return true;
  }

  // Evidence

  /** Feeds the result of a real call to `node` for the set. Ignored (false) for unknown sets or nodes. */
  report(setId: string, node: string, outcome: ReportOutcome): boolean {
    const entry = this.entries.get(setId)?.get(canonicalNodeUrl(node));
    if (!entry) return false;
    if (outcome.latencyMs !== undefined) entry.stats.addLatency(outcome.latencyMs);
    entry.stats.addOutcome(outcome.ok);
    if (outcome.ok) {
      entry.stats.consecutiveTransportFailures = 0;
      entry.invalidData = undefined;
      if (entry.state !== "eligible") this.setState(entry, "eligible", undefined, this.timing.eligibleRecheckMs);
    } else if (outcome.error === "apiNotFound") {
      this.setState(entry, "unsupported", outcome.message ?? "API not found", this.timing.unsupportedTtlMs);
    } else if (outcome.error === "transport") {
      this.transportFailure(entry, outcome.message ?? "transport error");
    } else {
      entry.invalidData = outcome.message ?? "invalid answer";
    }
    this.syncChecks();
    this.recompute();
    return true;
  }

  // Lifecycle

  /** Probes now, then keeps probing what is due and runs the sets' wax checks until `stop()`. */
  start(): Promise<void> {
    if (!this.timer) {
      this.timer = setInterval(() => void this.refresh(), this.timing.tickMs);
      (this.timer as { unref?: () => void }).unref?.();
    }
    return this.refresh();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const { checker } of this.checkers.values()) checker.unregisterAll();
    this.checkers.clear();
  }

  /** One round: the due probes and freshness probes, all in parallel. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRound().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async runRound() {
    const now = this.now();
    const work: Promise<void>[] = [];
    for (const set of this.setsById.values()) {
      for (const [node, entry] of this.entries.get(set.id)!) {
        if (entry.probing) continue;
        if (entry.nextProbeAt <= now) work.push(this.probe(set, node, entry));
        else if (set.freshness && entry.state === "eligible" && (entry.freshnessCheckedAt ?? -Infinity) + this.timing.freshnessIntervalMs <= now)
          work.push(this.probeFreshness(set, node, entry));
      }
    }
    await Promise.all(work);
    this.syncChecks();
    this.recompute();
  }

  /** Probes a node for every set at once, outside the rounds. */
  private async probeNode(node: string) {
    await Promise.all(
      this.sets().flatMap((set) => {
        const entry = this.entries.get(set.id)!.get(node);
        return entry && !entry.probing ? [this.probe(set, node, entry)] : [];
      }),
    );
    this.syncChecks();
    this.recompute();
  }

  private async probe(set: ApiSet, node: string, entry: NodeEntry) {
    const context = { node, transport: this.transport, timeoutMs: this.timing.probeTimeoutMs };
    const generation = entry.generation;
    let answer: { state: NodeState; reason?: string; features?: string[] };
    entry.probing = true;
    try {
      const result = await set.probe(context);
      answer = result.supported ? { state: "eligible", features: result.features } : { state: "unsupported", reason: result.reason };
    } catch (error) {
      // A probe that cannot answer says nothing about support: the node is down for the set.
      answer = { state: "down", reason: errorMessage(error) };
    } finally {
      entry.probing = false;
    }
    // A report (or snapshot) changed the node's state while the probe ran: its evidence is newer.
    if (entry.generation !== generation) return;
    switch (answer.state) {
      case "eligible":
        entry.features = answer.features;
        entry.stats.consecutiveTransportFailures = 0;
        this.setState(entry, "eligible", undefined, this.timing.eligibleRecheckMs);
        break;
      case "unsupported":
        entry.features = undefined;
        this.setState(entry, "unsupported", answer.reason, this.timing.unsupportedTtlMs);
        break;
      default:
        this.setState(entry, "down", answer.reason, this.timing.downCooldownMs);
    }
    entry.lastProbeAt = this.now();
    if (set.freshness && entry.state === "eligible") await this.probeFreshness(set, node, entry);
  }

  private async probeFreshness(set: ApiSet, node: string, entry: NodeEntry) {
    try {
      entry.freshnessLag = await set.freshness!.lag({ node, transport: this.transport, timeoutMs: this.timing.probeTimeoutMs });
    } catch (error) {
      entry.freshnessLag = undefined;
      entry.reason = `freshness unknown: ${errorMessage(error)}`;
    }
    entry.freshnessCheckedAt = this.now();
  }

  /** The longest a node in `state` waits for its next probe. */
  private recheckMs(state: NodeState): number {
    switch (state) {
      case "eligible":
        return this.timing.eligibleRecheckMs;
      case "unsupported":
        return this.timing.unsupportedTtlMs;
      case "down":
        return this.timing.downCooldownMs;
      case "unknown":
        return 0;
    }
  }

  private setState(entry: NodeEntry, state: NodeState, reason: string | undefined, recheckMs: number) {
    entry.state = state;
    entry.reason = reason;
    entry.nextProbeAt = this.now() + recheckMs;
    entry.generation += 1;
  }

  private transportFailure(entry: NodeEntry, reason: string) {
    entry.stats.consecutiveTransportFailures += 1;
    if (entry.state !== "unsupported" && entry.stats.consecutiveTransportFailures >= this.downAfterFailures)
      this.setState(entry, "down", reason, this.timing.downCooldownMs);
  }

  private track(node: string) {
    for (const entries of this.entries.values())
      if (!entries.has(node)) entries.set(node, { state: "unknown", generation: 0, probing: false, nextProbeAt: 0, stats: new NodeStats() });
  }

  private persist() {
    this.storage.save(this.serialize());
  }

  // wax checks

  /** Points each set's wax HealthChecker at the set's current eligible nodes (while started). */
  private syncChecks() {
    if (!this.timer) return;
    for (const set of this.setsById.values()) {
      if (!set.checks?.length) continue;
      const eligible = [...this.entries.get(set.id)!].filter(([, e]) => e.state === "eligible").map(([node]) => node);
      const key = eligible.join(" ");
      let entry = this.checkers.get(set.id);
      if (entry?.nodes === key) continue;
      if (!entry) {
        entry = { checker: this.createHealthChecker(), nodes: "" };
        this.listen(set.id, entry.checker);
        this.checkers.set(set.id, entry);
      }
      entry.checker.unregisterAll();
      entry.nodes = key;
      if (eligible.length)
        for (const check of set.checks) entry.checker.register(check.method, check.params, check.validatorFunction, eligible);
    }
  }

  /**
   * wax runs a round of checks, emits `validationerror` and then `error` for each check whose answer
   * its validator rejected, `error` alone for each check that got no answer, then `data` with every
   * endpoint's scores over its recent rounds.
   */
  private listen(setId: string, checker: HealthChecker) {
    const entryOf = (node: string) => this.entries.get(setId)?.get(node);
    // Per round: the endpoints that failed a check, and the validator failures whose `error` is to come.
    const failed = new Set<string>();
    const invalid = new Map<string, number>();
    checker.on("validationerror", (error: WaxHealthCheckerValidatorFailedError) => {
      const node = canonicalNodeUrl(error.request.endpoint);
      const entry = entryOf(node);
      if (!entry) return;
      failed.add(node);
      invalid.set(node, (invalid.get(node) ?? 0) + 1);
      entry.stats.addOutcome(false);
      entry.invalidData = error.message;
      this.recompute();
    });
    checker.on("error", (error: WaxHealthCheckerError) => {
      if (!error.apiUrl) return;
      const node = canonicalNodeUrl(error.apiUrl);
      failed.add(node);
      const pending = invalid.get(node) ?? 0;
      if (pending) {
        invalid.set(node, pending - 1);
        return;
      }
      const entry = entryOf(node);
      if (!entry) return;
      entry.stats.addOutcome(false);
      this.transportFailure(entry, error.message);
      this.syncChecks();
      this.recompute();
    });
    checker.on("data", (endpoints: TScoredEndpoint[]) => {
      for (const endpoint of endpoints) {
        const node = canonicalNodeUrl(endpoint.endpointUrl);
        const entry = entryOf(node);
        if (!entry || !endpoint.up) continue;
        entry.stats.setCheckLatencies(endpoint.latencies);
        // `up` covers wax's whole window; only a node that passed this round's checks has a new success.
        if (failed.has(node)) continue;
        entry.stats.addOutcome(true);
        entry.stats.consecutiveTransportFailures = 0;
        entry.invalidData = undefined;
      }
      failed.clear();
      invalid.clear();
      this.recompute();
    });
  }

  // Defaults

  private availability(set: ApiSet, node: string, entry: NodeEntry): Availability {
    switch (entry.state) {
      case "unsupported":
        return Availability.Unsupported;
      case "down":
        return Availability.Down;
      case "unknown":
        return this.catalog.includes(node) ? Availability.UnknownCatalog : Availability.UnknownCustom;
      case "eligible": {
        const errorRate = entry.stats.sampleCount >= MIN_OUTCOMES_FOR_ERROR_RATE ? entry.stats.errorRate() ?? 0 : 0;
        const lagging = set.freshness !== undefined && entry.freshnessLag !== undefined && entry.freshnessLag > set.freshness.maxLag;
        return errorRate > this.maxErrorRate || lagging || entry.invalidData !== undefined ? Availability.Degraded : Availability.Healthy;
      }
    }
  }

  private candidates(setId: string): Candidate[] {
    const set = this.setsById.get(setId)!;
    const tiers = this.tiers.get(setId)!;
    return [...this.entries.get(setId)!].map(([node, entry]) => ({
      node,
      availability: this.availability(set, node, entry),
      tier: tiers.get(node) ?? tiers.size,
      latency: entry.stats.median() ?? Infinity,
    }));
  }

  private recompute() {
    const sets = this.sets();
    const { defaults, groups } = chooseDefaults(
      sets.map((set) => ({ id: set.id, group: set.group, candidates: this.candidates(set.id) })),
      this.defaults,
      this.stickinessMargin,
    );
    this.defaults = defaults;

    for (const set of sets) {
      const chosen = this.choices.get(set.id);
      const chosenEntry = chosen ? this.entries.get(set.id)?.get(chosen) : undefined;
      // A choice not yet probed (e.g. restored from a cookie anyone can write) waits for its probe.
      const usable = chosenEntry?.state === "eligible";
      const unusable = chosenEntry?.state === "down" || chosenEntry?.state === "unsupported";
      const node = usable ? chosen : defaults.get(set.id);
      if (chosen && unusable && !this.fallbacks.has(set.id)) {
        this.fallbacks.add(set.id);
        this.emit("selectionfallback", { setId: set.id, selected: chosen, node, reason: chosenEntry!.reason });
      } else if ((!chosen || usable) && this.fallbacks.delete(set.id) && chosen) {
        this.emit("selectionrestored", { setId: set.id, node: chosen });
      }
      const previous = this.active.get(set.id);
      this.active.set(set.id, node);
      if (previous !== node) this.emit("nodechange", { setId: set.id, node, previous });
    }

    for (const [group, { sets: members, split }] of groups) {
      const status: GroupStatus = {
        group,
        sets: members,
        split,
        nodesBySet: Object.fromEntries(members.map((id) => [id, defaults.get(id)])),
      };
      const before = this.groupStatuses.get(group);
      this.groupStatuses.set(group, status);
      if (JSON.stringify(before) !== JSON.stringify(status)) this.emit("groupchange", status);
    }
    this.emit("change", undefined);
  }
}
