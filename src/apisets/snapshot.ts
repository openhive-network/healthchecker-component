import type { ApiSetSnapshot, NodeSnapshot, NodeState } from "./types";

const NODE_STATES: readonly NodeState[] = ["eligible", "unsupported", "down", "unknown"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isMs = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const optional = <T>(value: unknown, is: (value: unknown) => value is T): value is T | undefined => value === undefined || is(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isLatencies = (value: unknown): value is number[] => Array.isArray(value) && value.every(isMs);
const isLag = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const readNode = (value: unknown): NodeSnapshot | undefined => {
  if (!isRecord(value)) return undefined;
  const { state, reason, features, invalidData, latencies, checkLatencies, successes, failures, freshnessLag, lastProbeAt, nextProbeInMs } = value;
  const valid =
    NODE_STATES.includes(state as NodeState) &&
    optional(reason, isString) &&
    optional(features, isStrings) &&
    optional(invalidData, isString) &&
    isLatencies(latencies) &&
    isLatencies(checkLatencies) &&
    isCount(successes) &&
    isCount(failures) &&
    optional(freshnessLag, isLag) &&
    optional(lastProbeAt, isMs) &&
    isMs(nextProbeInMs);
  if (!valid) return undefined;
  return {
    state: state as NodeState,
    reason,
    features,
    invalidData,
    latencies,
    checkLatencies,
    successes,
    failures,
    freshnessLag,
    lastProbeAt,
    nextProbeInMs,
  };
};

/**
 * Reads an {@link ApiSetSnapshot} that crossed a process boundary (e.g. JSON in a server-rendered page).
 * Returns `undefined` for another version or shape; drops malformed node entries.
 */
export const readSnapshot = (value: unknown): ApiSetSnapshot | undefined => {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.sets)) return undefined;
  const sets: ApiSetSnapshot["sets"] = {};
  for (const [setId, set] of Object.entries(value.sets)) {
    if (!isRecord(set) || !isRecord(set.nodes) || !optional(set.default, isString)) continue;
    const nodes: Record<string, NodeSnapshot> = {};
    for (const [node, entry] of Object.entries(set.nodes)) {
      const read = readNode(entry);
      if (read) nodes[node] = read;
    }
    sets[setId] = { default: set.default, nodes };
  }
  return { v: 1, sets };
};
