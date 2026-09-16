import { beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapDatabaseMock, publishCommittedChangeMock, prismaMock, pantryServiceMock, pantryAttentionServiceMock } = vi.hoisted(() => ({
  bootstrapDatabaseMock: vi.fn().mockResolvedValue(undefined),
  publishCommittedChangeMock: vi.fn().mockResolvedValue(1),
  prismaMock: {
    groceryList: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    groceryItem: { aggregate: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    pantryGroceryLink: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  pantryServiceMock: { get: vi.fn(), list: vi.fn(), create: vi.fn(), applyStockAction: vi.fn() },
  pantryAttentionServiceMock: { getGroceryLinkByOperation: vi.fn(), createGroceryLink: vi.fn(), updateGroceryLinkLifecycle: vi.fn() },
}));

vi.mock("../lib/bootstrap", () => ({ bootstrapDatabase: bootstrapDatabaseMock }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./change-event-bus", () => ({ publishCommittedChange: publishCommittedChangeMock }));
vi.mock("./pantry-service", () => ({ pantryService: pantryServiceMock }));
vi.mock("./pantry-attention-service", () => ({ pantryAttentionService: pantryAttentionServiceMock }));

import { GroceryService } from "./grocery-service";

const dates = {
  createdAt: new Date("2026-09-15T00:00:00.000Z"),
  updatedAt: new Date("2026-09-15T00:00:00.000Z"),
};

function list(items: Array<Record<string, unknown>> = []) {
  return { id: "list-1", name: "Ongoing", date: null, favourite: false, ...dates, items };
}

function item(id: string, name: string, checked = false) {
  return { id, groceryListId: "list-1", name, qty: null, unit: null, category: "Pantry", notes: null, meal: null, checked, sortOrder: 0 };
}

function link(overrides: Record<string, unknown> = {}) {
  return { id: "link-1", pantryItemId: "pantry-milk", groceryItemId: "grocery-milk", status: "active", active: true, operationIdentity: "pantry-action-1", reviewIdentity: null, ...dates, ...overrides };
}

describe("GroceryService Pantry lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pantryGroceryLink.findMany.mockResolvedValue([]);
    prismaMock.pantryGroceryLink.findFirst.mockResolvedValue(null);
    prismaMock.groceryList.findMany.mockResolvedValue([]);
    prismaMock.groceryList.findUnique.mockResolvedValue(null);
    prismaMock.groceryItem.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    prismaMock.groceryItem.findUnique.mockResolvedValue(null);
    pantryAttentionServiceMock.getGroceryLinkByOperation.mockResolvedValue(null);
  });

  it("creates a clear ongoing Pantry Restock list and links the exact Pantry item", async () => {
    const createdItem = item("grocery-milk", "Milk");
    pantryServiceMock.get.mockResolvedValue({ id: "pantry-milk", name: "Milk", category: "Dairy", stockMode: "track-quantity" });
    prismaMock.groceryList.create.mockResolvedValue(list());
    prismaMock.groceryItem.create.mockResolvedValue(createdItem);
    prismaMock.groceryList.findUnique.mockResolvedValue(list([createdItem]));
    pantryAttentionServiceMock.createGroceryLink.mockResolvedValue(link());

    await new GroceryService().addPantryItemToCurrentList("pantry-milk", { operationIdentity: "pantry-action-1" });

    expect(prismaMock.groceryList.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Pantry Restock", date: null }) }));
    expect(prismaMock.groceryItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Milk" }) }));
    expect(pantryAttentionServiceMock.createGroceryLink).toHaveBeenCalledWith("pantry-milk", expect.objectContaining({ groceryItemId: "grocery-milk" }));
  });

  it("does not fuzzy-match similar names and replays an action by operation identity", async () => {
    const existing = link();
    const existingItem = item("grocery-milk", "Milk");
    pantryAttentionServiceMock.getGroceryLinkByOperation.mockResolvedValue(existing);
    prismaMock.groceryItem.findUnique.mockResolvedValue(existingItem);
    prismaMock.groceryList.findUnique.mockResolvedValue(list([existingItem, item("grocery-other", "Milk alternative")]));

    await new GroceryService().addPantryItemToCurrentList("pantry-milk", { operationIdentity: "pantry-action-1" });

    expect(prismaMock.groceryItem.create).not.toHaveBeenCalled();
    expect(pantryServiceMock.get).not.toHaveBeenCalled();
  });

  it("checks a linked item without applying Pantry stock", async () => {
    const groceryItem = item("grocery-milk", "Milk");
    prismaMock.groceryItem.update.mockResolvedValue({ ...groceryItem, checked: true, groceryList: list([{ ...groceryItem, checked: true }]) });
    prismaMock.pantryGroceryLink.findFirst.mockResolvedValue(link());
    prismaMock.groceryList.findUnique.mockResolvedValue(list([{ ...groceryItem, checked: true }]));
    pantryAttentionServiceMock.updateGroceryLinkLifecycle.mockResolvedValue(link({ status: "checked", active: false }));

    await new GroceryService().toggleItem("grocery-milk", true);

    expect(pantryAttentionServiceMock.updateGroceryLinkLifecycle).toHaveBeenCalledWith(expect.objectContaining({ status: "checked", linkId: "link-1" }));
    expect(pantryServiceMock.applyStockAction).not.toHaveBeenCalled();
  });

  it("closes the exact link when its grocery item is removed", async () => {
    const groceryItem = item("grocery-milk", "Milk");
    prismaMock.groceryItem.findUnique.mockResolvedValue(groceryItem);
    prismaMock.pantryGroceryLink.findFirst.mockResolvedValue(link());
    prismaMock.groceryItem.delete.mockResolvedValue(groceryItem);
    prismaMock.groceryList.findUnique.mockResolvedValue(list());
    pantryAttentionServiceMock.updateGroceryLinkLifecycle.mockResolvedValue(link({ status: "removed", active: false }));

    await new GroceryService().deleteGroceryItem("list-1", "grocery-milk");

    expect(pantryAttentionServiceMock.updateGroceryLinkLifecycle).toHaveBeenCalledWith(expect.objectContaining({ status: "removed", linkId: "link-1" }));
    expect(prismaMock.groceryItem.delete).toHaveBeenCalledWith({ where: { id: "grocery-milk" } });
  });

  it("uses a stable review identity for confirmed linked Pantry stock", async () => {
    const groceryItem = item("grocery-milk", "Milk", true);
    prismaMock.groceryList.findUnique.mockResolvedValue(list([groceryItem]));
    prismaMock.pantryGroceryLink.findFirst.mockResolvedValue(link());
    pantryServiceMock.get.mockResolvedValue({ id: "pantry-milk", name: "Milk", stockMode: "track-quantity" });
    pantryServiceMock.applyStockAction.mockResolvedValue({ id: "pantry-milk" });
    pantryAttentionServiceMock.updateGroceryLinkLifecycle.mockResolvedValue(link({ status: "completed", active: false }));

    await new GroceryService().applyPantryCompletion("list-1", [{ itemId: "grocery-milk", action: "match", pantryItemId: "pantry-milk", purchasedQuantity: 1, reviewIdentity: "review-1" }]);

    expect(pantryServiceMock.applyStockAction).toHaveBeenCalledWith("pantry-milk", expect.objectContaining({ sourceIdentity: "review-1" }));
    expect(pantryAttentionServiceMock.updateGroceryLinkLifecycle).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", reviewIdentity: "review-1" }));
  });
});