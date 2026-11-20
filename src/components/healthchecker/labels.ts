/** The text of the custom-node form. */
export interface ProviderAdditionLabels {
  addNodeTitle: string;
  addNodeHint: string;
  addNodePlaceholder: string;
  addNodeButton: string;
  addNodeInvalidUrl: string;
}

/**
 * The text `ApiSetsComponent` renders. A value in `{{name}}` is filled in by the component; each template
 * documents its placeholders. Every key is optional in the `labels` prop: a missing one keeps the English.
 */
export interface ApiSetsLabels extends ProviderAdditionLabels {
  heading: string;
  automaticChoice: string;
  /** `{{node}}`: the node the user chose for the set. */
  yourChoiceOf: string;
  useAutomaticChoice: string;
  /** `{{selected}}`: the chosen node; `{{set}}`: the set's title; `{{node}}`: the node used meanwhile, or `noNode`. */
  fallbackNotice: string;
  noNode: string;
  /** `{{sets}}`: the group's sets, joined by `listSeparator`; `{{nodes}}`: one `groupSplitSet` per set, joined likewise. */
  groupSplit: string;
  /** `{{set}}`: a set of the group; `{{node}}`: its node, or `noNode`. */
  groupSplitSet: string;
  listSeparator: string;
  stateEligible: string;
  stateUnsupported: string;
  stateDown: string;
  stateUnknown: string;
  stateDegraded: string;
  defaultBadge: string;
  yourChoiceBadge: string;
  inUse: string;
  /** `{{value}}`: a duration (`milliseconds`) or `noValue`; likewise `p95`. */
  median: string;
  p95: string;
  /** `{{value}}`: a whole number of percent. */
  errors: string;
  /** `{{value}}`: the freshness lag. */
  lag: string;
  /** `{{value}}`: a whole number of milliseconds. */
  milliseconds: string;
  noValue: string;
  use: string;
  useEverywhere: string;
  /** `{{node}}`: the custom node; the accessible name of its remove button. */
  removeNode: string;
}

export const DEFAULT_PROVIDER_ADDITION_LABELS: ProviderAdditionLabels = {
  addNodeTitle: "Add Custom Node:",
  addNodeHint: "Enter a custom Hive node URL.",
  addNodePlaceholder: "(e.g., https://example.com)",
  addNodeButton: "Add",
  addNodeInvalidUrl: "Please enter a valid URL (must start with http:// or https://)",
};

export const DEFAULT_API_SETS_LABELS: ApiSetsLabels = {
  ...DEFAULT_PROVIDER_ADDITION_LABELS,
  heading: "API servers by API set",
  automaticChoice: "Automatic choice",
  yourChoiceOf: "Your choice: {{node}}",
  useAutomaticChoice: "Use automatic choice",
  fallbackNotice: "{{selected}} is unavailable for {{set}}; using {{node}} until it recovers.",
  noNode: "no node",
  groupSplit: "No single node serves all of {{sets}}: {{nodes}}.",
  groupSplitSet: "{{set}} uses {{node}}",
  listSeparator: ", ",
  stateEligible: "eligible",
  stateUnsupported: "unsupported",
  stateDown: "down",
  stateUnknown: "unknown",
  stateDegraded: "degraded",
  defaultBadge: "Default",
  yourChoiceBadge: "Your choice",
  inUse: "In use",
  median: "Median: {{value}}",
  p95: "p95: {{value}}",
  errors: "Errors: {{value}}%",
  lag: "Lag: {{value}}",
  milliseconds: "{{value}} ms",
  noValue: "–",
  use: "Use",
  useEverywhere: "Use for everything it serves",
  removeNode: "Remove {{node}}",
};

/** `template` with each `{{name}}` replaced by `values[name]`; a placeholder without a value is kept as is. */
export const formatLabel = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder,
  );
