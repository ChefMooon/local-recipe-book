import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { groceryListsRoutes } from "./grocery-lists";
import { groceryService } from "../services.js";

vi.mock("../services.js", () => ({
  groceryService: {
    createGroceryList: vi.fn(),
    getPantryCompletionProposals: vi.fn(),
    applyPantryCompletion: vi.fn(),
  },
}));

function createTestApp() {
  const app = new Hono();
  app.route("/api", groceryListsRoutes);
  return app;
}

describe("groceryListsRoutes create", () => {
  beforeEach(() => {
    vi.mocked(groceryService.createGroceryList).mockReset();
    vi.mocked(groceryService.applyPantryCompletion).mockReset();
    vi.mocked(groceryService.getPantryCompletionProposals).mockReset();
    vi.mocked(groceryService.createGroceryList).mockResolvedValue({
      id: "list-1",
      name: "Weekly",
      date: null,
      favourite: false,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
      checkedCount: 0,
      totalItems: 0,
      completionPercentage: 0,
      items: [],
    } as never);
  });

  it("accepts an ongoing list payload with null date", async () => {
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "  Weekly  ",
        date: null,
      }),
    });

    expect(response.status).toBe(201);
    expect(groceryService.createGroceryList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Weekly",
        date: null,
      })
    );
  });

  it("rejects blank names", async () => {
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "   ",
        date: null,
      }),
    });

    expect(response.status).toBe(400);
    expect(groceryService.createGroceryList).not.toHaveBeenCalled();
  });

  it("rejects invalid date strings", async () => {
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Weekly",
        date: "not-a-date",
      }),
    });

    expect(response.status).toBe(400);
    expect(groceryService.createGroceryList).not.toHaveBeenCalled();
  });

  it("validates and forwards a Pantry completion review", async () => {
    vi.mocked(groceryService.applyPantryCompletion).mockResolvedValue([]);
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists/list-1/pantry-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisions: [{ itemId: "item-1", action: "match", pantryItemId: "pantry-1", purchasedQuantity: 2, unit: "kg" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(groceryService.applyPantryCompletion).toHaveBeenCalledWith("list-1", expect.any(Array));
  });

  it("rejects completion decisions without an explicit action", async () => {
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists/list-1/pantry-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: [{ itemId: "item-1" }] }),
    });

    expect(response.status).toBe(400);
    expect(groceryService.applyPantryCompletion).not.toHaveBeenCalled();
  });

  it("accepts blank units for grocery items without units", async () => {
    vi.mocked(groceryService.applyPantryCompletion).mockResolvedValue([]);
    const app = createTestApp();
    const response = await app.request("/api/grocery-lists/list-1/pantry-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisions: [
          { itemId: "item-1", action: "skip", unit: "" },
          { itemId: "item-2", action: "create", purchasedQuantity: 1, unit: "" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(groceryService.applyPantryCompletion).toHaveBeenCalledWith(
      "list-1",
      expect.arrayContaining([
        expect.objectContaining({ itemId: "item-1", unit: null }),
        expect.objectContaining({ itemId: "item-2", unit: null }),
      ])
    );
  });
});
