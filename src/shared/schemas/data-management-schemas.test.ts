import { describe, expect, it } from "vitest";

import {
  ArchiveManifestSchema,
  ArchiveMetadataSchema,
  DATA_ARCHIVE_LAYOUT,
  DataArchivePayloadSchema,
  MealPlanPayloadSchema,
  SafePreferencesSchema,
  getArchiveLayoutPaths,
  validateArchivePayloadConsistency,
  validateArchiveLayout,
} from "./data-management-schemas";

const metadata = {
  format: "local-recipe-book",
  formatVersion: 1,
  schemaVersion: 1,
  appVersion: "1.1.1",
  exportedAt: "2026-08-19T12:00:00.000Z",
  scope: "meal-plan" as const,
};

const idPolicy = {
  sourceIds: "preserved" as const,
  importIdMap: "required" as const,
};

describe("data-management archive schemas", () => {
  it("rejects unknown metadata fields", () => {
    expect(
      ArchiveMetadataSchema.safeParse({ ...metadata, unexpected: true }).success
    ).toBe(false);
  });

  it("requires the recipe dependency in a meal-plan layout", () => {
    const result = ArchiveManifestSchema.safeParse({
      ...metadata,
      domains: [
        {
          domain: "meal-plan",
          version: 1,
          path: DATA_ARCHIVE_LAYOUT.domains["meal-plan"],
        },
      ],
      assets: [],
      idPolicy,
    });

    expect(result.success).toBe(false);
  });

  it("keeps scope and canonical layout consistent", () => {
    const paths = getArchiveLayoutPaths("meal-plan", [
      "assets/meal-photos/meal-meal-1.jpg",
    ]);
    const result = validateArchiveLayout("meal-plan", paths);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it("rejects preferences that contain fields outside the safe allowlist", () => {
    const result = SafePreferencesSchema.safeParse({
      householdSize: 2,
      cookingLength: "weeknight",
      dietaryTags: [],
      favoriteCuisines: [],
      avoidCuisines: [],
      avoidIngredients: [],
      pantryStaples: [],
      planningNotes: "",
      nutritionTags: [],
      skillLevel: "home-cook",
      budgetRange: "moderate",
      autoGenerateGrocery: true,
      consolidateIngredients: true,
      defaultPlanLength: "7",
      groceryGrouping: "category",
      defaultRecipeView: "basic",
      defaultUnitMode: "cup",
      reasoningEffort: "high",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields in domain payloads", () => {
    const result = MealPlanPayloadSchema.safeParse({
      domain: "meal-plan",
      version: 1,
      meals: [],
      mealTypeProfiles: [],
      mealTypeDefinitions: [],
      mealSubTypeDefinitions: [],
      unknown: [],
    });

    expect(result.success).toBe(false);
    expect(
      DataArchivePayloadSchema.safeParse({
        domain: "unknown",
        version: 1,
      }).success
    ).toBe(false);
  });

  it("requires meal-plan payloads to close recipe references", () => {
    const payload = MealPlanPayloadSchema.parse({
      domain: "meal-plan",
      version: 1,
      meals: [],
      mealTypeProfiles: [],
      mealTypeDefinitions: [],
      mealSubTypeDefinitions: [],
    });

    const errors = validateArchivePayloadConsistency("meal-plan", [payload]);

    expect(errors.map((error) => error.message)).toContain(
      "Missing payload domain: recipes"
    );
  });

  it("accepts older Pantry archives without daily usage fields but rejects malformed recognized fields", () => {
    const item = {
      id: "pantry-1",
      name: "Milk",
      normalizedName: "milk",
      category: "Dairy",
      stockMode: "track-quantity",
      warningThreshold: null,
      warningUnit: null,
      expirationWarningDays: null,
      replenishmentTarget: null,
      replenishmentUnit: null,
      replenishmentQuantity: null,
      notes: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z",
      aliases: [],
      locations: [],
      packages: [],
      warningRules: [],
    };
    const older = DataArchivePayloadSchema.safeParse({ domain: "pantry", version: 1, historyIncluded: false, items: [item], events: [] });
    expect(older.success).toBe(true);
    if (older.success && older.data.domain === "pantry") expect(older.data.items[0]).toMatchObject({ dailyUsageQuantity: null, dailyUsageUnit: null, dailyUsageWarningDays: null });
    expect(DataArchivePayloadSchema.safeParse({ domain: "pantry", version: 1, historyIncluded: false, items: [{ ...item, dailyUsageQuantity: "one" }], events: [] }).success).toBe(false);
    expect(DataArchivePayloadSchema.safeParse({ domain: "pantry", version: 1, historyIncluded: false, items: [{ ...item, dailyUsageQuantity: 1 }], events: [] }).success).toBe(false);
  });
});
