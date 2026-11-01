/**
 * One spelling per node: lower-case scheme and host (as `URL` parses them), no default port, no
 * trailing slash, no empty query and no fragment. `undefined` for anything that is not an http(s) URL,
 * and for a URL with user info (`user:pass@`), which would end up in cookies and rankings.
 */
export const normalizeNodeUrl = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
};

/** {@link normalizeNodeUrl}, or `url` itself when it is not a node URL (so it matches no node). */
export const canonicalNodeUrl = (url: string) => normalizeNodeUrl(url) ?? url;
