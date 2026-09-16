import { beforeEach, describe, expect, it, vi } from "vitest";

const { pantryServiceMock, pantryAttentionServiceMock } = vi.hoisted(() => ({
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
  pantryAttentionServiceMock: {
    getAttention: vi.fn(),
    setAttention: vi.fn(),
    clearAttention: vi.fn(),
    getGroceryLink: vi.fn(),
    createGroceryLink: vi.fn(),
    updateGroceryLinkLifecycle: vi.fn(),
  },
}));

vi.mock("../services.js", () => ({ pantryService: pantryServiceMock, pantryAttentionService: pantryAttentionServiceMock }));

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

  it("validates and forwards a timed attention mutation", async () => {
    pantryAttentionServiceMock.setAttention.mockResolvedValue({ id: "attention-1" });

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/attention", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "snooze", expiresAt: "2026-09-22T00:00:00.000Z", operationIdentity: "operation-1" }),
    });

    expect(response.status).toBe(200);
    expect(pantryAttentionServiceMock.setAttention).toHaveBeenCalledWith("item-1", expect.objectContaining({ source: "snooze", operationIdentity: "operation-1" }));
  });

  it("rejects linked attention without an explicit grocery link", async () => {
    const response = await pantryRoutes.request("http://localhost/pantry/item-1/attention", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "grocery-link", operationIdentity: "operation-1" }),
    });

    expect(response.status).toBe(400);
    expect(pantryAttentionServiceMock.setAttention).not.toHaveBeenCalled();
  });

  it("validates and forwards an attention unmute request", async () => {
    pantryAttentionServiceMock.clearAttention.mockResolvedValue({ cleared: true });

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/attention", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attentionId: "attention-1", operationIdentity: "clear-operation-1" }),
    });

    expect(response.status).toBe(200);
    expect(pantryAttentionServiceMock.clearAttention).toHaveBeenCalledWith("item-1", expect.objectContaining({ attentionId: "attention-1" }));
  });

  it("inspects derived attention through the item-scoped route", async () => {
    pantryServiceMock.get.mockResolvedValue({ attention: { visible: false, suppressed: true } });

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/attention/inspection");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { visible: false, suppressed: true } });
  });

  it("validates an exact grocery item link payload", async () => {
    pantryAttentionServiceMock.createGroceryLink.mockResolvedValue({ id: "link-1" });

    const response = await pantryRoutes.request("http://localhost/pantry/item-1/grocery-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groceryItemId: "grocery-item-1", operationIdentity: "link-operation-1" }),
    });

    expect(response.status).toBe(201);
    expect(pantryAttentionServiceMock.createGroceryLink).toHaveBeenCalledWith("item-1", expect.objectContaining({ groceryItemId: "grocery-item-1" }));
  });
});
