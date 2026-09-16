import { Hono } from "hono";
import { z } from "zod";
import {
  CreatePantryItemSchema,
  PantryLotInputSchema,
  PantryPackageInputSchema,
  PantryPackageStockActionSchema,
  PantryQuerySchema,
  PantryStockActionSchema,
  PantryWarningRuleInputSchema,
  UpdatePantryItemSchema,
} from "@shared/schemas/pantry-schemas";
import { pantryService } from "../services.js";

export const pantryRoutes = new Hono();

function parseId(c: { req: { param(name: string): string } }) {
  return c.req.param("id");
}

pantryRoutes.get("/pantry", async (c) => {
  const query = PantryQuerySchema.parse({
    search: c.req.query("search"),
    filter: c.req.query("filter"),
    sort: c.req.query("sort"),
    direction: c.req.query("direction"),
  });
  return c.json({ data: await pantryService.list(query) });
});

pantryRoutes.get("/pantry/summary", async (c) => {
  return c.json({ data: await pantryService.summary() });
});

pantryRoutes.post("/pantry", async (c) => {
  try {
    const data = await pantryService.create(CreatePantryItemSchema.parse(await c.req.json()));
    return c.json({ data }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry item payload", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to create Pantry item" }, 400);
  }
});

pantryRoutes.get("/pantry/:id", async (c) => {
  const data = await pantryService.get(parseId(c), c.req.query("history") === "1");
  if (!data) return c.json({ error: "Pantry item not found" }, 404);
  return c.json({ data });
});

pantryRoutes.patch("/pantry/:id", async (c) => {
  try {
    const data = await pantryService.update(parseId(c), UpdatePantryItemSchema.parse(await c.req.json()));
    if (!data) return c.json({ error: "Pantry item not found" }, 404);
    return c.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry item payload", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to update Pantry item" }, 400);
  }
});

pantryRoutes.delete("/pantry/:id", async (c) => {
  const deleted = await pantryService.remove(parseId(c));
  if (!deleted) return c.json({ error: "Pantry item not found" }, 404);
  return c.json({ data: { deleted: true } });
});

pantryRoutes.post("/pantry/:id/stock", async (c) => {
  try {
    return c.json({ data: await pantryService.applyStockAction(parseId(c), PantryStockActionSchema.parse(await c.req.json())) });
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry stock action", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to update Pantry stock" }, 400);
  }
});

pantryRoutes.post("/pantry/:id/package-stock", async (c) => {
  try {
    return c.json({ data: await pantryService.applyPackageStockAction(parseId(c), PantryPackageStockActionSchema.parse(await c.req.json())) });
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry package stock action", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to add Pantry package stock" }, 400);
  }
});

pantryRoutes.post("/pantry/:id/lots", async (c) => {
  try {
    const parsed = PantryLotInputSchema.parse(await c.req.json());
    return c.json({ data: await pantryService.addLot(parseId(c), parsed) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry lot", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to add Pantry lot" }, 400);
  }
});

pantryRoutes.delete("/pantry/:id/lots/:lotId", async (c) => {
  try {
    await pantryService.removeLot(parseId(c), c.req.param("lotId"));
    return c.json({ data: { deleted: true } });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to remove Pantry lot" }, 400);
  }
});

pantryRoutes.patch("/pantry/:id/lots/:lotId", async (c) => {
  try {
    const parsed = PantryLotInputSchema.parse(await c.req.json());
    return c.json({ data: await pantryService.updateLot(parseId(c), c.req.param("lotId"), parsed) });
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry lot", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to update Pantry lot" }, 400);
  }
});

pantryRoutes.post("/pantry/:id/packages", async (c) => {
  try {
    return c.json({ data: await pantryService.addPackage(parseId(c), PantryPackageInputSchema.parse(await c.req.json())) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry package", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to add Pantry package" }, 400);
  }
});

pantryRoutes.post("/pantry/:id/warnings", async (c) => {
  try {
    return c.json({ data: await pantryService.addWarning(parseId(c), PantryWarningRuleInputSchema.parse(await c.req.json())) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: "Invalid Pantry warning rule", issues: error.flatten() }, 400);
    return c.json({ error: error instanceof Error ? error.message : "Unable to add Pantry warning rule" }, 400);
  }
});

pantryRoutes.get("/pantry/:id/events", async (c) => {
  return c.json({ data: await pantryService.events(parseId(c)) });
});
