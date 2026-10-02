import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

// React reports elements from another React, removed APIs and act() misuse through these.
beforeEach(() => {
  vi.spyOn(console, "error");
  vi.spyOn(console, "warn");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  const errors = vi.mocked(console.error).mock.calls;
  const warnings = vi.mocked(console.warn).mock.calls;
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
  expect(warnings).toEqual([]);
});
