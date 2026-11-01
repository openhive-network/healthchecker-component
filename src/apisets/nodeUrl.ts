/**
 * One spelling per node: lower-case scheme and host (as `URL` parses them), no default port, no
 * trailing slash and no fragment. `undefined` for anything that is not an http(s) URL.
 */
export const normalizeNodeUrl = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  parsed.hash = "";
  const { href, pathname, search } = parsed;
  return `${href.slice(0, href.length - pathname.length - search.length)}${pathname.replace(/\/+$/, "")}${search}`;
};

/** {@link normalizeNodeUrl}, or `url` itself when it is not a node URL (so it matches no node). */
export const canonicalNodeUrl = (url: string) => normalizeNodeUrl(url) ?? url;
