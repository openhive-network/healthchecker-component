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
/**
 * `lite.get_info` where no backend serves lite (api.hive.blog, api.openhive.network): the body of the
 * router's HTTP 404 answer (`liteUnmappedHttp`), as `fetchTransport` returns it.
 */
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

/** An HTTP answer for {@link stubFetch}: a string body is sent as is, anything else as JSON. */
export interface HttpAnswer {
  status: number;
  body: unknown;
}

export interface FetchStubNode {
  /** Per JSON-RPC method (a POST to the node); an `Error` is thrown as `fetch` throws on a failed connection. */
  rpc?: Record<string, HttpAnswer | Error>;
  /** Per path (a GET). */
  rest?: Record<string, HttpAnswer | Error>;
}

/** The router's answer to `lite.get_info` where no backend serves lite, verbatim: HTTP 404. */
export const liteUnmappedHttp: HttpAnswer = { status: 404, body: routerUnmapped };

/**
 * A `fetch` answering from `nodes` (mutable), for running the engine through `fetchTransport`: install
 * it with `vi.stubGlobal("fetch", …)`. Unstubbed requests fail as a refused connection.
 */
export const stubFetch = (nodes: Record<string, FetchStubNode>) => {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const node = url.origin;
    const key = init?.method === "POST" ? (JSON.parse(String(init.body)) as { method: string }).method : url.pathname;
    calls.push(`${node} ${key}`);
    const answer = init?.method === "POST" ? nodes[node]?.rpc?.[key] : nodes[node]?.rest?.[key];
    if (answer === undefined) throw new TypeError(`fetch failed: no stubbed answer for ${node} ${key}`);
    if (answer instanceof Error) throw answer;
    const body = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    return new Response(body, { status: answer.status, headers: { "Access-Control-Allow-Origin": "*" } });
  };
  return { fetch, calls };
};

const ok = (body: unknown): HttpAnswer => ({ status: 200, body });

/** api.hive.blog over HTTP: bridge, the router's 404 for lite. */
export const hiveBlogHttp = (): FetchStubNode => ({
  rpc: { "jsonrpc.get_methods": ok(hivedMethods), "bridge.get_post": ok(missingPost), "lite.get_info": liteUnmappedHttp },
});
/** api.syncad.com over HTTP: bridge and lite. */
export const syncadHttp = (): FetchStubNode => ({
  rpc: { "jsonrpc.get_methods": ok(hivedMethods), "bridge.get_post": ok(missingPost), "lite.get_info": ok(syncadLite) },
});
