import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiSetEngine, ApiSetsComponent, jsonRpcMethodProbe, jsonRpcNamespaceProbe } from "../src";
import { HIVE, liteInfo, liteNotFound, methods, stubTransport, SYNCAD } from "./stubTransport";

vi.mock("@hiveio/wax", () => ({ HealthChecker: class {} }));

const renderApiSets = async () => {
  const { transport } = stubTransport({
    [HIVE]: { rpc: { "jsonrpc.get_methods": methods("bridge.get_post"), "lite.get_info": liteNotFound } },
    [SYNCAD]: { rpc: { "jsonrpc.get_methods": methods("bridge.get_post", "lite.get_info"), "lite.get_info": liteInfo } },
  });
  const engine = new ApiSetEngine({
    nodes: [HIVE, SYNCAD],
    sets: [
      { id: "bridge", title: "Bridge", probe: jsonRpcNamespaceProbe("bridge"), group: "hivemind" },
      { id: "lite", title: "Lite accounts", probe: jsonRpcMethodProbe("lite.get_info"), group: "hivemind" },
    ],
    transport,
  });
  render(<ApiSetsComponent engine={engine} />);
  await act(() => engine.refresh());
  return engine;
};

const nodeCard = (node: string) =>
  screen.getAllByTestId("hc-set-node").find((card) => within(card).getByTestId("hc-set-node-url").textContent === node)!;

describe("ApiSetsComponent", () => {
  it("shows one tab per API set with its nodes ranked and the group split", async () => {
    await renderApiSets();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Bridge", "Lite accounts"]);
    expect(screen.getByTestId("hc-set-group-split").textContent).toContain(`bridge uses ${HIVE}, lite uses ${SYNCAD}`);
    expect(screen.getAllByTestId("hc-set-node-url").map((url) => url.textContent)).toEqual([HIVE, SYNCAD]);

    fireEvent.click(screen.getByRole("tab", { name: "Lite accounts" }));
    expect(screen.getAllByTestId("hc-set-node-url").map((url) => url.textContent)).toEqual([SYNCAD, HIVE]);
    expect(within(nodeCard(HIVE)).getByTestId("hc-set-node-state").textContent).toBe("unsupported");
    expect(within(nodeCard(HIVE)).queryByTestId("hc-set-node-use")).toBeNull();
    expect(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-active")).toBeTruthy();
  });

  it("lets the user pick an eligible node for a set and go back to automatic", async () => {
    const engine = await renderApiSets();

    fireEvent.click(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-use"));
    expect(engine.selection("bridge")).toBe(SYNCAD);
    expect(screen.getByTestId("hc-set-selection").textContent).toBe(`Your choice: ${SYNCAD}`);
    expect(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-active")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use automatic choice" }));
    expect(engine.selection("bridge")).toBe("auto");
    expect(within(nodeCard(HIVE)).getByTestId("hc-set-node-active")).toBeTruthy();
  });

  it("tells the user when their node is unavailable", async () => {
    const engine = await renderApiSets();
    fireEvent.click(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-use"));

    act(() => {
      engine.report("bridge", SYNCAD, { ok: false, error: "apiNotFound", message: "Could not find API bridge" });
    });
    expect(screen.getByTestId("hc-set-fallback").textContent).toBe(
      `${SYNCAD} is unavailable for Bridge; using ${HIVE} until it recovers.`,
    );
  });
});
