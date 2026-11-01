/**
 * How usable a node is for a set, best first. Only the first three may become a default; an unknown
 * catalog node is the operator's guess before anything was probed (an SSR render), an unknown custom
 * node is not offered until probed.
 */
export enum Availability {
  Healthy,
  Degraded,
  UnknownCatalog,
  UnknownCustom,
  Down,
  Unsupported,
}

export interface Candidate {
  node: string;
  availability: Availability;
  /** Index of the node's operator preference rank; nodes outside the preference order rank last. */
  tier: number;
  /** Median latency in ms; `Infinity` when nothing was measured. */
  latency: number;
}

export interface SetCandidates {
  id: string;
  group?: string;
  candidates: Candidate[];
}

export interface DefaultsResult {
  defaults: Map<string, string | undefined>;
  groups: Map<string, { sets: string[]; split: boolean }>;
}

const byUrl = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// NaN (Infinity - Infinity) is falsy, so two unmeasured nodes fall through to the URL.
export const compareCandidates = (a: Candidate, b: Candidate) =>
  a.availability - b.availability || a.tier - b.tier || a.latency - b.latency || byUrl(a.node, b.node);

/** The usable candidates sharing the best availability and preference rank, fastest first. */
const topCandidates = (candidates: Candidate[]) => {
  const usable = candidates.filter((c) => c.availability <= Availability.UnknownCatalog).sort(compareCandidates);
  const [first] = usable;
  return first ? usable.filter((c) => c.availability === first.availability && c.tier === first.tier) : [];
};

/** The fastest of `top`, unless `previous` is among them and the fastest is not better by `margin`. */
const pickSticky = (top: Candidate[], previous: string | undefined, margin: number) => {
  const [best] = top;
  const kept = top.find((c) => c.node === previous);
  if (kept && kept !== best && !(best.latency < kept.latency * (1 - margin))) return kept.node;
  return best?.node;
};

/**
 * Each set's default node: the best available, highest-preference node, with latency deciding among
 * equal ranks. Sets sharing a `group` take one common node when one is among every set's top
 * candidates; otherwise each keeps its own and the group is reported split. Pure and deterministic:
 * the same candidates and previous defaults always give the same result.
 */
export const chooseDefaults = (
  sets: SetCandidates[],
  previous: ReadonlyMap<string, string | undefined>,
  margin: number,
): DefaultsResult => {
  const defaults = new Map<string, string | undefined>();
  const tops = new Map(sets.map((set) => [set.id, topCandidates(set.candidates)]));
  for (const set of sets) defaults.set(set.id, pickSticky(tops.get(set.id) ?? [], previous.get(set.id), margin));

  const groups = new Map<string, { sets: string[]; split: boolean }>();
  for (const set of sets) {
    if (set.group) groups.set(set.group, { sets: [...(groups.get(set.group)?.sets ?? []), set.id], split: false });
  }
  for (const [group, status] of groups) {
    const served = status.sets.filter((id) => tops.get(id)?.length);
    const common = served
      .map((id) => new Set(tops.get(id)!.map((c) => c.node)))
      .reduce<Set<string> | undefined>((acc, nodes) => (acc ? new Set([...acc].filter((n) => nodes.has(n))) : nodes), undefined);
    if (common?.size) {
      const shared = [...common]
        .map((node) => ({
          node,
          availability: Availability.Healthy,
          tier: 0,
          latency: served.reduce((sum, id) => sum + tops.get(id)!.find((c) => c.node === node)!.latency, 0),
        }))
        .sort(compareCandidates);
      const node = pickSticky(shared, previous.get(served[0]), margin);
      for (const id of served) defaults.set(id, node);
    }
    const nodes = new Set(served.map((id) => defaults.get(id)));
    groups.set(group, { ...status, split: nodes.size > 1 });
  }
  return { defaults, groups };
};
