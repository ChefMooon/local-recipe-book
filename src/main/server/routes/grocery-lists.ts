import { Hono } from "hono";
import { z } from "zod";
import { PantryCompletionApplySchema } from "@shared/schemas/grocery-pantry-review-schemas";
import { groceryService } from "../services.js";

export const groceryListsRoutes = new Hono();

const createGroceryListSchema = z.object({
  name: z.string().trim().min(1, "List name is required"),
  date: z.string().datetime().nullable().optional(),
  favourite: z.boolean().optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Item name is required"),
        qty: z.string().optional(),
        unit: z.string().optional(),
        category: z.string().optional(),
        notes: z.string().optional(),
        meal: z.string().optional(),
        checked: z.boolean().optional(),
      })
    )
    .optional(),
});

groceryListsRoutes.get("/grocery-lists", async (c) => {
  const currentOnly = c.req.query("current") === "1";
  const data = currentOnly
    ? await groceryService.getCurrentGroceryList()
    : await groceryService.listGroceryLists();
  return c.json({ data });
});

groceryListsRoutes.post("/grocery-lists", async (c) => {
  try {
    const body = await c.req.json();
    const data = await groceryService.createGroceryList(
      createGroceryListSchema.parse(body)
    );
    return c.json({ data }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid grocery list payload",
          issues: error.flatten(),
        },
        400
      );
    }

    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create grocery list",
      },
      400
    );
  }
});

groceryListsRoutes.get("/grocery-lists/:id", async (c) => {
  const id = c.req.param("id");
  const data = await groceryService.getGroceryList(id);
  if (!data) {
    return c.json({ error: "Grocery list not found" }, 404);
  }
  return c.json({ data });
});

groceryListsRoutes.get("/grocery-lists/:id/pantry-review", async (c) => {
  try {
    return c.json({ data: await groceryService.getPantryCompletionProposals(c.req.param("id")) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to build Pantry review" }, 400);
  }
});

groceryListsRoutes.post("/grocery-lists/:id/pantry-review", async (c) => {
  try {
    const body = PantryCompletionApplySchema.parse(await c.req.json());
    return c.json({ data: await groceryService.applyPantryCompletion(c.req.param("id"), body.decisions) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to apply Pantry review" }, 400);
  }
});

groceryListsRoutes.patch("/grocery-lists/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      name?: string;
      date?: string | null;
      favourite?: boolean;
    };
    const data = await groceryService.updateGroceryList(id, body);
    return c.json({ data });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update grocery list",
      },
      400
    );
  }
});

groceryListsRoutes.delete("/grocery-lists/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const data = await groceryService.deleteGroceryList(id);
    return c.json({ data });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete grocery list",
      },
      400
    );
  }
});

// Items
groceryListsRoutes.post("/grocery-lists/:id/items", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      name: string;
      qty?: string;
      unit?: string;
      category?: string;
      notes?: string;
      meal?: string;
      checked?: boolean;
    };
    const data = await groceryService.createGroceryItem(id, body);
    return c.json({ data }, 201);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create grocery item",
      },
      400
    );
  }
});

groceryListsRoutes.patch("/grocery-lists/:id/items/:itemId", async (c) => {
  try {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const body = (await c.req.json()) as {
      name?: string;
      qty?: string | null;
      unit?: string | null;
      category?: string;
      notes?: string | null;
      meal?: string | null;
      checked?: boolean;
      operationIdentity?: string;
    };
    const data = await groceryService.updateGroceryItem(id, itemId, body);
    return c.json({ data });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update grocery item",
      },
      400
    );
  }
});

groceryListsRoutes.delete("/grocery-lists/:id/items/:itemId", async (c) => {
  try {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const data = await groceryService.deleteGroceryItem(id, itemId);
    return c.json({ data });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete grocery item",
      },
      400
    );
  }
});

groceryListsRoutes.post("/grocery-lists/:id/reorder", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as { itemIds: string[] };
    if (!Array.isArray(body.itemIds)) {
      throw new Error("itemIds must be an array");
    }
    const data = await groceryService.reorderGroceryItems(id, body.itemIds);
    return c.json({ data });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to reorder grocery items",
      },
      400
    );
  }
});
