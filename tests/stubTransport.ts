import { TransportError } from "../src";
import type { ApiTransport, JsonRpcResponse, RestResponse } from "../src";

type Answer<T> = T | TransportError;

export interface StubNode {
  rpc?: Record<string, Answer<JsonRpcResponse>>;
  rest?: Record<string, Answer<RestResponse>>;
}

/** A transport answering from `nodes` (mutable, so a test can change a node's answers); counts calls. */
export const stubTransport = (nodes: Record<string, StubNode>) => {
  const calls: string[] = [];
  const answer = <T>(node: string, key: string, value: Answer<T> | undefined): T => {
    calls.push(`${node} ${key}`);
    if (value instanceof TransportError) throw value;
    if (value === undefined) throw new TransportError(`${node}: no stubbed answer for ${key}`);
    return value;
  };
  const transport: ApiTransport = {
    jsonRpc: async (node, method) => answer(node, method, nodes[node]?.rpc?.[method]),
    restGet: async (node, path) => answer(node, path, nodes[node]?.rest?.[path]),
  };
  return { transport, calls };
};

export const HIVE = "https://api.hive.blog";
export const SYNCAD = "https://api.syncad.com";
export const OPENHIVE = "https://api.openhive.network";

export const methods = (...names: string[]): JsonRpcResponse => ({ result: names });
export const liteNotFound: JsonRpcResponse = {
  error: { code: -32003, message: "Assert Exception:api_itr != data._registered_apis.end(): Could not find API lite" },
};
export const liteInfo: JsonRpcResponse = { result: { methods: ["get_posts", "get_account"], apps: { social: true } } };
