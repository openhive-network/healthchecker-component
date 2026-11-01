export interface JsonRpcError {
  code: number;
  message: string;
}

export type JsonRpcResponse = { result: unknown; error?: undefined } | { error: JsonRpcError; result?: undefined };

export interface RestResponse {
  status: number;
  body: unknown;
}

/**
 * How probes reach a node. Implementations throw {@link TransportError} when the node could not be
 * reached or answered with something that is not an API answer (network failure, timeout, 5xx).
 */
export interface ApiTransport {
  jsonRpc(node: string, method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse>;
  restGet(node: string, path: string, timeoutMs: number): Promise<RestResponse>;
}

/** The node could not be reached, timed out or failed at the HTTP level. */
export class TransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TransportError";
  }
}

const API_NOT_FOUND = /could not find (api|method)|api not found|method not found|PGRST202/i;
const JSON_RPC_METHOD_NOT_FOUND = -32601;

/**
 * Whether an error (a JSON-RPC error object, a REST error body, an `Error` or a message) says the node
 * does not serve the API, as opposed to failing to answer.
 */
export const isApiNotFound = (error: unknown): boolean => {
  if (typeof error === "string") return API_NOT_FOUND.test(error);
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === JSON_RPC_METHOD_NOT_FOUND || code === "PGRST202") return true;
  return typeof message === "string" && API_NOT_FOUND.test(message);
};

const joinUrl = (node: string, path: string) => `${node.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new TransportError(`${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The default transport: `fetch`, available in browsers and Node 18+. */
export const fetchTransport: ApiTransport = {
  async jsonRpc(node, method, params, timeoutMs) {
    const response = await fetchWithTimeout(
      node,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      },
      timeoutMs,
    );
    if (!response.ok) throw new TransportError(`${node}: HTTP ${response.status}`, response.status);
    const body = await readBody(response);
    if (typeof body !== "object" || body === null || !("result" in body || "error" in body))
      throw new TransportError(`${node}: not a JSON-RPC answer`, response.status);
    return body as JsonRpcResponse;
  },
  async restGet(node, path, timeoutMs) {
    const response = await fetchWithTimeout(joinUrl(node, path), { method: "GET" }, timeoutMs);
    if (response.status >= 500) throw new TransportError(`${joinUrl(node, path)}: HTTP ${response.status}`, response.status);
    return { status: response.status, body: await readBody(response) };
  },
};
