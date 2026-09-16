import { beforeEach, describe, expect, it, vi } from "vitest";

const { pantryItemMock } = vi.hoisted(() => ({
  pantryItemMock: {
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: { pantryItem: pantryItemMock } }));

import { calculatePantryRequirement, comparePantryQuantity, matchPantryCandidate } from "./pantry-calculation";

describe("Pantry grocery calculation", () => {
  beforeEach(() => pantryItemMock.findMany.mockReset());

  it("subtracts compatible exact stock and preserves the exact shortfall", () => {
    expect(comparePantryQuantity(1000, "g", [{ quantity: 0.5, unit: "kg", approximate: false }])).toEqual({
      quantity: 500,
      explanation: null,
    });
  });

  it("does not subtract approximate or incompatible stock", () => {
    expect(comparePantryQuantity(2, "cup", [{ quantity: 1, unit: "kg", approximate: false }]).quantity).toBe(2);
    expect(comparePantryQuantity(2, "cup", [{ quantity: 1, unit: "cup", approximate: true }]).quantity).toBe(2);
  });

  it("matches aliases and refuses ambiguous fuzzy decisions", () => {
    const candidates = [
      { id: "milk", name: "Whole Milk", normalizedName: "whole milk", stockMode: "track-quantity", aliases: [{ normalizedAlias: "dairy milk" }], locations: [], packages: [], replenishmentTarget: null, replenishmentUnit: null },
      { id: "milk-2", name: "Oat Milk", normalizedName: "oat milk", stockMode: "track-quantity", aliases: [{ normalizedAlias: "dairy milk" }], locations: [], packages: [], replenishmentTarget: null, replenishmentUnit: null },
    ];
    expect(matchPantryCandidate("Dairy Milk", candidates).status).toBe("ambiguous");
    expect(matchPantryCandidate("Whole Milk", candidates).item?.id).toBe("milk");
  });

  it("reads Pantry state without mutating rows or events", async () => {
    pantryItemMock.findMany.mockResolvedValue([
      {
        id: "flour",
        name: "Flour",
        normalizedName: "flour",
        stockMode: "track-quantity",
        aliases: [],
        locations: [{ quantity: 250, unit: "g", approximate: false }],
        packages: [],
        replenishmentTarget: null,
        replenishmentUnit: null,
      },
    ]);

    const result = await calculatePantryRequirement("flour", 500, "g");

    expect(result.quantity).toBe(250);
    expect(pantryItemMock.update).not.toHaveBeenCalled();
    expect(pantryItemMock.delete).not.toHaveBeenCalled();
  });

  it("skips always-available Pantry items instead of proposing stock", async () => {
    pantryItemMock.findMany.mockResolvedValue([
      {
        id: "oil",
        name: "Olive Oil",
        normalizedName: "olive oil",
        stockMode: "always-available",
        aliases: [],
        locations: [],
        packages: [],
        replenishmentTarget: null,
        replenishmentUnit: null,
      },
    ]);

    const result = await calculatePantryRequirement("Olive Oil", 1, "bottle");

    expect(result.quantity).toBeNull();
    expect(result.explanation).toBe("Always-available Pantry item skipped.");
    expect(result.match.item?.stockMode).toBe("always-available");
  });
});