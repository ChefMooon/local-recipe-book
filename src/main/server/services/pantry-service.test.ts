import { beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapDatabaseMock, publishCommittedChangeMock, prismaMock } = vi.hoisted(() => ({
  bootstrapDatabaseMock: vi.fn().mockResolvedValue(undefined),
  publishCommittedChangeMock: vi.fn().mockResolvedValue(1),
  prismaMock: {
    pantryItem: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    pantryInventoryEvent: { findMany: vi.fn(), create: vi.fn() },
    pantryLocationStock: { upsert: vi.fn(), update: vi.fn() },
    pantryLot: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    pantryPackage: { create: vi.fn(), findUnique: vi.fn() },
    pantryWarningRule: { create: vi.fn() },
    userPreference: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/bootstrap", () => ({ bootstrapDatabase: bootstrapDatabaseMock }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./change-event-bus", () => ({ publishCommittedChange: publishCommittedChangeMock }));

import { PantryService } from "./pantry-service";

const dates = {
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Milk",
    normalizedName: "milk",
    category: "Dairy",
    stockMode: "track-quantity",
    warningThreshold: 1,
    warningUnit: "l",
    expirationWarningDays: 3,
    replenishmentTarget: null,
    replenishmentUnit: null,
    replenishmentQuantity: null,
    notes: null,
    ...dates,
    aliases: [{ id: "alias-1", label: "Whole milk", normalizedAlias: "whole milk" }],
    locations: [{
      id: "location-1",
      location: "Fridge",
      normalizedLocation: "fridge",
      quantity: 0.5,
      unit: "l",
      approximate: false,
      ...dates,
      lots: [],
    }],
    packages: [],
    warningRules: [],
    ...overrides,
  };
}

describe("PantryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches aliases and reports low stock without changing stored order", async () => {
    prismaMock.pantryItem.findMany.mockResolvedValue([
      item({ id: "z-item", name: "Zucchini", normalizedName: "zucchini", aliases: [], locations: [] }),
      item(),
    ]);

    const result = await new PantryService().list({ search: "whole milk", sort: "name", direction: "asc" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "item-1", status: "low", usableQuantity: 0.5 });
    expect(prismaMock.pantryItem.findMany).toHaveBeenCalledOnce();
  });

  it("migrates valid legacy staples once and ignores malformed or duplicate values", async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      pantryStaples: JSON.stringify(["Olive oil", " olive oil ", "", 42, "Garlic"]),
    });
    prismaMock.pantryItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-garlic" });
    prismaMock.pantryItem.create.mockResolvedValue({ id: "created-oil" });

    const created = await new PantryService().migrateLegacyStaples();

    expect(created).toBe(1);
    expect(prismaMock.pantryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Olive oil",
        normalizedName: "olive oil",
        stockMode: "always-available",
      }),
    });
  });

  it("marks expired lots before quantity warnings", async () => {
    prismaMock.pantryItem.findMany.mockResolvedValue([
      item({ locations: [{ ...item().locations[0], lots: [{ quantity: 1, expiresAt: new Date("2020-01-01T00:00:00.000Z"), bestBeforeAt: null, approximate: false, ...dates }] }] }),
    ]);

    const result = await new PantryService().list();

    expect(result[0].status).toBe("expired");
  });

  it("applies a compatible stock action and appends an inventory event", async () => {
    const transaction = {
      pantryItem: { findUnique: vi.fn().mockResolvedValue({ id: "item-1" }) },
      pantryLocationStock: {
        upsert: vi.fn().mockResolvedValue({ id: "location-1", quantity: 1, unit: "l", approximate: false }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      pantryLot: {
        findMany: vi.fn().mockResolvedValue([
          { id: "lot-expiring", quantity: 0.25, unit: "l", expiresAt: new Date("2099-01-03T00:00:00.000Z"), createdAt: dates.createdAt },
          { id: "lot-later", quantity: 1, unit: "l", expiresAt: new Date("2099-02-03T00:00:00.000Z"), createdAt: dates.createdAt },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue(undefined),
      },
      pantryInventoryEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));
    prismaMock.pantryItem.findUnique.mockResolvedValue(item());

    await new PantryService().applyStockAction("item-1", {
      type: "add",
      location: "Fridge",
      quantity: 500,
      unit: "ml",
      approximate: false,
    });

    expect(transaction.pantryLocationStock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 1.5, unit: "l" }),
    }));
    expect(transaction.pantryInventoryEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "add", quantityDelta: 0.5, unit: "ml" }),
    }));
    expect(publishCommittedChangeMock).toHaveBeenCalledWith("pantry", "update", "item-1");
  });

  it("consumes dated lots in expiration order", async () => {
    const transaction = {
      pantryItem: { findUnique: vi.fn().mockResolvedValue({ id: "item-1" }) },
      pantryLocationStock: {
        upsert: vi.fn().mockResolvedValue({ id: "location-1", quantity: 1.25, unit: "l", approximate: false }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      pantryLot: {
        findMany: vi.fn().mockResolvedValue([
          { id: "lot-expiring", quantity: 0.25, unit: "l", expiresAt: new Date("2099-01-03T00:00:00.000Z"), createdAt: dates.createdAt },
          { id: "lot-later", quantity: 1, unit: "l", expiresAt: new Date("2099-02-03T00:00:00.000Z"), createdAt: dates.createdAt },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue(undefined),
      },
      pantryInventoryEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));
    prismaMock.pantryItem.findUnique.mockResolvedValue(item());

    await new PantryService().applyStockAction("item-1", {
      type: "consume",
      location: "Fridge",
      quantity: 0.5,
      unit: "l",
      approximate: false,
    });

    expect(transaction.pantryLot.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "lot-expiring" },
      data: { quantity: 0 },
    }));
    expect(transaction.pantryLot.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "lot-later" },
      data: { quantity: 0.75 },
    }));
  });

  it("rejects dated lots with units incompatible with their location", async () => {
    const transaction = {
      pantryItem: { findUnique: vi.fn().mockResolvedValue({ id: "item-1" }) },
      pantryLocationStock: { upsert: vi.fn().mockResolvedValue({ id: "location-1", quantity: 1, unit: "l", approximate: false }), update: vi.fn() },
      pantryLot: { create: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));

    await expect(new PantryService().addLot("item-1", { location: "Fridge", quantity: 1, unit: "kg" })).rejects.toThrow("incompatible");
    expect(transaction.pantryLot.create).not.toHaveBeenCalled();
  });

  it("adds dated-lot quantity to the selected location stock", async () => {
    const transaction = {
      pantryItem: { findUnique: vi.fn().mockResolvedValue({ id: "item-1" }) },
      pantryLocationStock: { upsert: vi.fn().mockResolvedValue({ id: "location-1", quantity: 0, unit: "l", approximate: false }), update: vi.fn().mockResolvedValue(undefined) },
      pantryLot: { create: vi.fn().mockResolvedValue({ id: "lot-1" }) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));

    await new PantryService().addLot("item-1", { location: "Fridge", quantity: 500, unit: "ml" });

    expect(transaction.pantryLocationStock.update).toHaveBeenCalledWith({ where: { id: "location-1" }, data: { quantity: 0.5, unit: "l", approximate: false } });
    expect(transaction.pantryLot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 500, unit: "ml" }) }));
  });

  it("removes a dated lot, adjusts stock, and records the discard event", async () => {
    const transaction = {
      pantryLot: {
        findUnique: vi.fn().mockResolvedValue({ id: "lot-1", quantity: 0.5, unit: "l", approximate: false, locationStockId: "location-1", locationStock: { id: "location-1", itemId: "item-1", quantity: 1, unit: "l" } }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      pantryLocationStock: { update: vi.fn().mockResolvedValue(undefined) },
      pantryInventoryEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));

    await new PantryService().removeLot("item-1", "lot-1");

    expect(transaction.pantryLocationStock.update).toHaveBeenCalledWith({ where: { id: "location-1" }, data: { quantity: 0.5 } });
    expect(transaction.pantryInventoryEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "discard", quantityDelta: -0.5, lotId: "lot-1" }) }));
    expect(transaction.pantryLot.delete).toHaveBeenCalledWith({ where: { id: "lot-1" } });
  });
});
