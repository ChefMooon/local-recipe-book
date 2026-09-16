import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, publishCommittedChangeMock } = vi.hoisted(() => ({
  prismaMock: {
    pantryItem: { findMany: vi.fn() },
    pantryLocationStock: { findMany: vi.fn(), update: vi.fn() },
    pantryDailyUsageState: { create: vi.fn(), update: vi.fn() },
    pantryInventoryEvent: { findUnique: vi.fn(), create: vi.fn() },
    pantryLot: { update: vi.fn() },
    $transaction: vi.fn(),
  },
  publishCommittedChangeMock: vi.fn().mockResolvedValue(1),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./change-event-bus", () => ({ publishCommittedChange: publishCommittedChangeMock }));

import { localDateKey, reconcilePantryDailyUsage } from "./pantry-daily-usage";

describe("pantry daily usage reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.pantryInventoryEvent.findUnique.mockResolvedValue(null);
    prismaMock.pantryInventoryEvent.create.mockResolvedValue(undefined);
    prismaMock.pantryDailyUsageState.update.mockResolvedValue(undefined);
    prismaMock.pantryLocationStock.findMany.mockResolvedValue([
      { id: "location-1", normalizedLocation: "pantry", quantity: 2, unit: "count", lots: [] },
    ]);
    prismaMock.pantryLot.update.mockResolvedValue(undefined);
  });

  it("uses the configured launch as a baseline and consumes on the next local day", async () => {
    prismaMock.pantryItem.findMany
      .mockResolvedValueOnce([{
        id: "item-1",
        dailyUsageQuantity: 1,
        dailyUsageUnit: "count",
        dailyUsageState: {
          id: "state-1",
          configRevision: 1,
          baselineLocalDate: "2026-09-15",
          lastAppliedLocalDate: "2026-09-15",
        },
      }])
      .mockResolvedValueOnce([{
        id: "item-1",
        dailyUsageQuantity: 1,
        dailyUsageUnit: "count",
        dailyUsageState: {
          id: "state-1",
          configRevision: 1,
          baselineLocalDate: "2026-09-15",
          lastAppliedLocalDate: "2026-09-15",
        },
      }]);

    await reconcilePantryDailyUsage(new Date("2026-09-15T12:00:00.000Z"));
    expect(prismaMock.pantryInventoryEvent.create).not.toHaveBeenCalled();

    await reconcilePantryDailyUsage(new Date("2026-09-16T12:00:00.000Z"));
    expect(prismaMock.pantryInventoryEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "consume",
        quantityDelta: -1,
        sourceType: "automatic-daily-usage",
        sourceIdentity: "pantry-daily-usage:item-1:1:2026-09-16",
      }),
    }));
    expect(prismaMock.pantryDailyUsageState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastAppliedLocalDate: "2026-09-16" },
    }));
    expect(publishCommittedChangeMock).toHaveBeenCalledWith("pantry", "update", "item-1");
  });

  it("does not reconcile again when the state already reached today", async () => {
    prismaMock.pantryItem.findMany.mockResolvedValue([{
      id: "item-1",
      dailyUsageQuantity: 1,
      dailyUsageUnit: "count",
      dailyUsageState: {
        id: "state-1",
        configRevision: 1,
        baselineLocalDate: "2026-09-16",
        lastAppliedLocalDate: "2026-09-16",
      },
    }]);

    await reconcilePantryDailyUsage(new Date("2026-09-16T12:00:00.000Z"));

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(publishCommittedChangeMock).not.toHaveBeenCalled();
  });

  it("baselines an existing configured item that has no reconciliation state", async () => {
    prismaMock.pantryItem.findMany.mockResolvedValue([{
      id: "item-1",
      dailyUsageQuantity: 1,
      dailyUsageUnit: "count",
      dailyUsageState: null,
    }]);

    await reconcilePantryDailyUsage(new Date("2026-09-16T12:00:00.000Z"));

    expect(prismaMock.pantryDailyUsageState.create).toHaveBeenCalledWith({
      data: { itemId: "item-1", baselineLocalDate: "2026-09-16", lastAppliedLocalDate: "2026-09-16" },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("formats dates from local calendar components", () => {
    expect(localDateKey(new Date(2026, 8, 16, 23, 59, 0))).toBe("2026-09-16");
  });
});
