/** The user's part of an engine's state: per-set node choices and the nodes they added. */
export interface SelectionState {
  choices: Map<string, string>;
  customNodes: string[];
}

const VERSION = "1";
const SET_PREFIX = "s.";

export const isNodeUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * A compact, cookie-safe form (URL query encoding: no `;`, `,`, quotes or whitespace). Catalog nodes
 * are written as their catalog index, other nodes as their URL.
 */
export const serializeSelection = ({ choices, customNodes }: SelectionState, catalog: readonly string[]) => {
  const params = new URLSearchParams({ v: VERSION });
  for (const node of customNodes) params.append("c", node);
  for (const [setId, node] of choices) {
    const index = catalog.indexOf(node);
    params.set(`${SET_PREFIX}${setId}`, index >= 0 ? String(index) : node);
  }
  return params.toString();
};

/**
 * Reads {@link serializeSelection}'s form. Returns `undefined` for another version; drops custom nodes
 * that are not http(s) URLs and choices of sets or nodes the engine does not know.
 */
export const parseSelection = (
  text: string,
  catalog: readonly string[],
  setIds: ReadonlySet<string>,
): SelectionState | undefined => {
  const params = new URLSearchParams(text);
  if (params.get("v") !== VERSION) return undefined;
  const customNodes = [...new Set(params.getAll("c"))].filter((node) => isNodeUrl(node) && !catalog.includes(node));
  const choices = new Map<string, string>();
  for (const [key, value] of params) {
    const setId = key.slice(SET_PREFIX.length);
    if (!key.startsWith(SET_PREFIX) || !setIds.has(setId)) continue;
    const node = /^\d+$/.test(value) ? catalog[Number(value)] : value;
    if (node && (catalog.includes(node) || customNodes.includes(node))) choices.set(setId, node);
  }
  return { choices, customNodes };
};
