# Healhchecker Component for export

This project is HealthChecker Component using Wax to check the data of APIs, and providing all the necessary factors for display. You can import it to your React project, configure the props and use the generic component for handling APIs.

### Techstack
* React
* Tailwind
* Shad UI
* Typescript
* Vite
* Wax

### Structure
The project is using Wax's Healthchecker to regularly check for API's score. Then it wrap the data up in dedicated service, that will be passed as a prop to custom component. On the service declaration level devs may add list of checks and default providers.

### Instalation
For proper work of HealthChecker component you need React and Tailwind installed. If you use dev component version remember about adding `.npmrc` file to your project with:

```
@hiveio:registry=https://gitlab.syncad.com/api/v4/groups/136/-/packages/npm/
```

The component ships Tailwind CSS 4 class names, not a stylesheet. After installing the newest version of component into your project, point Tailwind at it from the CSS file that imports Tailwind (the path is relative to that file):

```
@import "tailwindcss";
@source "../node_modules/@hiveio/healthchecker-component/dist";
```

That way Tailwind can use style from component in your application. Tailwind 4's default border color is `currentcolor`; the component's bordered elements take your application's base border color (e.g. shadcn's `* { @apply border-border; }`).

You can install HealthChecker component with `pnpm` (recommended).


### API sets: a node per API family

Hive nodes don't all serve the same APIs (api.syncad.com serves `lite.*`, `/balance-api` and hivesense; api.hive.blog serves no `lite.*`). `ApiSetEngine` decides, per **API set** the app declares, which nodes serve it, which one to use, how they rank and which one the user chose. It is framework-free: no React, no `window` at import or construction, so it runs in Node (SSR) and the browser. `ApiSetsComponent` renders an engine: one tab per set, its ranked nodes, the user's choice and the node in use. `HealthCheckerService` / `HealthCheckerComponent` are unchanged.

```ts
import {
  ApiSetEngine, ApiSetsComponent, jsonRpcMethodProbe, jsonRpcNamespaceProbe, localStorageAdapter, restProbe,
} from "@hiveio/healthchecker-component";

const engine = new ApiSetEngine({
  nodes: ["https://api.hive.blog", "https://api.syncad.com", "https://api.openhive.network"],
  sets: [
    { id: "bridge", title: "Bridge", probe: jsonRpcNamespaceProbe("bridge"), group: "hivemind" },
    {
      id: "lite", title: "Lite accounts", group: "hivemind",
      probe: jsonRpcMethodProbe<{ methods: string[]; apps: { social?: boolean } }>(
        "lite.get_info", {}, (info) => [...info.methods, ...(info.apps.social ? ["social"] : [])],
      ),
    },
    { id: "balance", title: "Balance API", probe: restProbe("/balance-api/") },
  ],
  // Per set, the operator's order; an inner array is one rank of equally preferred nodes.
  preferences: {
    bridge: ["https://api.hive.blog", ["https://api.syncad.com", "https://api.openhive.network"]],
    lite: ["https://api.syncad.com"],
  },
  storage: localStorageAdapter("apiSets"), // or memoryStorage(); load()/save() for a cookie
});

engine.on("nodechange", ({ setId, node }) => console.log(setId, "now uses", node));
engine.on("selectionfallback", ({ selected, node }) => notify(`${selected} is unavailable, using ${node}`));
await engine.start();                    // probe now, then keep probing what is due; engine.stop() ends it

engine.bestNode("lite");                 // "https://api.syncad.com": api.hive.blog is unsupported for lite
engine.bestNode("bridge");               // "https://api.hive.blog": the operator's first choice
engine.fallbackOrder("bridge");          // the eligible nodes, in the order to fail over in
engine.rankings("lite");                 // per node: state, reason, features, latency, error rate, freshness lag, default/selected
engine.groups();                         // [{ group: "hivemind", split: true, nodesBySet: { bridge: …, lite: … } }]

engine.select("lite", "https://api.hive.blog");    // false: not eligible for lite
engine.select("lite", "https://api.syncad.com");   // true; engine.select("lite", "auto") undoes it
engine.selectEverywhere("https://api.syncad.com"); // every set it is eligible for
engine.addNode("https://my.node.example");         // offered once a probe found it eligible

// Real calls feed the rankings; an "Api not found"-class failure (see isApiNotFound) marks the node unsupported at once.
engine.report("lite", node, { ok: true, latencyMs: 120 });
engine.report("lite", node, { ok: false, error: isApiNotFound(err) ? "apiNotFound" : "transport" });

const cookie = engine.serialize();       // e.g. "v=1&s.lite=1": cookie-safe
ssrEngine.hydrate(cookie);               // an SSR render honours the user's choice
```

```tsx
<ApiSetsComponent engine={engine} />
```

* **States.** Per node and set: `eligible`, `unsupported` (the probe said no; trusted for `timing.unsupportedTtlMs`, 6 h by default), `down` (the probe could not answer, or `downAfterFailures` transport errors in a row; probed again after `timing.downCooldownMs`) or `unknown` (not probed yet). A set's `checks` (the `ApiChecker` shape) run in wax's `HealthChecker` against its eligible nodes for latency and errors.
* **Default node.** The first eligible, healthy node in preference order; latency decides only within a rank, or when better ranks are down or degraded (error rate above `maxErrorRate`, or a `freshness` lag above its `maxLag`). The current default is kept until a candidate of its rank is `stickinessMargin` faster (20% by default). Sets in one `group` take one common node when it is among every set's best candidates; otherwise each keeps its own and the group is reported `split`. Before anything is probed the operator's first choice stands in, and the same evidence always gives the same default, so an SSR render and the browser agree.
* **User choice.** Per set, `auto` or one of the set's eligible nodes. While the chosen node is down or unsupported the choice is kept, `bestNode` falls back to the default and `selectionfallback` fires; `selectionrestored` fires when it is back.
