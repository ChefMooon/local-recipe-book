import { describe, expect, it } from "vitest";
import {
  PantryPackageInputSchema,
  PantryQuerySchema,
  CreatePantryItemSchema,
  PantryLotInputSchema,
  PantryStockActionSchema,
  normalizePantryIdentity,
  normalizePantryUnit,
} from "./pantry-schemas";

describe("Pantry shared schemas", () => {
  it("normalizes identity whitespace and canonical unit aliases", () => {
    expect(normalizePantryIdentity("  Whole   Milk ")).toBe("whole milk");
    expect(normalizePantryUnit("Tablespoons")).toBe("tbsp");
    expect(PantryQuerySchema.parse({}).filter).toBe("all");
  });

  it("rejects package dimensions that do not match canonical units", () => {
    const result = PantryPackageInputSchema.safeParse({
      label: "Bottle",
      quantity: 1,
      unit: "l",
      dimension: "weight",
    });

    expect(result.success).toBe(false);
  });

  it("allows confirmed custom label units without approximate conversion", () => {
    const result = PantryPackageInputSchema.parse({
      label: "Tin",
      quantity: 1,
      unit: "tin",
      dimension: "custom",
      confirmed: true,
    });

    expect(result).toMatchObject({ unit: "tin", dimension: "custom", confirmed: true });
  });

  it("requires daily usage quantity and unit together", () => {
    expect(CreatePantryItemSchema.safeParse({ name: "Milk", dailyUsageQuantity: 1 }).success).toBe(false);
    expect(CreatePantryItemSchema.parse({ name: "Milk", dailyUsageQuantity: 1, dailyUsageUnit: "l", dailyUsageWarningDays: 7 }))
      .toMatchObject({ dailyUsageQuantity: 1, dailyUsageUnit: "l", dailyUsageWarningDays: 7 });
  });

  it("rejects non-positive daily usage and negative warning days", () => {
    expect(CreatePantryItemSchema.safeParse({ name: "Milk", dailyUsageQuantity: 0, dailyUsageUnit: "l" }).success).toBe(false);
    expect(CreatePantryItemSchema.safeParse({ name: "Milk", dailyUsageQuantity: 1, dailyUsageUnit: "l", dailyUsageWarningDays: -1 }).success).toBe(false);
  });

  it("defaults dated-lot locations and normalizes their units", () => {
    expect(PantryLotInputSchema.parse({ quantity: 2, unit: "Liters" })).toMatchObject({ location: "Unspecified", unit: "l" });
  });

  it("accepts explicit stock source selection", () => {
    expect(PantryStockActionSchema.parse({ type: "consume", location: "Cupboard", quantity: 1, unit: "bottle", source: { type: "lot", lotId: "lot-1" } }).source)
      .toEqual({ type: "lot", lotId: "lot-1" });
  });
});
