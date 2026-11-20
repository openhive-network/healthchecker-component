import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiSetEngine, ApiSetsComponent, jsonRpcApiProbe, jsonRpcMethodProbe } from "../src";
import type { ApiSetsLabels } from "../src";
import { BRIDGE_PROBE, HIVE, hiveBlog, stubTransport, SYNCAD, syncad } from "./stubTransport";

vi.mock("@hiveio/wax", () => ({ HealthChecker: class {} }));

const POLISH: ApiSetsLabels = {
  heading: "Serwery API według zestawu API",
  automaticChoice: "Wybór automatyczny",
  yourChoiceOf: "Twój wybór: {{node}}",
  useAutomaticChoice: "Wybieraj automatycznie",
  fallbackNotice: "Węzeł {{selected}} jest niedostępny dla zestawu {{set}}; do czasu jego powrotu używany jest {{node}}.",
  noNode: "żaden węzeł",
  groupSplit: "Żaden węzeł nie obsługuje wszystkich zestawów ({{sets}}): {{nodes}}.",
  groupSplitSet: "{{set}} → {{node}}",
  listSeparator: "; ",
  stateEligible: "obsługuje",
  stateUnsupported: "nie obsługuje",
  stateDown: "niedostępny",
  stateUnknown: "nieznany",
  stateDegraded: "pogorszony",
  defaultBadge: "Domyślny",
  yourChoiceBadge: "Twój wybór",
  inUse: "W użyciu",
  median: "Mediana: {{value}}",
  p95: "95. percentyl: {{value}}",
  errors: "Błędy: {{value}} %",
  lag: "Opóźnienie: {{value}}",
  milliseconds: "{{value}} ms",
  noValue: "brak",
  use: "Użyj",
  useEverywhere: "Użyj wszędzie, gdzie obsługuje",
  removeNode: "Usuń {{node}}",
  addNodeTitle: "Dodaj własny węzeł:",
  addNodeHint: "Podaj adres własnego węzła Hive.",
  addNodePlaceholder: "(np. https://example.com)",
  addNodeButton: "Dodaj",
  addNodeInvalidUrl: "Podaj poprawny adres (zaczynający się od http:// lub https://)",
};

const ENGLISH = /\b(servers?|set|Use|use|choice|Automatic|Default|In use|Median|p95|Errors|Lag|eligible|unsupported|down|unknown|degraded|unavailable|until|recovers|single|serves|everything|Add|Custom|Enter|valid|URL|Remove|no node|Bridge|Lite|accounts)\b/;
/** Everything a user reads or hears, without the node URLs (data, not text). */
const userFacingText = (root: HTMLElement) =>
  [
    root.textContent ?? "",
    ...[...root.querySelectorAll("[aria-label]")].map((element) => element.getAttribute("aria-label")),
    ...[...root.querySelectorAll("[placeholder]")].map((element) => element.getAttribute("placeholder")),
  ]
    .join("\n")
    .replace(/https?:\/\/[^\s;,)]+/g, "");

const buildEngine = () => {
  const { transport } = stubTransport({ [HIVE]: hiveBlog(), [SYNCAD]: syncad() });
  const engine = new ApiSetEngine({
    nodes: [HIVE, SYNCAD],
    sets: [
      { id: "bridge", title: "Bridge", probe: jsonRpcApiProbe(BRIDGE_PROBE.method, BRIDGE_PROBE.params), group: "hivemind" },
      { id: "lite", title: "Lite accounts", probe: jsonRpcMethodProbe("lite.get_info"), group: "hivemind" },
    ],
    transport,
  });
  return engine;
};

const renderApiSets = async (props: Omit<ComponentProps<typeof ApiSetsComponent>, "engine"> = {}) => {
  const engine = buildEngine();
  const { container } = render(<ApiSetsComponent engine={engine} {...props} />);
  await act(() => engine.refresh());
  return { engine, container };
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
    const { engine } = await renderApiSets();

    fireEvent.click(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-use"));
    expect(engine.selection("bridge")).toBe(SYNCAD);
    expect(screen.getByTestId("hc-set-selection").textContent).toBe(`Your choice: ${SYNCAD}`);
    expect(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-active")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use automatic choice" }));
    expect(engine.selection("bridge")).toBe("auto");
    expect(within(nodeCard(HIVE)).getByTestId("hc-set-node-active")).toBeTruthy();
  });

  it("tells the user when their node is unavailable", async () => {
    const { engine } = await renderApiSets();
    fireEvent.click(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-use"));

    act(() => {
      engine.report("bridge", SYNCAD, { ok: false, error: "apiNotFound", message: "Could not find API bridge" });
    });
    expect(screen.getByTestId("hc-set-fallback").textContent).toBe(
      `${SYNCAD} is unavailable for Bridge; using ${HIVE} until it recovers.`,
    );
  });

  it("renders the caller's labels and set titles instead of the English text", async () => {
    const { engine, container } = await renderApiSets({
      labels: POLISH,
      setTitles: { bridge: "Most", lite: "Konta uproszczone" },
    });
    act(() => {
      engine.report("bridge", HIVE, { ok: true, latencyMs: 120 });
      engine.report("bridge", HIVE, { ok: false, error: "transport" });
    });

    expect(screen.getByRole("heading").textContent).toBe(POLISH.heading);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Most", "Konta uproszczone"]);
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Most");
    expect(screen.getByTestId("hc-set-group-split").textContent).toBe(
      `Żaden węzeł nie obsługuje wszystkich zestawów (Most; Konta uproszczone): Most → ${HIVE}; Konta uproszczone → ${SYNCAD}.`,
    );
    expect(screen.getByTestId("hc-set-selection").textContent).toBe("Wybór automatyczny");
    expect(within(nodeCard(HIVE)).getByTestId("hc-set-node-state").textContent).toBe("obsługuje");
    expect(within(nodeCard(HIVE)).getByText("Mediana: 120 ms")).toBeTruthy();
    expect(within(nodeCard(HIVE)).getByText("Błędy: 50 %")).toBeTruthy();
    expect(within(nodeCard(SYNCAD)).getByText("Mediana: brak")).toBeTruthy();
    expect(userFacingText(container)).not.toMatch(ENGLISH);

    fireEvent.click(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-use"));
    expect(screen.getByTestId("hc-set-selection").textContent).toBe(`Twój wybór: ${SYNCAD}`);
    act(() => {
      engine.report("bridge", SYNCAD, { ok: false, error: "apiNotFound", message: "Could not find API bridge" });
    });
    expect(screen.getByTestId("hc-set-fallback").textContent).toBe(
      `Węzeł ${SYNCAD} jest niedostępny dla zestawu Most; do czasu jego powrotu używany jest ${HIVE}.`,
    );
    expect(within(nodeCard(SYNCAD)).getByTestId("hc-set-node-state").textContent).toBe("nie obsługuje");
    expect(screen.getByRole("button", { name: POLISH.useAutomaticChoice })).toBeTruthy();

    fireEvent.change(screen.getByTestId("api-address-input"), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: POLISH.addNodeButton }));
    expect(screen.getByText(POLISH.addNodeInvalidUrl)).toBeTruthy();

    // A node's `reason` is the probe's own diagnostic, shown verbatim; everything else is the caller's text.
    for (const reason of container.querySelectorAll("p.text-xs")) reason.remove();
    expect(userFacingText(container)).not.toMatch(ENGLISH);
  });

  it("keeps the English for a label the caller leaves out", async () => {
    await renderApiSets({ labels: { heading: "Serwery API" } });

    expect(screen.getByRole("heading").textContent).toBe("Serwery API");
    expect(screen.getByTestId("hc-set-selection").textContent).toBe("Automatic choice");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Bridge", "Lite accounts"]);
  });
});
