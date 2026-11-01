// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_PROBE, HIVE, hiveBlog, stubTransport, SYNCAD, syncad } from "./stubTransport";

// Importing any of these from the engine entry fails the import: a server must not need them.
const forbidden = vi.hoisted(() => (name: string) => () => {
  throw new Error(`the engine entry imported ${name}`);
});
vi.mock("react", forbidden("react"));
vi.mock("react/jsx-runtime", forbidden("react/jsx-runtime"));
vi.mock("react-dom", forbidden("react-dom"));
vi.mock("@radix-ui/react-dialog", forbidden("@radix-ui/react-dialog"));
vi.mock("@radix-ui/react-slot", forbidden("@radix-ui/react-slot"));
vi.mock("lucide-react", forbidden("lucide-react"));
vi.mock("@hiveio/wax", () => ({ HealthChecker: class {} }));

describe("the engine entry", () => {
  it("imports in Node without React and runs an engine", async () => {
    const entry = await import("../src/engine");
    expect(entry).not.toHaveProperty("ApiSetsComponent");
    expect(entry).not.toHaveProperty("HealthCheckerComponent");

    const engine = new entry.ApiSetEngine({
      nodes: [HIVE, SYNCAD],
      sets: [
        { id: "bridge", title: "Bridge", probe: entry.jsonRpcApiProbe(BRIDGE_PROBE.method, BRIDGE_PROBE.params) },
        { id: "lite", title: "Lite", probe: entry.jsonRpcApiProbe("lite.get_info") },
      ],
      transport: stubTransport({ [HIVE]: hiveBlog(), [SYNCAD]: syncad() }).transport,
      storage: entry.memoryStorage(),
    });
    await engine.refresh();
    expect(engine.bestNode("bridge")).toBe(HIVE);
    expect(engine.bestNode("lite")).toBe(SYNCAD);
  });
});
