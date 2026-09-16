import { beforeEach, describe, expect, it, vi } from "vitest";

const { pantryServiceMock } = vi.hoisted(() => ({
  pantryServiceMock: {
    list: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    applyStockAction: vi.fn(),
    addLot: vi.fn(),
    removeLot: vi.fn(),
    addPackage: vi.fn(),
    addWarning: vi.fn(),
    events: vi.fn(),
  },
}));

vi.mock("../services.js", () => ({ pantryService: pantryServiceMock }));

import { pantryRoutes } from "./pantry";

describe("pantryRoutes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes query filters to the Pantry service", async () => {
    pantryServiceMock.list.mockResolvedValue([]);

    const response = await pantryRoutes.request("http://localhost/pantry?search=milk&filter=low-stock&sort=name&direction=asc");

    expect(response.status).toBe(200);
    expect(pantryServiceMock.list).toHaveBeenCalledWith({ search: "milk", filter: "low-stock", sort: "name", direction: "asc" });
  });

  it("returns typed validation errors for invalid create payloads", async () => {
    const response = await pantryRoutes.request("http://localhost/pantry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", stockMode: "unknown" }),
    });

    expect(response.status).toBe(400);
    expect(pantryServiceMock.create).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid Pantry item payload" });
  });

  it("validates and forwards dated-lot location and dates", async () => {
    pantryServiceMock.addLot.mockResolvedValue({ id: "lot-1" });

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/lots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: "Fridge", quantity: 2, unit: "Liters", bestBeforeAt: "2026-09-20T23:59:59.000Z", expiresAt: null }),
    });

    expect(response.status).toBe(201);
    expect(pantryServiceMock.addLot).toHaveBeenCalledWith("item-1", expect.objectContaining({ location: "Fridge", quantity: 2, unit: "l" }));
  });

  it("rejects non-string dated-lot locations as validation errors", async () => {
    const response = await pantryRoutes.request("http://localhost/pantry/item-1/lots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: 42, quantity: 1 }),
    });

    expect(response.status).toBe(400);
    expect(pantryServiceMock.addLot).not.toHaveBeenCalled();
  });

  it("removes a dated lot through the item-scoped route", async () => {
    pantryServiceMock.removeLot.mockResolvedValue(undefined);

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/lots/lot-1", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(pantryServiceMock.removeLot).toHaveBeenCalledWith("item-1", "lot-1");
  });
});
