const parseHttpUrl = (url: string): URL | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
};

/**
 * One spelling per node: lower-case scheme and host (as `URL` parses them), no default port, no
 * trailing slash, no empty query and no fragment. `undefined` for anything that is not an http(s) URL,
 * and for a URL with user info (`user:pass@`), which would end up in cookies and rankings.
 */
export const normalizeNodeUrl = (url: string): string | undefined => {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.username || parsed.password) return undefined;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
};

// Unparseable input has no reliable authority, so everything up to the last `@` may be user info.
const redactUserInfo = (url: string) => url.replace(/^((?:[^:/?#@]*:)?\/\/)?.*@/s, "$1***@");

/**
 * {@link normalizeNodeUrl} for operator configuration: throws a TypeError naming why `url` is not a
 * node URL. The message never repeats the user info, which may be a password.
 */
export const requireNodeUrl = (url: string): string => {
  const normalized = normalizeNodeUrl(url);
  if (normalized) return normalized;
  const parsed = parseHttpUrl(url);
  if (parsed) {
    parsed.username = "";
    parsed.password = "";
    throw new TypeError(`Node URLs must not contain user info: ${parsed.href}`);
  }
  throw new TypeError(`Not an http(s) node URL: ${redactUserInfo(url)}`);
};

/** {@link normalizeNodeUrl}, or `url` itself when it is not a node URL (so it matches no node). */
export const canonicalNodeUrl = (url: string) => normalizeNodeUrl(url) ?? url;
