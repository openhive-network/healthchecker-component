// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ApiSetEngine,
  jsonRpcMethodProbe,
  jsonRpcNamespaceProbe,
  localStorageAdapter,
  memoryStorage,
  restProbe,
  TransportError,
} from "../src";
import type { ApiSet, ApiSetEngineEvents, ApiSetEngineOptions, ApiTransport, NodeRanking } from "../src";
import { HIVE, liteInfo, liteNotFound, methods, OPENHIVE, stubTransport, SYNCAD } from "./stubTransport";
import type { StubNode } from "./stubTransport";

const wax = vi.hoisted(() => {
  type Listener = (payload: unknown) => void;

  class FakeHealthChecker {
    static instances: FakeHealthChecker[] = [];
    private listeners = new Map<string, Listener[]>();
    registrations: string[][] = [];

    constructor() {
      FakeHealthChecker.instances.push(this);
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    emit(event: string, payload: unknown) {
      this.listeners.get(event)?.forEach((listener) => listener(payload));
    }

    register(_method: unknown, _params: unknown, _validator: unknown, nodes: string[]) {
      this.registrations.push(nodes);
      return { id: this.registrations.length };
    }

    unregisterAll() {
      this.registrations = [];
    }
  }

  return { FakeHealthChecker };
});

vi.mock("@hiveio/wax", () => ({ HealthChecker: wax.FakeHealthChecker }));

type LiteInfo = { methods: string[]; apps: { social: boolean } };

const bridge: ApiSet = { id: "bridge", title: "Bridge", probe: jsonRpcNamespaceProbe("bridge"), group: "hivemind" };
const lite: ApiSet = {
  id: "lite",
  title: "Lite accounts",
  probe: jsonRpcMethodProbe<LiteInfo>("lite.get_info", {}, (info) => [...info.methods, ...(info.apps.social ? ["social"] : [])]),
  group: "hivemind",
};

const hiveBlog = (): StubNode => ({ rpc: { "jsonrpc.get_methods": methods("bridge.get_post", "database_api.find_accounts"), "lite.get_info": liteNotFound } });
const syncad = (): StubNode => ({ rpc: { "jsonrpc.get_methods": methods("bridge.get_post", "bridge.get_ranked_posts", "lite.get_info"), "lite.get_info": liteInfo } });

const setup = (overrides: Partial<ApiSetEngineOptions> & { stubs?: Record<string, StubNode> } = {}) => {
  const clock = { now: 1_000_000 };
  const stubs = overrides.stubs ?? { [HIVE]: hiveBlog(), [SYNCAD]: syncad() };
  const { transport, calls } = stubTransport(stubs);
  const engine = new ApiSetEngine({
    nodes: [HIVE, SYNCAD],
    sets: [bridge, lite],
    transport,
    now: () => clock.now,
    ...overrides,
  });
  return { engine, clock, calls, stubs };
};

const states = (rankings: NodeRanking[]) => Object.fromEntries(rankings.map((r) => [r.node, r.state]));

const record = <K extends keyof ApiSetEngineEvents>(engine: ApiSetEngine, type: K) => {
  const events: ApiSetEngineEvents[K][] = [];
  engine.on(type, (detail) => events.push(detail));
  return events;
};

describe("ApiSetEngine", () => {
  it("routes lite to the node that serves it and bridge by operator preference, reporting the split group", async () => {
    const { engine } = setup();
    const groupEvents = record(engine, "groupchange");

    // Before any probe the operator's first choice stands in, so an SSR render and the browser agree.
    expect(engine.bestNode("lite")).toBe(HIVE);
    await engine.refresh();

    expect(states(engine.rankings("lite"))).toEqual({ [HIVE]: "unsupported", [SYNCAD]: "eligible" });
    expect(engine.rankings("lite")[1].reason).toContain("Could not find API lite");
    expect(engine.rankings("lite")[0]).toMatchObject({ node: SYNCAD, features: ["get_posts", "get_account", "social"], isDefault: true });
    expect(engine.bestNode("lite")).toBe(SYNCAD);
    expect(engine.bestNode("bridge")).toBe(HIVE);
    expect(engine.fallbackOrder("bridge")).toEqual([HIVE, SYNCAD]);
    expect(engine.fallbackOrder("lite")).toEqual([SYNCAD]);
    expect(engine.groups()).toEqual([
      { group: "hivemind", sets: ["bridge", "lite"], split: true, nodesBySet: { bridge: HIVE, lite: SYNCAD } },
    ]);
    expect(groupEvents[groupEvents.length - 1]?.split).toBe(true);
  });

  it("accepts a choice only among the set's eligible nodes and keeps it across serialize/hydrate", async () => {
    const storage = memoryStorage();
    const { engine } = setup({ storage });
    await engine.refresh();

    expect(engine.select("lite", HIVE)).toBe(false);
    expect(engine.select("lite", "https://unknown.example.com")).toBe(false);
    expect(engine.select("nope", SYNCAD)).toBe(false);
    expect(engine.selection("lite")).toBe("auto");

    expect(engine.select("bridge", SYNCAD)).toBe(true);
    expect(engine.bestNode("bridge")).toBe(SYNCAD);
    expect(engine.rankings("bridge").find((r) => r.node === SYNCAD)).toMatchObject({ isSelected: true, isActive: true, isDefault: false });

    const state = engine.serialize();
    expect(state).toBe("v=1&s.bridge=1");
    expect(storage.load()).toBe(state);

    // A fresh engine (an SSR render reading the cookie) honours the choice before probing anything.
    const { engine: ssr } = setup();
    expect(ssr.hydrate(state)).toBe(true);
    expect(ssr.selection("bridge")).toBe(SYNCAD);
    expect(ssr.bestNode("bridge")).toBe(SYNCAD);
    // And one constructed on the same storage restores it too.
    expect(setup({ storage }).engine.selection("bridge")).toBe(SYNCAD);

    expect(engine.select("bridge", "auto")).toBe(true);
    expect(engine.bestNode("bridge")).toBe(HIVE);
    expect(engine.serialize()).toBe("v=1");
  });

  it("drops unreadable or unknown hydrated state", () => {
    const { engine } = setup();
    expect(engine.hydrate("v=9&s.bridge=1")).toBe(false);
    expect(engine.hydrate(`v=1&s.bridge=7&s.ghost=0&s.lite=${encodeURIComponent("https://not.added.example")}&c=javascript:alert(1)`)).toBe(true);
    expect(engine.selection("bridge")).toBe("auto");
    expect(engine.selection("lite")).toBe("auto");
    expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
  });

  describe("eligibility", () => {
    it("marks a node down on a transport failure, retries it only after the cooldown, then finds it eligible", async () => {
      const stubs = { [HIVE]: { rpc: { "jsonrpc.get_methods": new TransportError("connect ECONNREFUSED") } } as StubNode, [SYNCAD]: syncad() };
      const { engine, clock, calls } = setup({ stubs, sets: [bridge], timing: { downCooldownMs: 30_000 } });
      await engine.refresh();
      expect(engine.rankings("bridge").find((r) => r.node === HIVE)).toMatchObject({ state: "down", reason: "connect ECONNREFUSED" });
      expect(engine.bestNode("bridge")).toBe(SYNCAD);

      stubs[HIVE] = hiveBlog();
      clock.now += 10_000;
      await engine.refresh();
      expect(calls.filter((c) => c.startsWith(HIVE))).toHaveLength(1);

      clock.now += 20_000;
      await engine.refresh();
      expect(states(engine.rankings("bridge"))[HIVE]).toBe("eligible");
      expect(engine.bestNode("bridge")).toBe(HIVE);
    });

    it("trusts an unsupported answer until its TTL, then probes again", async () => {
      const { engine, clock, calls } = setup({ sets: [lite], timing: { unsupportedTtlMs: 3_600_000, eligibleRecheckMs: 7_200_000 } });
      await engine.refresh();
      clock.now += 3_000_000;
      await engine.refresh();
      expect(calls.filter((c) => c === `${HIVE} lite.get_info`)).toHaveLength(1);
      clock.now += 600_000;
      await engine.refresh();
      expect(calls.filter((c) => c === `${HIVE} lite.get_info`)).toHaveLength(2);
      expect(calls.filter((c) => c === `${SYNCAD} lite.get_info`)).toHaveLength(1);
    });

    it("learns from reported calls: API not found is unsupported at once, transport errors add up to down", async () => {
      const { engine } = setup({ sets: [bridge], downAfterFailures: 3 });
      await engine.refresh();

      expect(engine.report("bridge", SYNCAD, { ok: false, error: "apiNotFound", message: "Could not find API bridge" })).toBe(true);
      expect(engine.rankings("bridge").find((r) => r.node === SYNCAD)).toMatchObject({ state: "unsupported", reason: "Could not find API bridge" });

      engine.report("bridge", HIVE, { ok: false, error: "transport" });
      engine.report("bridge", HIVE, { ok: false, error: "transport" });
      expect(states(engine.rankings("bridge"))[HIVE]).toBe("eligible");
      engine.report("bridge", HIVE, { ok: false, error: "transport", message: "timeout" });
      expect(engine.rankings("bridge").find((r) => r.node === HIVE)).toMatchObject({ state: "down", reason: "timeout" });
      expect(engine.bestNode("bridge")).toBeUndefined();

      engine.report("bridge", HIVE, { ok: true, latencyMs: 120 });
      expect(engine.rankings("bridge").find((r) => r.node === HIVE)).toMatchObject({ state: "eligible", medianLatencyMs: 120 });
      expect(engine.report("bridge", OPENHIVE, { ok: true })).toBe(false);
    });
  });

  describe("probes", () => {
    const rest = (answer: StubNode["rest"]) => stubTransport({ [HIVE]: { rest: answer } }).transport;
    const probe = (transport: ApiTransport) => restProbe("/balance-api/")({ node: HIVE, transport, timeoutMs: 1000 });

    it("reads REST support from the HTTP answer", async () => {
      await expect(probe(rest({ "/balance-api/": { status: 200, body: {} } }))).resolves.toEqual({ supported: true, features: undefined });
      await expect(probe(rest({ "/balance-api/": { status: 404, body: "" } }))).resolves.toMatchObject({ supported: false });
      await expect(probe(rest({ "/balance-api/": { status: 400, body: { code: "PGRST202" } } }))).resolves.toMatchObject({ supported: false });
      await expect(probe(rest({ "/balance-api/": { status: 403, body: "" } }))).rejects.toThrow("HTTP 403");
    });

    it("treats a JSON-RPC error other than API-not-found as a failed probe", async () => {
      const { transport } = stubTransport({ [HIVE]: { rpc: { "lite.get_info": { error: { code: -32000, message: "internal" } } } } });
      await expect(lite.probe({ node: HIVE, transport, timeoutMs: 1000 })).rejects.toThrow("lite.get_info: internal");
    });
  });

  describe("default node", () => {
    const sameRank = { bridge: [[HIVE, SYNCAD]] };

    const reportLatency = (engine: ApiSetEngine, node: string, latencyMs: number, times = 5) => {
      for (let i = 0; i < times; i++) engine.report("bridge", node, { ok: true, latencyMs });
    };

    it("follows the operator's order over latency", async () => {
      const { engine } = setup({ sets: [bridge], preferences: { bridge: [SYNCAD, HIVE] } });
      await engine.refresh();
      reportLatency(engine, HIVE, 50);
      reportLatency(engine, SYNCAD, 400);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
    });

    it("breaks ties within a rank by latency and sticks to the current node within the margin", async () => {
      const { engine } = setup({ sets: [bridge], preferences: sameRank, stickinessMargin: 0.2 });
      await engine.refresh();
      reportLatency(engine, HIVE, 200);
      reportLatency(engine, SYNCAD, 100);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);

      reportLatency(engine, HIVE, 90, 20);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      reportLatency(engine, HIVE, 60, 30);
      expect(engine.bestNode("bridge")).toBe(HIVE);
    });

    it("ranks a node lagging beyond the freshness threshold as degraded", async () => {
      const lag: Record<string, number> = { [HIVE]: 500, [SYNCAD]: 2 };
      const fresh: ApiSet = { ...bridge, freshness: { lag: async ({ node }) => lag[node], maxLag: 20 } };
      const { engine } = setup({ sets: [fresh] });
      await engine.refresh();
      expect(engine.rankings("bridge").map((r) => [r.node, r.degraded, r.freshnessLag])).toEqual([
        [SYNCAD, false, 2],
        [HIVE, true, 500],
      ]);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
    });

    it("gives a soft group one node when it is among every set's best", async () => {
      const { engine } = setup({ preferences: { bridge: [[HIVE, SYNCAD]], lite: [SYNCAD, HIVE] } });
      await engine.refresh();
      reportLatency(engine, HIVE, 50);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      expect(engine.groups()[0]).toMatchObject({ split: false, nodesBySet: { bridge: SYNCAD, lite: SYNCAD } });
    });

    it("chooses the same defaults from the same evidence", async () => {
      const run = async () => {
        const { engine } = setup({ preferences: sameRank });
        await engine.refresh();
        return engine.sets().map((set) => engine.fallbackOrder(set.id));
      };
      expect(await run()).toEqual(await run());
    });
  });

  describe("user choice", () => {
    it("falls back to auto while the chosen node is down and returns to it on recovery", async () => {
      const { engine } = setup({ sets: [bridge], downAfterFailures: 1 });
      const fallbacks = record(engine, "selectionfallback");
      const restored = record(engine, "selectionrestored");
      await engine.refresh();
      engine.select("bridge", SYNCAD);

      engine.report("bridge", SYNCAD, { ok: false, error: "transport", message: "timeout" });
      expect(engine.selection("bridge")).toBe(SYNCAD);
      expect(engine.bestNode("bridge")).toBe(HIVE);
      expect(fallbacks).toEqual([{ setId: "bridge", selected: SYNCAD, node: HIVE, reason: "timeout" }]);

      engine.report("bridge", SYNCAD, { ok: true, latencyMs: 80 });
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      expect(restored).toEqual([{ setId: "bridge", node: SYNCAD }]);
    });

    it("uses one node for every set it serves and leaves the others alone", async () => {
      const { engine } = setup();
      await engine.refresh();
      expect(engine.selectEverywhere(HIVE)).toEqual(["bridge"]);
      expect(engine.selection("bridge")).toBe(HIVE);
      expect(engine.selection("lite")).toBe("auto");
    });

    it("offers a user-added node only after probing it", async () => {
      const stubs = { [HIVE]: hiveBlog(), [SYNCAD]: syncad(), [OPENHIVE]: syncad() };
      const { engine } = setup({ stubs });
      expect(engine.addNode("not a url")).toBe(false);
      expect(engine.addNode(HIVE)).toBe(false);
      expect(engine.addNode(OPENHIVE)).toBe(true);
      expect(engine.select("lite", OPENHIVE)).toBe(false);

      await engine.refresh();
      expect(engine.rankings("lite").find((r) => r.node === OPENHIVE)).toMatchObject({ state: "eligible", isCustom: true });
      expect(engine.select("lite", OPENHIVE)).toBe(true);
      const state = engine.serialize();
      expect(new URLSearchParams(state).getAll("c")).toEqual([OPENHIVE]);

      const { engine: restored } = setup({ stubs });
      restored.hydrate(state);
      expect(restored.bestNode("lite")).toBe(OPENHIVE);

      expect(engine.removeNode(SYNCAD)).toBe(false);
      expect(engine.removeNode(OPENHIVE)).toBe(true);
      expect(engine.selection("lite")).toBe("auto");
      expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
    });
  });

  describe("headless", () => {
    it("constructs, starts and stops with no window", async () => {
      expect(typeof window).toBe("undefined");
      const { engine } = setup({ storage: localStorageAdapter("apiSets") });
      await engine.start();
      expect(engine.bestNode("lite")).toBe(SYNCAD);
      engine.stop();
    });

    it("runs the set's wax checks against its eligible nodes and counts their failures", async () => {
      wax.FakeHealthChecker.instances = [];
      const checked: ApiSet = { ...lite, checks: [{ title: "Info", method: {}, params: {}, validatorFunction: () => true }] };
      const { engine } = setup({ sets: [bridge, checked], downAfterFailures: 2 });
      await engine.start();

      const [checker] = wax.FakeHealthChecker.instances;
      expect(wax.FakeHealthChecker.instances).toHaveLength(1);
      expect(checker.registrations).toEqual([[SYNCAD]]);

      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100, 300] }]);
      expect(engine.rankings("lite")[0]).toMatchObject({ medianLatencyMs: 100, p95LatencyMs: 300, errorRate: 0 });

      checker.emit("error", { apiUrl: SYNCAD, message: "timeout" });
      checker.emit("error", { apiUrl: SYNCAD, message: "timeout" });
      expect(states(engine.rankings("lite"))[SYNCAD]).toBe("down");
      expect(checker.registrations).toEqual([]);
      engine.stop();
    });
  });
});
