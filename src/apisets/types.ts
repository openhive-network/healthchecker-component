import type { HealthChecker } from "@hiveio/wax";
import type { ApiChecker } from "../components/healthchecker/HealthCheckerService";
import type { ApiProbe, ProbeContext } from "./probes";
import type { StatsSnapshot } from "./stats";
import type { SelectionStorage } from "./storage";
import type { ApiTransport } from "./transport";

export type NodeState = "eligible" | "unsupported" | "down" | "unknown";

/** How far a node's data lags behind (e.g. blocks behind the chain head). Above `maxLag` it ranks degraded. */
export interface FreshnessProbe {
  lag: (context: ProbeContext) => Promise<number>;
  maxLag: number;
}

/** A family of APIs an app sends to one node, e.g. `bridge`, `lite` or a REST API. */
export interface ApiSet {
  id: string;
  title: string;
  /** Whether a node serves the set at all (see `jsonRpcNamespaceProbe`, `jsonRpcMethodProbe`, `restProbe`). */
  probe: ApiProbe;
  /** Health and latency checks, run by wax's HealthChecker against the set's eligible nodes. */
  checks?: ApiChecker[];
  /** Sets sharing a group prefer one common node. */
  group?: string;
  freshness?: FreshnessProbe;
}

/** Node URLs, best first; an inner array is one rank of equally preferred nodes. */
export type PreferenceOrder = Array<string | string[]>;

/** The result of a real call the app made, fed back with `ApiSetEngine.report`. */
export type ReportOutcome =
  | { ok: true; latencyMs?: number }
  | { ok: false; error: "apiNotFound" | "transport" | "invalid"; message?: string; latencyMs?: number };

export interface NodeRanking {
  node: string;
  state: NodeState;
  reason?: string;
  features?: string[];
  /** Eligible, but failing too many calls, its last checked answer rejected, or lagging beyond the set's freshness threshold. */
  degraded: boolean;
  medianLatencyMs?: number;
  p95LatencyMs?: number;
  errorRate?: number;
  freshnessLag?: number;
  lastProbeAt?: number;
  /** The node the engine picks for the set on its own (`auto`). */
  isDefault: boolean;
  /** The node the user chose for the set, whether or not it is usable right now. */
  isSelected: boolean;
  /** The node `bestNode` returns. */
  isActive: boolean;
  isCustom: boolean;
}

/** One node's health for one set, as `ApiSetEngine.snapshot` records it. */
export interface NodeSnapshot extends StatsSnapshot {
  state: NodeState;
  reason?: string;
  features?: string[];
  /** Why the node's last checked answer was rejected; the node ranks degraded until a check passes. */
  invalidData?: string;
  freshnessLag?: number;
  lastProbeAt?: number;
  /** How long after the snapshot the node is due to be probed again; capped by the engine's timing for its state. */
  nextProbeInMs: number;
}

/** An engine's view of node health (not the user's choices: see `ApiSetEngine.serialize`), as JSON. */
export interface ApiSetSnapshot {
  v: 1;
  /** When it was taken (the taking engine's `now()`), so a cached copy can be aged or ignored. */
  createdAt: number;
  sets: Record<string, { default?: string; nodes: Record<string, NodeSnapshot> }>;
}

export interface GroupStatus {
  group: string;
  sets: string[];
  /** No single node is the default of every set in the group. */
  split: boolean;
  nodesBySet: Record<string, string | undefined>;
}

export interface EngineTiming {
  probeTimeoutMs: number;
  /** How often an eligible node is probed again. */
  eligibleRecheckMs: number;
  /** How long a `down` node waits before it is probed again. */
  downCooldownMs: number;
  /** How long an `unsupported` answer is trusted. */
  unsupportedTtlMs: number;
  freshnessIntervalMs: number;
  /** How often `start()` looks for due probes. */
  tickMs: number;
  /** A `hydrateSnapshot` snapshot older than this (e.g. from a CDN-cached page) is ignored. */
  snapshotMaxAgeMs: number;
}

export interface ApiSetEngineOptions {
  /** The operator's node catalog. */
  nodes: string[];
  sets: ApiSet[];
  /** Per set id; a set without one prefers the catalog order. */
  preferences?: Record<string, PreferenceOrder>;
  transport?: ApiTransport;
  /** Where the selection is loaded from on construction and saved to; in memory by default. */
  storage?: SelectionStorage;
  /** Creates the wax HealthChecker that runs a set's `checks`. */
  createHealthChecker?: () => HealthChecker;
  now?: () => number;
  timing?: Partial<EngineTiming>;
  /** A candidate replaces the current default only when this much faster (0.2 = 20%). */
  stickinessMargin?: number;
  /** Consecutive transport failures that make an eligible node `down`. */
  downAfterFailures?: number;
  /** Error rate above which an eligible node ranks degraded. */
  maxErrorRate?: number;
}

export interface ApiSetEngineEvents {
  /** Any state change: rankings, defaults, selection or groups. */
  change: undefined;
  /** `bestNode(setId)` changed. */
  nodechange: { setId: string; node?: string; previous?: string };
  /** The user's choice became unusable; `node` is the auto default used meanwhile. */
  selectionfallback: { setId: string; selected: string; node?: string; reason?: string };
  /** The user's choice is usable again and back in use. */
  selectionrestored: { setId: string; node: string };
  /** A soft group's status changed (e.g. it was split). */
  groupchange: GroupStatus;
}
