import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { version as reactVersion } from "react";
import { version as reactDomVersion } from "react-dom";
import { describe, expect, inject, it, vi } from "vitest";
import { HealthCheckerComponent, HealthCheckerService } from "../src";
import type { ApiChecker } from "../src";

declare module "vitest" {
  interface ProvidedContext {
    reactMajor: string;
  }
}

const wax = vi.hoisted(() => {
  type Listener = (payload: unknown) => void;

  class FakeHealthChecker {
    static latest: FakeHealthChecker;
    private listeners = new Map<string, Listener[]>();
    private registered = 0;

    constructor() {
      FakeHealthChecker.latest = this;
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    emit(event: string, payload: unknown) {
      this.listeners.get(event)?.forEach((listener) => listener(payload));
    }

    async register() {
      return { id: this.registered++ };
    }

    unregisterAll() {}

    *[Symbol.iterator]() {}
  }

  return { FakeHealthChecker };
});

vi.mock("@hiveio/wax", () => ({ HealthChecker: wax.FakeHealthChecker }));

const SELECTED = "https://api.hive.blog";
const OTHER = "https://api.openhive.network";

const checkers: ApiChecker[] = [
  { title: "Reputation", method: {}, params: { accounts: ["gtg"] }, validatorFunction: () => true },
];

const renderHealthChecker = () => {
  const changeNodeAddress = vi.fn();
  const service = new HealthCheckerService("test", checkers, [OTHER, SELECTED], SELECTED, changeNodeAddress);
  render(<HealthCheckerComponent healthCheckerService={service} />);
  return { service, changeNodeAddress };
};

describe(`HealthCheckerComponent under React ${inject("reactMajor")}`, () => {
  it("runs on the React version of its project", () => {
    expect(reactVersion.split(".")[0]).toBe(inject("reactMajor"));
    expect(reactDomVersion.split(".")[0]).toBe(inject("reactMajor"));
  });

  it("lists the providers with the selected one first", () => {
    renderHealthChecker();

    expect(screen.getByRole("heading", { name: "Healthchecker for API servers" })).toBeTruthy();
    expect(screen.getAllByTestId("hc-api-name").map((name) => name.textContent)).toEqual([SELECTED, OTHER]);
    expect(screen.getAllByTestId("hc-selected")).toHaveLength(1);
    expect(screen.getAllByTestId("hc-set-api-button")).toHaveLength(1);
    expect(screen.getAllByTestId("hc-validator-badge").map((badge) => badge.textContent)).toEqual([
      "Reputation",
      "Reputation",
    ]);
  });

  it("asks before switching to an unchecked provider", async () => {
    const { changeNodeAddress } = renderHealthChecker();

    fireEvent.click(screen.getByTestId("hc-set-api-button"));
    const dialog = await screen.findByRole("dialog", { name: "Confirm Provider Switch" });
    expect(within(dialog).getByText(OTHER)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(changeNodeAddress).toHaveBeenCalledWith(OTHER);
    expect(screen.getAllByTestId("hc-api-name")[0].textContent).toBe(OTHER);
  });

  it("shows and clears a provider's validation error", async () => {
    const { service } = renderHealthChecker();
    await act(() => service.startCheckingProcess());
    act(() =>
      wax.FakeHealthChecker.latest.emit("validationerror", {
        apiEndpoint: { id: 0, paths: ["reputation_api", "get_account_reputations"] },
        request: { endpoint: OTHER, data: '{"accounts":["gtg"]}' },
        message: "reputation is not a number",
      })
    );

    const otherBadge = () => screen.getAllByTestId("hc-validator-badge")[1];
    fireEvent.click(otherBadge());
    const dialog = await screen.findByRole("dialog", { name: "Reputation validation error" });
    expect(within(dialog).getByText("reputation is not a number")).toBeTruthy();
    expect(within(dialog).getByText("reputation_api/get_account_reputations")).toBeTruthy();
    expect(within(dialog).getByText(/"accounts": \[/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear error" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(otherBadge());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
