import { ApiTransport, isApiNotFound, JsonRpcError, RestResponse, TransportError } from "./transport";

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

/**
 * The node's router has the API's route but nothing behind it (HTTP 502/503). The engine counts it as a
 * failed probe until it repeats `downAfterFailures` times on a node that serves another set, then as
 * unsupported (see `timing.noBackendRecheckMs`).
 */
export class NoBackendError extends ProbeFailedError {
  constructor(message: string) {
    super(message);
    this.name = "NoBackendError";
  }
}

const NO_BACKEND_STATUSES = [502, 503];

/**
 * Supported when `jsonrpc.get_methods` lists a method of `namespace`; the features are its method names.
 * Only for hived's own namespaces (`database_api`, `rc_api`, …): `get_methods` is answered by hived and
 * never lists the APIs other apps serve behind the node's router (`bridge`, `hive`, `lite`,
 * `hivesense_api`). Probe those with {@link jsonRpcApiProbe}.
 */
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
 * PostgREST's PGRST202 (no such function). Rejects with {@link NoBackendError} on HTTP 502/503.
 */
export const restProbe = <T = unknown>(path: string, features?: (body: T) => string[]): ApiProbe =>
  async ({ node, transport, timeoutMs }) => {
    let answer: RestResponse;
    try {
      answer = await transport.restGet(node, path, timeoutMs);
    } catch (error) {
      if (error instanceof TransportError && error.status !== undefined && NO_BACKEND_STATUSES.includes(error.status))
        throw new NoBackendError(`${path}: HTTP ${error.status}, no backend`);
      throw error;
    }
    const { status, body } = answer;
    if (NO_BACKEND_STATUSES.includes(status)) throw new NoBackendError(`${path}: HTTP ${status}, no backend`);
    if (status === 404 || isApiNotFound(body)) return { supported: false, reason: `${path}: HTTP ${status}` };
    if (status < 200 || status >= 300) throw new ProbeFailedError(`${path}: HTTP ${status}`);
    return { supported: true, features: features?.(body as T) };
  };

const JSON_RPC_INVALID_PARAMS = -32602;
// fc's exception names (`assert_exception`, …): hived's and hivemind's own errors, not a router's.
const API_EXCEPTION = /_exception$/;

/** An error raised by the API itself (bad arguments, a failed assert), which only a node serving it gives. */
const isApiError = ({ code, data }: JsonRpcError) => {
  const name = (data as { name?: unknown } | null | undefined)?.name;
  return code === JSON_RPC_INVALID_PARAMS || (typeof name === "string" && API_EXCEPTION.test(name));
};

/**
 * Supported when `method` answers with a result or the API's own error (bad arguments, `-32602`, or an
 * fc exception such as a failed assert: "Post … does not exist"); unsupported when the node says it does
 * not serve the API (see `isApiNotFound`). Any other error (e.g. a router's `-32603` "Internal Error")
 * fails the probe. So `method` should be cheap, e.g. `bridge.get_post` of a post that does not exist.
 */
export const jsonRpcApiProbe = (method: string, params: unknown = {}): ApiProbe => async ({ node, transport, timeoutMs }) => {
  const response = await transport.jsonRpc(node, method, params, timeoutMs);
  if (!response.error) return { supported: true };
  if (isApiNotFound(response.error)) return { supported: false, reason: response.error.message };
  if (isApiError(response.error)) return { supported: true };
  throw new ProbeFailedError(`${method}: ${response.error.message}`);
};
