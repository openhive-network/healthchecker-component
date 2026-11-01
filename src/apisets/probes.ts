import { ApiTransport, isApiNotFound } from "./transport";

export type ProbeResult = { supported: true; features?: string[] } | { supported: false; reason: string };

export interface ProbeContext {
  node: string;
  transport: ApiTransport;
  timeoutMs: number;
}

/**
 * Says whether a node serves an API set. Resolves `{ supported: false }` when the node answers that it
 * does not; rejects when it could not answer (the node is then `down` for the set, not `unsupported`).
 */
export type ApiProbe = (context: ProbeContext) => Promise<ProbeResult>;

/** The probe answered, but not in a way that tells whether the API is served. */
export class ProbeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeFailedError";
  }
}

/** Supported when `jsonrpc.get_methods` lists a method of `namespace`; the features are its method names. */
export const jsonRpcNamespaceProbe = (namespace: string): ApiProbe => async ({ node, transport, timeoutMs }) => {
  const response = await transport.jsonRpc(node, "jsonrpc.get_methods", {}, timeoutMs);
  if (response.error) throw new ProbeFailedError(`jsonrpc.get_methods: ${response.error.message}`);
  if (!Array.isArray(response.result)) throw new ProbeFailedError("jsonrpc.get_methods: not a method list");
  const prefix = `${namespace}.`;
  const features = response.result
    .filter((method): method is string => typeof method === "string" && method.startsWith(prefix))
    .map((method) => method.slice(prefix.length));
  return features.length ? { supported: true, features } : { supported: false, reason: `no ${namespace} methods` };
};

/**
 * Supported when `method` answers; unsupported when the node says the API or method does not exist.
 * `features` maps the answer to the features of the set the node serves.
 */
export const jsonRpcMethodProbe = <T = unknown>(
  method: string,
  params: unknown = {},
  features?: (result: T) => string[],
): ApiProbe => async ({ node, transport, timeoutMs }) => {
  const response = await transport.jsonRpc(node, method, params, timeoutMs);
  if (response.error) {
    if (isApiNotFound(response.error)) return { supported: false, reason: response.error.message };
    throw new ProbeFailedError(`${method}: ${response.error.message}`);
  }
  return { supported: true, features: features?.(response.result as T) };
};

/**
 * Supported when a GET of `path` (an API root or its OpenAPI spec) succeeds; unsupported on 404 or
 * PostgREST's PGRST202 (no such function).
 */
export const restProbe = <T = unknown>(path: string, features?: (body: T) => string[]): ApiProbe =>
  async ({ node, transport, timeoutMs }) => {
    const { status, body } = await transport.restGet(node, path, timeoutMs);
    if (status === 404 || isApiNotFound(body)) return { supported: false, reason: `${path}: HTTP ${status}` };
    if (status < 200 || status >= 300) throw new ProbeFailedError(`${path}: HTTP ${status}`);
    return { supported: true, features: features?.(body as T) };
  };
