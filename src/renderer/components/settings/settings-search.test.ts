import { describe, expect, it } from "vitest";

import { searchSettings, type SettingsSearchItem } from "./settings-search";

const categories = [
  { id: "appearance" as const, label: "Appearance" },
  { id: "general" as const, label: "General" },
];

const items: SettingsSearchItem[] = [
  {
    settingId: "theme",
    categoryId: "appearance",
    label: "Theme",
    description: "Choose the visual appearance",
    keywords: ["dark", "light"],
    targetId: "theme",
  },
  {
    settingId: "updates",
    categoryId: "general",
    label: "Check for updates",
    description: "Update checks when the app starts",
    keywords: ["startup"],
    sectionId: "general",
    targetId: "updates",
  },
];

describe("settings search", () => {
  it("matches labels, descriptions, keywords, and category names", () => {
    expect(searchSettings(items, categories, "theme")[0]?.settingId).toBe("theme");
    expect(searchSettings(items, categories, "visual")[0]?.settingId).toBe("theme");
    expect(searchSettings(items, categories, "startup")[0]?.settingId).toBe("updates");
    expect(searchSettings(items, categories, "appearance")[0]?.matchSource).toBe("category");
  });

  it("returns no results for an empty or unmatched query", () => {
    expect(searchSettings(items, categories, "")).toEqual([]);
    expect(searchSettings(items, categories, "missing")).toEqual([]);
  });

  it("preserves the section target for update results", () => {
    expect(searchSettings(items, categories, "updates")[0]?.sectionId).toBe("general");
  });
});