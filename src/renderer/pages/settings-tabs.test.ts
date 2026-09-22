// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  getInitialSettingsTabId,
  getNextSettingsTabId,
  getStoredSettingsTabId,
  isUpdateSettingsNavigationState,
} from "./settings";

describe("Settings tab keyboard navigation", () => {
  it("cycles through the persisted tab order with arrow keys", () => {
    expect(getNextSettingsTabId(0, "ArrowLeft")).toBe("data-management");
    expect(getNextSettingsTabId(5, "ArrowRight")).toBe("general");
    expect(getNextSettingsTabId(2, "ArrowRight")).toBe("meal-plans");
    expect(getNextSettingsTabId(2, "ArrowLeft")).toBe("appearance");
  });

  it("supports Home and End and ignores unrelated keys", () => {
    expect(getNextSettingsTabId(3, "Home")).toBe("general");
    expect(getNextSettingsTabId(0, "End")).toBe("data-management");
    expect(getNextSettingsTabId(2, "Enter")).toBeNull();
  });

  it("maps the legacy app-settings value and falls back safely", () => {
    expect(getInitialSettingsTabId("app-settings")).toBe("general");
    expect(getInitialSettingsTabId("unknown")).toBe("general");
    expect(getInitialSettingsTabId(null)).toBe("general");
  });

  it("reads the active tab from the provided session storage", () => {
    const storage = {
      getItem: (key: string) =>
        key === "settings-active-tab" ? "appearance" : null,
    };

    expect(getStoredSettingsTabId(storage)).toBe("appearance");
  });

  it("recognizes the update toast destination state", () => {
    expect(isUpdateSettingsNavigationState({ focus: "updates" })).toBe(true);
    expect(isUpdateSettingsNavigationState({ focus: "general" })).toBe(false);
    expect(isUpdateSettingsNavigationState(null)).toBe(false);
  });
});
