import { beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapDatabaseMock, prismaMock } = vi.hoisted(() => ({
  bootstrapDatabaseMock: vi.fn().mockResolvedValue(undefined),
  prismaMock: {
    pantryAttention: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    pantryGroceryLink: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    groceryItem: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/bootstrap", () => ({ bootstrapDatabase: bootstrapDatabaseMock }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import { PantryAttentionService } from "./pantry-attention-service";

const dates = {
  createdAt: new Date("2026-09-15T00:00:00.000Z"),
  updatedAt: new Date("2026-09-15T00:00:00.000Z"),
};

function attention(overrides: Record<string, unknown> = {}) {
  return {
    id: "attention-1",
    pantryItemId: "pantry-1",
    source: "snooze",
    expiresAt: new Date("2026-09-22T00:00:00.000Z"),
    groceryLinkId: null,
    operationIdentity: "operation-1",
    reviewIdentity: null,
    active: true,
    closedAt: null,
    closeReason: null,
    ...dates,
    ...overrides,
  };
}

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    pantryItemId: "pantry-1",
    groceryItemId: "grocery-item-1",
    status: "active",
    active: true,
    operationIdentity: "link-operation-1",
    reviewIdentity: null,
    closedAt: null,
    closeReason: null,
    ...dates,
    ...overrides,
  };
}

describe("PantryAttentionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it("replaces the active attention source while retaining idempotency fields", async () => {
    prismaMock.pantryAttention.findUnique.mockResolvedValue(null);
    prismaMock.pantryAttention.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.pantryAttention.create.mockResolvedValue(attention({ source: "until-restocked", expiresAt: null, operationIdentity: "operation-2" }));

    const result = await new PantryAttentionService().setAttention("pantry-1", {
      source: "until-restocked",
      operationIdentity: "operation-2",
      reviewIdentity: "review-2",
    });

    expect(prismaMock.pantryAttention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pantryItemId: "pantry-1", active: true },
    }));
    expect(prismaMock.pantryAttention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operationIdentity: "operation-2", reviewIdentity: "review-2", active: true }),
    }));
    expect(result).toMatchObject({ source: "until-restocked", operationIdentity: "operation-2" });
  });

  it("returns the persisted active attention after a later read", async () => {
    prismaMock.pantryAttention.findFirst.mockResolvedValue(attention());

    const result = await new PantryAttentionService().getAttention("pantry-1");

    expect(result).toMatchObject({ id: "attention-1", pantryItemId: "pantry-1", active: true });
    expect(prismaMock.pantryAttention.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { pantryItemId: "pantry-1", active: true },
    }));
  });

  it("replaces one active grocery link and returns the exact grocery ID", async () => {
    prismaMock.pantryGroceryLink.findUnique.mockResolvedValue(null);
    prismaMock.groceryItem.findUnique.mockResolvedValue({ id: "grocery-item-2" });
    prismaMock.pantryGroceryLink.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.pantryGroceryLink.create.mockResolvedValue(link({ groceryItemId: "grocery-item-2", operationIdentity: "link-operation-2" }));

    const result = await new PantryAttentionService().createGroceryLink("pantry-1", {
      groceryItemId: "grocery-item-2",
      operationIdentity: "link-operation-2",
      reviewIdentity: "review-2",
    });

    expect(prismaMock.pantryGroceryLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pantryItemId: "pantry-1", active: true },
    }));
    expect(result).toMatchObject({ groceryItemId: "grocery-item-2", operationIdentity: "link-operation-2" });
    expect(prismaMock.pantryAttention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: "grocery-link", groceryLinkId: result.id, active: true }),
    }));
  });

  it("closes linked attention when checking without changing Pantry stock", async () => {
    prismaMock.pantryGroceryLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(link());
    prismaMock.pantryGroceryLink.update.mockResolvedValue(link({ status: "checked", active: false }));
    prismaMock.pantryAttention.findUnique.mockResolvedValue(null);

    const result = await new PantryAttentionService().updateGroceryLinkLifecycle({
      linkId: "link-1",
      status: "checked",
      operationIdentity: "check-operation-1",
      reviewIdentity: "review-1",
    });

    expect(result).toMatchObject({ status: "checked", active: false });
    expect(prismaMock.pantryAttention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pantryItemId: "pantry-1", groceryLinkId: "link-1", active: true },
      data: expect.objectContaining({ closeReason: "checked", reviewIdentity: "review-1" }),
    }));
  });

  it("replays an idempotent link operation without creating a duplicate", async () => {
    prismaMock.pantryGroceryLink.findUnique.mockResolvedValue(link());

    const result = await new PantryAttentionService().createGroceryLink("pantry-1", {
      groceryItemId: "grocery-item-1",
      operationIdentity: "link-operation-1",
    });

    expect(result.id).toBe("link-1");
    expect(prismaMock.pantryGroceryLink.create).not.toHaveBeenCalled();
  });

  it("replays a lifecycle operation without applying it to a later state", async () => {
    prismaMock.pantryGroceryLink.findUnique.mockResolvedValue(link({ status: "checked", active: false }));

    const result = await new PantryAttentionService().updateGroceryLinkLifecycle({
      linkId: "link-1",
      status: "removed",
      operationIdentity: "link-operation-1",
    });

    expect(result).toMatchObject({ id: "link-1", status: "checked", active: false });
    expect(prismaMock.pantryGroceryLink.update).not.toHaveBeenCalled();
  });

  it("clears only the targeted active attention", async () => {
    prismaMock.pantryAttention.updateMany.mockResolvedValue({ count: 1 });

    await new PantryAttentionService().clearAttention("pantry-1", {
      attentionId: "attention-1",
      operationIdentity: "clear-operation-1",
    });

    expect(prismaMock.pantryAttention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attention-1", pantryItemId: "pantry-1", active: true },
    }));
  });

  it("stores a fixed seven-day snooze regardless of the requested expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    prismaMock.pantryAttention.findUnique.mockResolvedValue(null);
    prismaMock.pantryAttention.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.pantryAttention.create.mockResolvedValue(attention({ expiresAt: new Date("2026-09-22T00:00:00.000Z") }));

    await new PantryAttentionService().setAttention("pantry-1", {
      source: "snooze",
      expiresAt: "2099-01-01T00:00:00.000Z",
      operationIdentity: "operation-snooze",
    });

    expect(prismaMock.pantryAttention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiresAt: new Date("2026-09-22T00:00:00.000Z") }),
    }));
    vi.useRealTimers();
  });

  it("clears until-restocked on any positive usable-quantity increase", async () => {
    prismaMock.pantryAttention.updateMany.mockResolvedValue({ count: 1 });

    await expect(new PantryAttentionService().reconcileRestock("pantry-1", 0, 0.25)).resolves.toEqual({ cleared: true });
    expect(prismaMock.pantryAttention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pantryItemId: "pantry-1", source: "until-restocked", active: true },
      data: expect.objectContaining({ closeReason: "restocked" }),
    }));
  });

  it("does not clear until-restocked when usable quantity is reduced or unchanged", async () => {
    await expect(new PantryAttentionService().reconcileRestock("pantry-1", 1, 0.5)).resolves.toEqual({ cleared: false });
    await expect(new PantryAttentionService().reconcileRestock("pantry-1", 1, 1)).resolves.toEqual({ cleared: false });
    expect(prismaMock.pantryAttention.updateMany).not.toHaveBeenCalled();
  });
});