// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ApiSetEngine,
  isApiNotFound,
  jsonRpcApiProbe,
  jsonRpcMethodProbe,
  jsonRpcNamespaceProbe,
  localStorageAdapter,
  memoryStorage,
  ProbeFailedError,
  restProbe,
  TransportError,
} from "../src";
import type { ApiSet, ApiSetEngineEvents, ApiSetEngineOptions, JsonRpcResponse, NodeRanking } from "../src";
import {
  BRIDGE_PROBE,
  bridgeMissingPost,
  getMethods,
  HIVE,
  hiveBlog,
  hivesenseNotFound,
  liteInfo,
  liteUnmapped,
  OPENHIVE,
  stubTransport,
  SYNCAD,
  syncad,
} from "./stubTransport";
import type { StubNode } from "./stubTransport";

const wax = vi.hoisted(() => {
  type Listener = (payload: unknown) => void;

  class FakeHealthChecker {
    static instances: FakeHealthChecker[] = [];
    private listeners = new Map<string, Listener[]>();
    registrations: string[][] = [];

    constructor() {
      FakeHealthChecker.instances.push(this);
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    emit(event: string, payload: unknown) {
      this.listeners.get(event)?.forEach((listener) => listener(payload));
    }

    register(_method: unknown, _params: unknown, _validator: unknown, nodes: string[]) {
      this.registrations.push(nodes);
      return { id: this.registrations.length };
    }

    unregisterAll() {
      this.registrations = [];
    }
  }

  return { FakeHealthChecker };
});

vi.mock("@hiveio/wax", () => ({ HealthChecker: wax.FakeHealthChecker }));

type LiteInfo = { methods: string[]; apps: { social?: string } };

const LITE_METHODS = [
  "get_discussion",
  "get_post",
  "get_ranked_posts",
  "get_account_posts",
  "get_profile",
  "get_followers",
  "get_following",
  "get_follow_count",
  "list_subscribers",
  "list_all_subscriptions",
  "get_community",
  "list_community_roles",
  "account_notifications",
  "unread_notifications",
  "lookup_accounts",
];
const UNMAPPED = "Unable to map request to endpoint.";
const CUSTOM = "https://hive.my-node.example";

const bridge: ApiSet = { id: "bridge", title: "Bridge", probe: jsonRpcApiProbe(BRIDGE_PROBE.method, BRIDGE_PROBE.params), group: "hivemind" };
const lite: ApiSet = {
  id: "lite",
  title: "Lite accounts",
  probe: jsonRpcMethodProbe<LiteInfo>("lite.get_info", {}, (info) => [...info.methods, ...(info.apps.social ? ["social"] : [])]),
  group: "hivemind",
};

const setup = (overrides: Partial<ApiSetEngineOptions> & { stubs?: Record<string, StubNode> } = {}) => {
  const clock = { now: 1_000_000 };
  const stubs = overrides.stubs ?? { [HIVE]: hiveBlog(), [SYNCAD]: syncad() };
  const { transport, calls } = stubTransport(stubs);
  const engine = new ApiSetEngine({
    nodes: [HIVE, SYNCAD],
    sets: [bridge, lite],
    transport,
    now: () => clock.now,
    ...overrides,
  });
  return { engine, clock, calls, stubs };
};

const states = (rankings: NodeRanking[]) => Object.fromEntries(rankings.map((r) => [r.node, r.state]));
const ranking = (engine: ApiSetEngine, setId: string, node: string) => engine.rankings(setId).find((r) => r.node === node);

const record = <K extends keyof ApiSetEngineEvents>(engine: ApiSetEngine, type: K) => {
  const events: ApiSetEngineEvents[K][] = [];
  engine.on(type, (detail) => events.push(detail));
  return events;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

describe("ApiSetEngine", () => {
  it("routes lite to the node that serves it and bridge by operator preference, reporting the split group", async () => {
    const { engine } = setup();
    const groupEvents = record(engine, "groupchange");

    // Before any probe the operator's first choice stands in, so an SSR render and the browser agree.
    expect(engine.bestNode("lite")).toBe(HIVE);
    await engine.refresh();

    expect(states(engine.rankings("lite"))).toEqual({ [HIVE]: "unsupported", [SYNCAD]: "eligible" });
    expect(ranking(engine, "lite", HIVE)?.reason).toBe(UNMAPPED);
    expect(engine.rankings("lite")[0]).toMatchObject({ node: SYNCAD, features: [...LITE_METHODS, "social"], isDefault: true });
    expect(states(engine.rankings("bridge"))).toEqual({ [HIVE]: "eligible", [SYNCAD]: "eligible" });
    expect(engine.bestNode("lite")).toBe(SYNCAD);
    expect(engine.bestNode("bridge")).toBe(HIVE);
    expect(engine.fallbackOrder("bridge")).toEqual([HIVE, SYNCAD]);
    expect(engine.fallbackOrder("lite")).toEqual([SYNCAD]);
    expect(engine.groups()).toEqual([
      { group: "hivemind", sets: ["bridge", "lite"], split: true, nodesBySet: { bridge: HIVE, lite: SYNCAD } },
    ]);
    expect(groupEvents[groupEvents.length - 1]?.split).toBe(true);
  });

  it("accepts a choice only among the set's eligible nodes and keeps it across serialize/hydrate", async () => {
    const storage = memoryStorage();
    const { engine } = setup({ storage });
    await engine.refresh();

    expect(engine.select("lite", HIVE)).toBe(false);
    expect(engine.select("lite", "https://unknown.example.com")).toBe(false);
    expect(engine.select("nope", SYNCAD)).toBe(false);
    expect(engine.selection("lite")).toBe("auto");

    expect(engine.select("lite", SYNCAD)).toBe(true);
    expect(engine.select("bridge", SYNCAD)).toBe(true);
    expect(engine.bestNode("bridge")).toBe(SYNCAD);
    expect(ranking(engine, "bridge", SYNCAD)).toMatchObject({ isSelected: true, isActive: true, isDefault: false });

    const state = engine.serialize();
    expect(state).toBe("v=1&s.lite=1&s.bridge=1");
    expect(storage.load()).toBe(state);

    // A fresh engine (an SSR render reading the cookie) restores the choice and uses it once probed.
    const { engine: ssr } = setup();
    expect(ssr.hydrate(state)).toBe(true);
    expect(ssr.selection("lite")).toBe(SYNCAD);
    await ssr.refresh();
    expect(ssr.bestNode("lite")).toBe(SYNCAD);
    expect(ssr.bestNode("bridge")).toBe(SYNCAD);
    // And one constructed on the same storage restores it too.
    expect(setup({ storage }).engine.selection("bridge")).toBe(SYNCAD);

    expect(engine.select("bridge", "auto")).toBe(true);
    expect(engine.bestNode("bridge")).toBe(HIVE);
    expect(engine.serialize()).toBe("v=1&s.lite=1");
  });

  it("drops unreadable or unknown hydrated state", () => {
    const { engine } = setup();
    expect(engine.hydrate("v=9&s.bridge=1")).toBe(false);
    expect(engine.hydrate(`v=1&s.bridge=7&s.ghost=0&s.lite=${encodeURIComponent("https://not.added.example")}&c=javascript:alert(1)`)).toBe(true);
    expect(engine.selection("bridge")).toBe("auto");
    expect(engine.selection("lite")).toBe("auto");
    expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
  });

  it("saves hydrated state through the storage adapter", () => {
    const storage = memoryStorage();
    const { engine } = setup({ storage });
    expect(engine.hydrate(`v=1&c=${encodeURIComponent(CUSTOM)}&s.bridge=1`)).toBe(true);
    expect(storage.load()).toBe(engine.serialize());
    expect(setup({ storage }).engine.selection("bridge")).toBe(SYNCAD);
  });

  describe("eligibility", () => {
    it("marks a node down on a transport failure, retries it only after the cooldown, then finds it eligible", async () => {
      const stubs = { [HIVE]: { rpc: { "bridge.get_post": new TransportError("connect ECONNREFUSED") } } as StubNode, [SYNCAD]: syncad() };
      const { engine, clock, calls } = setup({ stubs, sets: [bridge], timing: { downCooldownMs: 30_000 } });
      await engine.refresh();
      expect(ranking(engine, "bridge", HIVE)).toMatchObject({ state: "down", reason: "connect ECONNREFUSED" });
      expect(engine.bestNode("bridge")).toBe(SYNCAD);

      stubs[HIVE] = hiveBlog();
      clock.now += 10_000;
      await engine.refresh();
      expect(calls.filter((c) => c.startsWith(HIVE))).toHaveLength(1);

      clock.now += 20_000;
      await engine.refresh();
      expect(states(engine.rankings("bridge"))[HIVE]).toBe("eligible");
      expect(engine.bestNode("bridge")).toBe(HIVE);
    });

    it("trusts the router's unmapped answer as unsupported until its TTL, not as down", async () => {
      const { engine, clock, calls } = setup({
        sets: [lite],
        timing: { unsupportedTtlMs: 3_600_000, eligibleRecheckMs: 7_200_000, downCooldownMs: 30_000 },
      });
      await engine.refresh();
      expect(states(engine.rankings("lite"))[HIVE]).toBe("unsupported");
      clock.now += 3_000_000;
      await engine.refresh();
      expect(calls.filter((c) => c === `${HIVE} lite.get_info`)).toHaveLength(1);
      clock.now += 600_000;
      await engine.refresh();
      expect(calls.filter((c) => c === `${HIVE} lite.get_info`)).toHaveLength(2);
      expect(calls.filter((c) => c === `${SYNCAD} lite.get_info`)).toHaveLength(1);
    });

    it("learns from reported calls: API not found is unsupported at once, transport errors add up to down", async () => {
      const { engine } = setup({ sets: [bridge], downAfterFailures: 3 });
      await engine.refresh();

      const unmapped = liteUnmapped.error!;
      expect(isApiNotFound(unmapped)).toBe(true);
      expect(engine.report("bridge", SYNCAD, { ok: false, error: "apiNotFound", message: unmapped.message })).toBe(true);
      expect(ranking(engine, "bridge", SYNCAD)).toMatchObject({ state: "unsupported", reason: UNMAPPED });

      engine.report("bridge", HIVE, { ok: false, error: "transport" });
      engine.report("bridge", HIVE, { ok: false, error: "transport" });
      expect(states(engine.rankings("bridge"))[HIVE]).toBe("eligible");
      engine.report("bridge", HIVE, { ok: false, error: "transport", message: "timeout" });
      expect(ranking(engine, "bridge", HIVE)).toMatchObject({ state: "down", reason: "timeout" });
      expect(engine.bestNode("bridge")).toBeUndefined();

      engine.report("bridge", HIVE, { ok: true, latencyMs: 120 });
      expect(ranking(engine, "bridge", HIVE)).toMatchObject({ state: "eligible", medianLatencyMs: 120 });
      expect(engine.report("bridge", OPENHIVE, { ok: true })).toBe(false);
    });

    it("keeps a reported unsupported answer over an older probe that resolves afterwards", async () => {
      const held = deferred<JsonRpcResponse>();
      const stubs = { [HIVE]: hiveBlog(), [SYNCAD]: { rpc: { ...syncad().rpc, "lite.get_info": held.promise } } };
      const { engine } = setup({ stubs, sets: [lite] });
      const round = engine.refresh();

      engine.report("lite", SYNCAD, { ok: false, error: "apiNotFound", message: UNMAPPED });
      held.resolve(liteInfo);
      await round;
      expect(ranking(engine, "lite", SYNCAD)).toMatchObject({ state: "unsupported", reason: UNMAPPED });
      expect(engine.bestNode("lite")).toBeUndefined();
    });

    it("probes a node added during a running round at once", async () => {
      const held = deferred<JsonRpcResponse>();
      const stubs = { [HIVE]: { rpc: { "bridge.get_post": held.promise } }, [SYNCAD]: syncad(), [CUSTOM]: syncad() };
      const { engine } = setup({ stubs, sets: [bridge] });
      const round = engine.start();

      expect(engine.addNode(CUSTOM)).toBe(true);
      await vi.waitFor(() => expect(ranking(engine, "bridge", CUSTOM)?.state).toBe("eligible"));
      expect(states(engine.rankings("bridge"))[HIVE]).toBe("unknown");

      held.resolve(bridgeMissingPost);
      await round;
      engine.stop();
    });
  });

  describe("node URLs", () => {
    it("treats slash and case variants as one node everywhere", async () => {
      const { engine, calls } = setup({
        nodes: ["https://api.hive.blog/", "HTTPS://API.Syncad.com"],
        sets: [bridge],
        preferences: { bridge: ["https://api.syncad.com/", HIVE] },
      });
      expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
      await engine.refresh();
      expect(calls.every((c) => c.startsWith(`${HIVE} `) || c.startsWith(`${SYNCAD} `))).toBe(true);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);

      expect(engine.report("bridge", "https://api.syncad.com", { ok: true, latencyMs: 90 })).toBe(true);
      expect(engine.report("bridge", "https://API.syncad.com/", { ok: true, latencyMs: 110 })).toBe(true);
      expect(ranking(engine, "bridge", SYNCAD)?.medianLatencyMs).toBe(90);

      expect(engine.addNode("https://Api.Hive.Blog/")).toBe(false);
      expect(engine.addNode(`${CUSTOM}/`)).toBe(true);
      expect(engine.nodes()).toEqual([HIVE, SYNCAD, CUSTOM]);

      expect(engine.select("bridge", "https://API.HIVE.BLOG/")).toBe(true);
      expect(engine.selection("bridge")).toBe(HIVE);
      expect(engine.serialize()).toBe(`v=1&c=${encodeURIComponent(CUSTOM)}&s.bridge=0`);

      expect(engine.hydrate(`v=1&c=${encodeURIComponent(`${CUSTOM.toUpperCase()}/`)}&s.bridge=${encodeURIComponent(`${SYNCAD}/`)}`)).toBe(true);
      expect(engine.nodes()).toEqual([HIVE, SYNCAD, CUSTOM]);
      expect(engine.selection("bridge")).toBe(SYNCAD);
      expect(engine.removeNode(`${CUSTOM}/`)).toBe(true);
      expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
    });

    it("refuses a catalog entry that is not an http(s) URL", () => {
      expect(() => setup({ nodes: [HIVE, "wss://api.hive.blog"] })).toThrow(TypeError);
    });

    it("treats an empty query as none and rejects URLs with user info", () => {
      const { engine } = setup();
      expect(engine.addNode(`${HIVE}/?`)).toBe(false);
      expect(engine.addNode(`${CUSTOM}/?#top`)).toBe(true);
      expect(engine.nodes()).toEqual([HIVE, SYNCAD, CUSTOM]);

      expect(engine.addNode("https://user:secret@other.example")).toBe(false);
      expect(engine.addNode("https://user@other.example")).toBe(false);
      expect(engine.hydrate(`v=1&c=${encodeURIComponent("https://user:secret@other.example")}`)).toBe(true);
      expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
    });

    it("refuses user info in the catalog and in preferences, naming the reason but not the secret", () => {
      const userInfo = "https://user:secret@api.syncad.com/";
      const error = /^Node URLs must not contain user info: https:\/\/api\.syncad\.com\/$/;
      expect(() => setup({ nodes: [HIVE, userInfo] })).toThrow(TypeError);
      expect(() => setup({ nodes: [HIVE, userInfo] })).toThrow(error);
      expect(() => setup({ preferences: { bridge: [userInfo, HIVE] } })).toThrow(TypeError);
      expect(() => setup({ preferences: { bridge: [userInfo, HIVE] } })).toThrow(error);
      expect(() => setup({ preferences: { bridge: [[HIVE, "https://user@api.syncad.com"]] } })).toThrow(
        "Node URLs must not contain user info: https://api.syncad.com/",
      );
      expect(() => setup({ preferences: { bridge: ["wss://api.hive.blog"] } })).toThrow("Not an http(s) node URL: wss://api.hive.blog");
      expect(() => setup({ nodes: [HIVE, "ftp://user:s3cret@api.syncad.com"] })).toThrow(/^Not an http\(s\) node URL: ftp:\/\/\*\*\*@api\.syncad\.com$/);
      expect(() => setup({ nodes: [HIVE, "https://user:s3cret@api syncad.com"] })).toThrow(/^Not an http\(s\) node URL: https:\/\/\*\*\*@api syncad\.com$/);
      expect(() => setup({ preferences: { bridge: ["user:s3cret@api.syncad.com", HIVE] } })).toThrow(/^Not an http\(s\) node URL: \*\*\*@api\.syncad\.com$/);
    });
  });

  describe("probes", () => {
    const context = (stubs: Record<string, StubNode>, node = HIVE) => ({ node, transport: stubTransport(stubs).transport, timeoutMs: 1000 });

    it("finds bridge on every node by calling it: get_methods lists only hived's namespaces", async () => {
      const stubs = { [HIVE]: hiveBlog(), [SYNCAD]: syncad() };
      for (const node of [HIVE, SYNCAD]) {
        await expect(bridge.probe(context(stubs, node))).resolves.toEqual({ supported: true });
        await expect(jsonRpcNamespaceProbe("bridge")(context(stubs, node))).resolves.toMatchObject({ supported: false });
      }

      const database = await jsonRpcNamespaceProbe("database_api")(context(stubs));
      expect(database.supported && database.features).toContain("find_accounts");
      expect(getMethods.result).toHaveLength(171);
    });

    it("reads not served from the router's and hived's answers, and the API's own errors as served", async () => {
      const probe = jsonRpcApiProbe("lite.get_info");
      await expect(probe(context({ [HIVE]: hiveBlog() }))).resolves.toEqual({ supported: false, reason: UNMAPPED });
      await expect(probe(context({ [SYNCAD]: syncad() }, SYNCAD))).resolves.toEqual({ supported: true });

      const hivesense = jsonRpcApiProbe("hivesense_api.list_posts");
      await expect(hivesense(context({ [HIVE]: { rpc: { "hivesense_api.list_posts": hivesenseNotFound } } }))).resolves.toMatchObject({
        supported: false,
        reason: expect.stringContaining("Could not find API hivesense_api"),
      });
      expect(isApiNotFound(bridgeMissingPost.error)).toBe(false);
      await expect(jsonRpcApiProbe("bridge.get_post")(context({}))).rejects.toThrow(TransportError);
    });

    it("fails the probe on an error that is neither not served nor the API's own", async () => {
      const answer = (error: JsonRpcResponse["error"]) => context({ [HIVE]: { rpc: { "bridge.get_post": { error: error! } } } });
      const probe = bridge.probe;
      await expect(probe(answer({ code: -32603, message: "Internal Error" }))).rejects.toThrow("bridge.get_post: Internal Error");
      await expect(probe(answer({ code: -32000, message: "backend", data: { name: "TimeoutError" } }))).rejects.toThrow(ProbeFailedError);
      await expect(probe(answer({ code: -32602, message: "invalid author" }))).resolves.toEqual({ supported: true });
      await expect(probe(answer({ code: -32000, message: "Assert Exception", data: { name: "assert_exception" } }))).resolves.toEqual({ supported: true });

      const { engine } = setup({ sets: [bridge], stubs: { [HIVE]: { rpc: { "bridge.get_post": { error: { code: -32603, message: "Internal Error" } } } }, [SYNCAD]: syncad() } });
      await engine.refresh();
      expect(states(engine.rankings("bridge"))).toEqual({ [SYNCAD]: "eligible", [HIVE]: "down" });
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
    });

    it("reads REST support from the HTTP answer", async () => {
      const probe = (answer: StubNode["rest"]) => restProbe("/balance-api/")(context({ [HIVE]: { rest: answer } }));
      await expect(probe({ "/balance-api/": { status: 200, body: {} } })).resolves.toEqual({ supported: true, features: undefined });
      await expect(probe({ "/balance-api/": { status: 404, body: "" } })).resolves.toMatchObject({ supported: false });
      await expect(probe({ "/balance-api/": { status: 400, body: { code: "PGRST202" } } })).resolves.toMatchObject({ supported: false });
      await expect(probe({ "/balance-api/": { status: 403, body: "" } })).rejects.toThrow("HTTP 403");
    });

    it("treats a lite.get_info error other than not served as a failed probe", async () => {
      const stubs = { [HIVE]: { rpc: { "lite.get_info": { error: { code: -32000, message: "internal" } } } } };
      await expect(lite.probe(context(stubs))).rejects.toThrow("lite.get_info: internal");
    });
  });

  describe("default node", () => {
    const sameRank = { bridge: [[HIVE, SYNCAD]] };

    const reportLatency = (engine: ApiSetEngine, node: string, latencyMs: number, times = 5) => {
      for (let i = 0; i < times; i++) engine.report("bridge", node, { ok: true, latencyMs });
    };

    it("follows the operator's order over latency", async () => {
      const { engine } = setup({ sets: [bridge], preferences: { bridge: [SYNCAD, HIVE] } });
      await engine.refresh();
      reportLatency(engine, HIVE, 50);
      reportLatency(engine, SYNCAD, 400);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
    });

    it("breaks ties within a rank by latency and sticks to the current node within the margin", async () => {
      const { engine } = setup({ sets: [bridge], preferences: sameRank, stickinessMargin: 0.2 });
      await engine.refresh();
      reportLatency(engine, HIVE, 200);
      reportLatency(engine, SYNCAD, 100);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);

      reportLatency(engine, HIVE, 90, 20);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      reportLatency(engine, HIVE, 60, 30);
      expect(engine.bestNode("bridge")).toBe(HIVE);
    });

    it("ranks a node lagging beyond the freshness threshold as degraded", async () => {
      const lag: Record<string, number> = { [HIVE]: 500, [SYNCAD]: 2 };
      const fresh: ApiSet = { ...bridge, freshness: { lag: async ({ node }) => lag[node], maxLag: 20 } };
      const { engine } = setup({ sets: [fresh] });
      await engine.refresh();
      expect(engine.rankings("bridge").map((r) => [r.node, r.degraded, r.freshnessLag])).toEqual([
        [SYNCAD, false, 2],
        [HIVE, true, 500],
      ]);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
    });

    it("gives a soft group one node when it is among every set's best", async () => {
      const { engine } = setup({ preferences: { bridge: [[HIVE, SYNCAD]], lite: [SYNCAD, HIVE] } });
      await engine.refresh();
      reportLatency(engine, HIVE, 50);
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      expect(engine.groups()[0]).toMatchObject({ split: false, nodesBySet: { bridge: SYNCAD, lite: SYNCAD } });
    });

    describe("snapshot", () => {
      // Ungrouped, so bridge's default is not lite's node.
      const sets = [bridge, { ...lite, group: undefined }];

      // The server's default stays HIVE by stickiness although SYNCAD is now faster within the margin:
      // an engine that only saw the latencies would pick SYNCAD.
      const serverEngine = async () => {
        const server = setup({ sets, preferences: sameRank, stickinessMargin: 0.2 });
        await server.engine.refresh();
        reportLatency(server.engine, HIVE, 100);
        reportLatency(server.engine, SYNCAD, 300);
        reportLatency(server.engine, SYNCAD, 90, 20);
        expect(server.engine.bestNode("bridge")).toBe(HIVE);
        return server.engine;
      };

      const browserEngine = (snapshot: unknown, cookie?: string) => {
        const browser = setup({ sets, preferences: sameRank, stubs: {} });
        if (cookie) browser.engine.hydrate(cookie);
        expect(browser.engine.hydrateSnapshot(snapshot)).toBe(true);
        return browser;
      };

      it("gives a fresh engine the server's nodes without probing", async () => {
        const server = await serverEngine();
        server.select("lite", SYNCAD);
        const snapshot = JSON.parse(JSON.stringify(server.snapshot()));

        const { engine, calls } = browserEngine(snapshot, server.serialize());
        for (const { id } of server.sets()) {
          expect(engine.bestNode(id)).toBe(server.bestNode(id));
          expect(engine.rankings(id)).toEqual(server.rankings(id));
        }
        expect(engine.bestNode("lite")).toBe(SYNCAD);
        expect(engine.rankings("lite")[0]).toMatchObject({ node: SYNCAD, isSelected: true, isActive: true });
        expect(calls).toEqual([]);
        expect(setup({ sets, preferences: sameRank, stubs: {} }).engine.bestNode("lite")).toBe(HIVE);
      });

      it("chooses the same defaults on every engine fed the same snapshot", async () => {
        const snapshot = JSON.parse(JSON.stringify((await serverEngine()).snapshot()));
        const view = (engine: ApiSetEngine) => engine.sets().map((set) => [engine.bestNode(set.id), engine.fallbackOrder(set.id)]);
        const first = view(browserEngine(snapshot).engine);
        expect(first).toEqual([
          [HIVE, [HIVE, SYNCAD]],
          [SYNCAD, [SYNCAD]],
        ]);
        expect(view(browserEngine(snapshot).engine)).toEqual(first);
      });

      it("probes again when the snapshot says a node is due", async () => {
        const server = await serverEngine();
        const snapshot = server.snapshot();
        snapshot.sets.bridge.nodes[SYNCAD].nextProbeInMs = 0;
        const { engine, calls, stubs } = browserEngine(snapshot);
        stubs[SYNCAD] = syncad();
        await engine.refresh();
        expect(calls).toEqual([`${SYNCAD} bridge.get_post`]);
      });

      it("caps each due time by the engine's timing for the node's state", async () => {
        const snapshot = (await serverEngine()).snapshot();
        snapshot.sets.bridge.nodes[SYNCAD].nextProbeInMs = 1e15;
        snapshot.sets.lite.nodes[HIVE].nextProbeInMs = 1e15;
        const { engine, calls, clock, stubs } = browserEngine(snapshot);
        Object.assign(stubs, { [HIVE]: hiveBlog(), [SYNCAD]: syncad() });

        clock.now += 10 * 60_000 - 1;
        await engine.refresh();
        expect(calls).toEqual([]);
        clock.now += 1;
        await engine.refresh();
        expect(calls).toEqual([`${HIVE} bridge.get_post`, `${SYNCAD} bridge.get_post`, `${SYNCAD} lite.get_info`]);
        clock.now += 6 * 60 * 60_000;
        await engine.refresh();
        expect(calls).toContain(`${HIVE} lite.get_info`);
      });

      it("ages an old snapshot's due times and ignores one beyond the max age", async () => {
        const snapshot = (await serverEngine()).snapshot();
        const { engine, calls, clock, stubs } = setup({ sets, preferences: sameRank, stubs: {} });
        Object.assign(stubs, { [HIVE]: hiveBlog(), [SYNCAD]: syncad() });
        clock.now = snapshot.createdAt + 10 * 60_000 - 1000;
        expect(engine.hydrateSnapshot(snapshot)).toBe(true);
        expect(engine.bestNode("lite")).toBe(SYNCAD);
        await engine.refresh();
        expect(calls).toEqual([]);
        clock.now += 1000;
        await engine.refresh();
        expect(calls).toHaveLength(3);

        const late = setup({ sets, preferences: sameRank, stubs: {}, timing: { snapshotMaxAgeMs: 60_000, snapshotClockSkewMs: 0 } });
        late.clock.now = snapshot.createdAt + 60_001;
        expect(late.engine.hydrateSnapshot(snapshot)).toBe(false);
        expect(states(late.engine.rankings("lite"))).toEqual({ [HIVE]: "unknown", [SYNCAD]: "unknown" });
        expect(late.engine.bestNode("lite")).toBe(HIVE);
        late.clock.now = snapshot.createdAt + 60_000;
        expect(late.engine.hydrateSnapshot(snapshot)).toBe(true);
      });

      it("builds a never-probing per-request engine from a shared one and a cookie", async () => {
        const shared = await serverEngine();
        const sharedSnapshot = shared.snapshot();
        const user = setup({ sets, preferences: sameRank, stubs: { [HIVE]: hiveBlog(), [SYNCAD]: syncad(), [CUSTOM]: syncad() } });
        await user.engine.refresh();
        user.engine.addNode(CUSTOM);
        await user.engine.refresh();
        expect(user.engine.select("lite", CUSTOM)).toBe(true);
        expect(user.engine.select("bridge", SYNCAD)).toBe(true);
        const cookie = user.engine.serialize();

        const request = ApiSetEngine.forRequest(shared, cookie);
        expect(request.nodes()).toEqual([HIVE, SYNCAD, CUSTOM]);
        expect(request.selection("lite")).toBe(CUSTOM);
        expect(request.bestNode("lite")).toBe(SYNCAD);
        expect(request.bestNode("bridge")).toBe(SYNCAD);
        expect(ranking(request, "lite", CUSTOM)).toMatchObject({ state: "unknown", isSelected: true, isActive: false });

        // The shared engine is untouched: no cookie choice, no custom node.
        expect(shared.nodes()).toEqual([HIVE, SYNCAD]);
        expect(shared.selection("bridge")).toBe("auto");
        expect(shared.snapshot()).toEqual(sharedSnapshot);

        // Even when refreshed by mistake, it fetches nothing.
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        await request.refresh();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        expect(ApiSetEngine.forRequest(shared).bestNode("bridge")).toBe(HIVE);
      });

      it("never probes, checks or calls the sets' functions on a per-request engine, even when started", async () => {
        const probe = vi.fn(bridge.probe);
        const lag = vi.fn(async () => 0);
        const createHealthChecker = vi.fn(() => new wax.FakeHealthChecker() as never);
        const watched: ApiSet[] = [
          { ...bridge, probe, freshness: { lag, maxLag: 10 } },
          { ...lite, group: undefined, checks: [{ title: "Info", method: {}, params: {}, validatorFunction: () => true }] },
        ];
        const shared = setup({ sets: watched, preferences: sameRank, createHealthChecker });
        await shared.engine.refresh();
        expect(shared.engine.bestNode("lite")).toBe(SYNCAD);
        probe.mockClear();
        lag.mockClear();
        shared.calls.length = 0;
        wax.FakeHealthChecker.instances = [];

        const request = ApiSetEngine.forRequest(shared.engine, `v=1&c=${encodeURIComponent(CUSTOM)}`);
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        // Every node is due for its probe and freshness check.
        shared.clock.now += 24 * 60 * 60_000;
        await request.start();
        await request.refresh();
        expect(request.addNode(OPENHIVE)).toBe(true);
        await request.refresh();
        request.stop();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();

        expect(shared.calls).toEqual([]);
        expect(probe).not.toHaveBeenCalled();
        expect(lag).not.toHaveBeenCalled();
        expect(createHealthChecker).not.toHaveBeenCalled();
        expect(wax.FakeHealthChecker.instances).toEqual([]);
        expect(request.bestNode("bridge")).toBe(shared.engine.bestNode("bridge"));
        expect(request.bestNode("lite")).toBe(SYNCAD);
        expect(states(request.rankings("lite"))).toEqual({ [HIVE]: "unsupported", [SYNCAD]: "eligible", [CUSTOM]: "unknown", [OPENHIVE]: "unknown" });
      });

      it("ignores reports on a per-request engine, so a cookie's node is never promoted; the shared engine takes them", async () => {
        const shared = await serverEngine();
        const user = setup({ sets, preferences: sameRank, stubs: { [HIVE]: hiveBlog(), [SYNCAD]: syncad(), [CUSTOM]: syncad() } });
        await user.engine.refresh();
        user.engine.addNode(CUSTOM);
        await user.engine.refresh();
        expect(user.engine.select("lite", CUSTOM)).toBe(true);

        const request = ApiSetEngine.forRequest(shared, user.engine.serialize());
        const before = request.rankings("lite");
        expect(request.bestNode("lite")).toBe(SYNCAD);
        expect(request.report("lite", CUSTOM, { ok: true, latencyMs: 10 })).toBe(false);
        expect(request.report("lite", HIVE, { ok: true, latencyMs: 10 })).toBe(false);
        expect(request.report("lite", SYNCAD, { ok: false, error: "transport" })).toBe(false);
        expect(request.bestNode("lite")).toBe(SYNCAD);
        expect(request.rankings("lite")).toEqual(before);
        expect(states(request.rankings("lite"))).toEqual({ [HIVE]: "unsupported", [SYNCAD]: "eligible", [CUSTOM]: "unknown" });

        expect(shared.report("lite", CUSTOM, { ok: true })).toBe(false);
        expect(shared.report("lite", HIVE, { ok: true, latencyMs: 10 })).toBe(true);
        expect(ranking(shared, "lite", HIVE)?.state).toBe("eligible");
        expect(shared.bestNode("lite")).toBe(HIVE);
      });

      describe("with the browser's clock off the server's by 45 min", () => {
        const SKEW = 45 * 60_000;
        const skewed = (snapshot: unknown, offsetMs: number, timing: ApiSetEngineOptions["timing"] = {}) => {
          const browser = setup({ sets, preferences: sameRank, stubs: {}, timing });
          browser.clock.now = (snapshot as { createdAt: number }).createdAt + offsetMs;
          return browser;
        };

        it("takes a fresh snapshot exactly with a measured clock offset", async () => {
          const server = await serverEngine();
          const snapshot = JSON.parse(JSON.stringify(server.snapshot()));
          for (const offset of [SKEW, -SKEW]) {
            const { engine, calls, clock, stubs } = skewed(snapshot, offset);
            expect(engine.hydrateSnapshot(snapshot, { clockOffsetMs: -offset })).toBe(true);
            for (const { id } of server.sets()) expect(engine.bestNode(id)).toBe(server.bestNode(id));
            Object.assign(stubs, { [HIVE]: hiveBlog(), [SYNCAD]: syncad() });
            await engine.refresh();
            expect(calls).toEqual([]);
            // Due as on the server: eligible nodes after `eligibleRecheckMs`, not at once nor never.
            clock.now += 10 * 60_000;
            await engine.refresh();
            expect(calls).toContain(`${SYNCAD} bridge.get_post`);
          }
        });

        it("ages a cached snapshot by the server's clock with a measured offset, even with the browser behind", async () => {
          const snapshot = (await serverEngine()).snapshot();
          // Served from a cache 40 min after it was taken, to a browser 45 min behind the server.
          const { engine } = skewed(snapshot, 40 * 60_000 - SKEW);
          expect(engine.hydrateSnapshot(snapshot, { clockOffsetMs: SKEW })).toBe(false);
          expect(states(engine.rankings("lite"))).toEqual({ [HIVE]: "unknown", [SYNCAD]: "unknown" });
          expect(() => engine.hydrateSnapshot(snapshot, { clockOffsetMs: Number.NaN })).toThrow(RangeError);
        });

        it("without an offset, counts a snapshot from the future as new and allows `snapshotClockSkewMs` ahead", async () => {
          const server = await serverEngine();
          const snapshot = server.snapshot();

          const behind = skewed(snapshot, -SKEW);
          expect(behind.engine.hydrateSnapshot(snapshot)).toBe(true);
          expect(behind.engine.bestNode("lite")).toBe(server.bestNode("lite"));
          Object.assign(behind.stubs, { [HIVE]: hiveBlog(), [SYNCAD]: syncad() });
          await behind.engine.refresh();
          expect(behind.calls).toEqual([]);

          // The default 5 min allowance does not cover 45 min ahead; a configured one does.
          expect(skewed(snapshot, SKEW).engine.hydrateSnapshot(snapshot)).toBe(false);
          const ahead = skewed(snapshot, SKEW, { snapshotClockSkewMs: 20 * 60_000 });
          expect(ahead.engine.hydrateSnapshot(snapshot)).toBe(true);
          for (const { id } of server.sets()) expect(ahead.engine.bestNode(id)).toBe(server.bestNode(id));
          expect(skewed(snapshot, 35 * 60_000).engine.hydrateSnapshot(snapshot)).toBe(true);
          expect(skewed(snapshot, 35 * 60_000 + 1).engine.hydrateSnapshot(snapshot)).toBe(false);
        });
      });

      it("refuses an unreadable snapshot and drops malformed nodes", async () => {
        const { engine } = setup();
        expect(engine.hydrateSnapshot({ v: 2, sets: {} })).toBe(false);
        expect(engine.hydrateSnapshot("v=1")).toBe(false);
        expect(engine.hydrateSnapshot({ v: 1, sets: {} })).toBe(false);
        const snapshot = (await serverEngine()).snapshot();
        const nodes = snapshot.sets.lite.nodes as Record<string, unknown>;
        nodes[HIVE] = { ...snapshot.sets.lite.nodes[HIVE], state: "great" };
        nodes[SYNCAD] = { ...snapshot.sets.lite.nodes[SYNCAD], failures: -1 };
        nodes["https://ghost.example"] = snapshot.sets.lite.nodes[SYNCAD];
        expect(engine.hydrateSnapshot(snapshot)).toBe(true);
        expect(states(engine.rankings("lite"))).toEqual({ [HIVE]: "unknown", [SYNCAD]: "unknown" });
        expect(states(engine.rankings("bridge"))).toEqual({ [HIVE]: "eligible", [SYNCAD]: "eligible" });
      });
    });
  });

  describe("user choice", () => {
    it("falls back to auto while the chosen node is down and returns to it on recovery", async () => {
      const { engine } = setup({ sets: [bridge], downAfterFailures: 1 });
      const fallbacks = record(engine, "selectionfallback");
      const restored = record(engine, "selectionrestored");
      await engine.refresh();
      engine.select("bridge", SYNCAD);

      engine.report("bridge", SYNCAD, { ok: false, error: "transport", message: "timeout" });
      expect(engine.selection("bridge")).toBe(SYNCAD);
      expect(engine.bestNode("bridge")).toBe(HIVE);
      expect(fallbacks).toEqual([{ setId: "bridge", selected: SYNCAD, node: HIVE, reason: "timeout" }]);

      engine.report("bridge", SYNCAD, { ok: true, latencyMs: 80 });
      expect(engine.bestNode("bridge")).toBe(SYNCAD);
      expect(restored).toEqual([{ setId: "bridge", node: SYNCAD }]);
    });

    it("does not use a hydrated choice before its node is found eligible", async () => {
      const stubs = { [HIVE]: hiveBlog(), [SYNCAD]: syncad(), [CUSTOM]: { rpc: { "bridge.get_post": new TransportError("timeout") } } };
      const { engine } = setup({ stubs, sets: [bridge] });
      const fallbacks = record(engine, "selectionfallback");
      engine.hydrate(`v=1&c=${encodeURIComponent(CUSTOM)}&s.bridge=${encodeURIComponent(CUSTOM)}`);

      expect(engine.selection("bridge")).toBe(CUSTOM);
      expect(engine.bestNode("bridge")).toBe(HIVE);
      expect(fallbacks).toEqual([]);

      await engine.refresh();
      expect(engine.bestNode("bridge")).toBe(HIVE);
      expect(fallbacks).toEqual([{ setId: "bridge", selected: CUSTOM, node: HIVE, reason: "timeout" }]);
    });

    it("uses one node for every set it serves and auto for the others", async () => {
      const { engine } = setup();
      await engine.refresh();
      expect(engine.select("lite", SYNCAD)).toBe(true);

      expect(engine.selectEverywhere("https://unknown.example")).toEqual([]);
      expect(engine.selection("lite")).toBe(SYNCAD);

      expect(engine.selectEverywhere(HIVE)).toEqual(["bridge"]);
      expect(engine.selection("bridge")).toBe(HIVE);
      expect(engine.selection("lite")).toBe("auto");
      expect(engine.serialize()).toBe("v=1&s.bridge=0");
    });

    it("offers a user-added node only after probing it", async () => {
      const stubs = { [HIVE]: hiveBlog(), [SYNCAD]: syncad(), [CUSTOM]: syncad() };
      const { engine } = setup({ stubs });
      expect(engine.addNode("not a url")).toBe(false);
      expect(engine.addNode(HIVE)).toBe(false);
      expect(engine.addNode(CUSTOM)).toBe(true);
      expect(engine.select("lite", CUSTOM)).toBe(false);

      await engine.refresh();
      expect(ranking(engine, "lite", CUSTOM)).toMatchObject({ state: "eligible", isCustom: true });
      expect(engine.select("lite", CUSTOM)).toBe(true);
      const state = engine.serialize();
      expect(new URLSearchParams(state).getAll("c")).toEqual([CUSTOM]);

      const { engine: restored } = setup({ stubs });
      restored.hydrate(state);
      expect(restored.bestNode("lite")).toBe(HIVE);
      await restored.refresh();
      expect(restored.bestNode("lite")).toBe(CUSTOM);

      expect(engine.removeNode(SYNCAD)).toBe(false);
      expect(engine.removeNode(CUSTOM)).toBe(true);
      expect(engine.selection("lite")).toBe("auto");
      expect(engine.nodes()).toEqual([HIVE, SYNCAD]);
    });
  });

  describe("headless", () => {
    const checked: ApiSet = { ...lite, checks: [{ title: "Info", method: {}, params: {}, validatorFunction: () => true }] };

    const startChecked = async (downAfterFailures: number) => {
      wax.FakeHealthChecker.instances = [];
      const { engine } = setup({ sets: [bridge, checked], downAfterFailures });
      await engine.start();
      const [checker] = wax.FakeHealthChecker.instances;
      return { engine, checker };
    };

    it("constructs, starts and stops with no window", async () => {
      expect(typeof window).toBe("undefined");
      const { engine } = setup({ storage: localStorageAdapter("apiSets") });
      await engine.start();
      expect(engine.bestNode("lite")).toBe(SYNCAD);
      engine.stop();
    });

    it("runs the set's wax checks against its eligible nodes and counts consecutive failed rounds", async () => {
      const { engine, checker } = await startChecked(2);
      expect(wax.FakeHealthChecker.instances).toHaveLength(1);
      expect(checker.registrations).toEqual([[SYNCAD]]);

      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100, 300] }]);
      expect(engine.rankings("lite")[0]).toMatchObject({ medianLatencyMs: 100, p95LatencyMs: 300, errorRate: 0 });

      // wax still lists the node as up after a failed round (its window has older successes).
      checker.emit("error", { apiUrl: SYNCAD, message: "timeout" });
      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100, 300] }]);
      expect(states(engine.rankings("lite"))[SYNCAD]).toBe("eligible");
      checker.emit("error", { apiUrl: `${SYNCAD}/`, message: "timeout" });
      expect(states(engine.rankings("lite"))[SYNCAD]).toBe("down");
      expect(checker.registrations).toEqual([]);
      engine.stop();
    });

    it("counts a validator failure once, as bad data rather than a transport failure", async () => {
      const { engine, checker } = await startChecked(1);
      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100] }]);

      const message = 'Validator did not pass on api: "lite.get_info https://api.syncad.com": "no methods"';
      checker.emit("validationerror", { request: { endpoint: SYNCAD }, message });
      checker.emit("error", { apiUrl: SYNCAD, message: `Health checker error: ${message}` });
      expect(ranking(engine, "lite", SYNCAD)).toMatchObject({ state: "eligible", degraded: true, errorRate: 0.5, reason: message });
      expect(checker.registrations).toEqual([[SYNCAD]]);

      // The round's own `data` (wax lists the node up from its window) is no new success...
      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100] }]);
      expect(ranking(engine, "lite", SYNCAD)).toMatchObject({ state: "eligible", degraded: true });
      // ...the next round's is.
      checker.emit("data", [{ endpointUrl: SYNCAD, up: true, score: 1, latencies: [100] }]);
      expect(ranking(engine, "lite", SYNCAD)).toMatchObject({ state: "eligible", degraded: false });
      engine.stop();
    });
  });
});
