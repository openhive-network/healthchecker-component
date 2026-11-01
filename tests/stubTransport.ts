import { TransportError } from "../src/engine";
import type { ApiTransport, JsonRpcResponse, RestResponse } from "../src/engine";
import hivedMethods from "./fixtures/hived.jsonrpc.get_methods.json";
import hivedNoApi from "./fixtures/hived-no-api.hivesense_api.json";
import missingPost from "./fixtures/missing-post.bridge.get_post.json";
import routerUnmapped from "./fixtures/router-unmapped.lite.get_info.json";
import syncadLite from "./fixtures/syncad.lite.get_info.json";

type Answer<T> = T | TransportError | Promise<T>;

export interface StubNode {
  rpc?: Record<string, Answer<JsonRpcResponse>>;
  rest?: Record<string, Answer<RestResponse>>;
}

/**
 * A transport answering from `nodes` (mutable, so a test can change a node's answers; a promise holds
 * the answer back until it settles); counts calls.
 */
export const stubTransport = (nodes: Record<string, StubNode>) => {
  const calls: string[] = [];
  const answer = async <T>(node: string, key: string, value: Answer<T> | undefined): Promise<T> => {
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

// Answers captured from the nodes on 2026-11-01, verbatim (tests/fixtures/).
/** `jsonrpc.get_methods` of api.hive.blog and api.syncad.com alike: hived's 171 methods, no bridge/lite. */
export const getMethods = hivedMethods as JsonRpcResponse;
/** `lite.get_info` where no backend serves lite (api.hive.blog, api.openhive.network): the router's answer. */
export const liteUnmapped = routerUnmapped as JsonRpcResponse;
/** `lite.get_info` on api.syncad.com. */
export const liteInfo = syncadLite as JsonRpcResponse;
/** `bridge.get_post` of a post that does not exist (`hc-probe/hc-probe`), on every node: hivemind's assert. */
export const bridgeMissingPost = missingPost as JsonRpcResponse;
/** `hivesense_api.list_posts` on api.hive.blog: hived's answer for an API it has no plugin for. */
export const hivesenseNotFound = hivedNoApi as JsonRpcResponse;

export const BRIDGE_PROBE = { method: "bridge.get_post", params: { author: "hc-probe", permlink: "hc-probe" } };

/** api.hive.blog / api.openhive.network: bridge, no lite. */
export const hiveBlog = (): StubNode => ({
  rpc: { "jsonrpc.get_methods": getMethods, "bridge.get_post": bridgeMissingPost, "lite.get_info": liteUnmapped },
});
/** api.syncad.com: bridge and lite. */
export const syncad = (): StubNode => ({
  rpc: { "jsonrpc.get_methods": getMethods, "bridge.get_post": bridgeMissingPost, "lite.get_info": liteInfo },
});
