/** Where an engine keeps its serialized selection state (see `ApiSetEngine.serialize`). */
export interface SelectionStorage {
  load(): string | null;
  save(state: string): void;
}

/** Keeps the state in memory only; the engine's default. */
export const memoryStorage = (initial: string | null = null): SelectionStorage => {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
};

/**
 * Keeps the state in `window.localStorage` under `key`. Touches `window` only when called, and reads
 * nothing where there is no `localStorage` (Node SSR).
 */
export const localStorageAdapter = (key: string): SelectionStorage => {
  const storage = () => (typeof window === "undefined" ? undefined : window.localStorage);
  return {
    load: () => storage()?.getItem(key) ?? null,
    save: (state) => storage()?.setItem(key, state),
  };
};
