import { prisma } from "../lib/prisma";
import { bootstrapDatabase } from "../lib/bootstrap";
import { publishCommittedChange } from "./change-event-bus";
import { calculatePantryRequirement } from "./pantry-calculation";
import { pantryService } from "./pantry-service";
import type { PantryCompletionDecision } from "@shared/schemas/grocery-pantry-review-schemas";
import { normalizePantryIdentity } from "@shared/schemas/pantry-schemas";

function serializeGroceryList(groceryList: {
  id: string;
  name: string;
  date: Date | null;
  favourite: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    name: string;
    qty: string | null;
    unit: string | null;
    category: string;
    notes: string | null;
    meal: string | null;
    checked: boolean;
    sortOrder: number;
  }>;
}) {
  const checkedCount = groceryList.items.filter((item) => item.checked).length;

  return {
    id: groceryList.id,
    name: groceryList.name,
    date: groceryList.date ? groceryList.date.toISOString() : null,
    favourite: groceryList.favourite,
    createdAt: groceryList.createdAt.toISOString(),
    updatedAt: groceryList.updatedAt.toISOString(),
    checkedCount,
    totalItems: groceryList.items.length,
    completionPercentage:
      groceryList.items.length === 0
        ? 0
        : Math.round((checkedCount / groceryList.items.length) * 100),
    items: groceryList.items
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item) => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        category: item.category,
        notes: item.notes,
        meal: item.meal,
        checked: item.checked,
        sortOrder: item.sortOrder,
      })),
  };
}

type CreateListInput = {
  name: string;
  date?: string | Date | null;
  favourite?: boolean;
  items?: Array<{
    name: string;
    qty?: string;
    unit?: string;
    category?: string;
    notes?: string;
    meal?: string;
    checked?: boolean;
  }>;
};

type UpdateListInput = {
  name?: string;
  date?: string | Date | null;
  favourite?: boolean;
};

type CreateItemInput = {
  name: string;
  qty?: string;
  unit?: string;
  category?: string;
  notes?: string;
  meal?: string;
  checked?: boolean;
};

type UpdateItemInput = {
  name?: string;
  qty?: string | null;
  unit?: string | null;
  category?: string;
  notes?: string | null;
  meal?: string | null;
  checked?: boolean;
};

type GroceryListSnapshot = {
  id: string;
  name: string;
  date: string | null;
  favourite: boolean;
  items: Array<{
    id: string;
    name: string;
    qty: string | null;
    unit: string | null;
    category: string;
    notes: string | null;
    meal: string | null;
    checked: boolean;
    sortOrder: number;
  }>;
};

function toDate(value: string | Date | null) {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date provided");
  }

  return parsed;
}

function compareGroceryLists(
  left: { date: Date | null; createdAt: Date },
  right: { date: Date | null; createdAt: Date }
) {
  const leftOngoing = left.date === null;
  const rightOngoing = right.date === null;

  if (leftOngoing && rightOngoing) {
    return right.createdAt.getTime() - left.createdAt.getTime();
  }

  if (leftOngoing) {
    return -1;
  }

  if (rightOngoing) {
    return 1;
  }

  const dateDiff = left.date!.getTime() - right.date!.getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return right.createdAt.getTime() - left.createdAt.getTime();
}

function sortGroceryLists<T extends { date: Date | null; createdAt: Date }>(
  lists: T[]
) {
  return [...lists].sort(compareGroceryLists);
}

async function getListOrThrow(id: string) {
  const groceryList = await prisma.groceryList.findUnique({
    where: { id },
    include: {
      items: true,
    },
  });

  if (!groceryList) {
    throw new Error("Grocery list not found");
  }

  return groceryList;
}

export class GroceryService {
  async getPantryCompletionProposals(groceryListId: string) {
    await bootstrapDatabase();
    const list = await getListOrThrow(groceryListId);
    return Promise.all(
      list.items.map(async (item) => {
        const quantity = item.qty == null ? null : Number.parseFloat(item.qty);
        const calculation = await calculatePantryRequirement(item.name, quantity, item.unit);
        return {
          groceryItemId: item.id,
          name: item.name,
          quantity,
          unit: item.unit,
          checked: item.checked,
          ...calculation,
          decisionRequired: calculation.match.status !== "matched",
        };
      })
    );
  }

  async applyPantryCompletion(groceryListId: string, decisions: PantryCompletionDecision[]) {
    await bootstrapDatabase();
    const list = await getListOrThrow(groceryListId);
    const items = new Map(list.items.map((item) => [item.id, item]));
    const results = [];
    for (const decision of decisions) {
      const item = items.get(decision.itemId);
      if (!item || decision.action === "skip") continue;
      const quantity = decision.purchasedQuantity ?? (item.qty == null ? null : Number.parseFloat(item.qty));
      if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) continue;

      let pantryItemId = decision.pantryItemId;
      if (decision.action === "match" && pantryItemId) {
        const pantryItem = await pantryService.get(pantryItemId);
        if (!pantryItem) throw new Error("Pantry item not found");
        if (pantryItem.stockMode === "always-available") continue;
      }
      if (decision.action === "create") {
        const normalizedName = normalizePantryIdentity(item.name);
        const existing = (await pantryService.list({ search: item.name }))
          .find((candidate) => candidate.normalizedName === normalizedName);
        if (existing) {
          pantryItemId = existing.id;
        } else {
          const created = await pantryService.create({
            name: item.name,
            category: item.category,
            stockMode: "track-quantity",
            aliases: [],
            locations: [],
            packages: [],
            warningRules: [],
          });
          pantryItemId = created?.id;
        }
      }
      if (!pantryItemId) throw new Error(`Pantry match is required for ${item.name}`);
      const updated = await pantryService.applyStockAction(pantryItemId, {
        type: "add",
        location: decision.location ?? "Unspecified",
        quantity,
        unit: decision.unit ?? item.unit,
        approximate: decision.approximate ?? false,
        note: `Purchased from grocery list ${groceryListId}`,
      });
      results.push({ groceryItemId: item.id, pantryItemId, item: updated });
    }
    return results;
  }

  async listGroceryLists() {
    await bootstrapDatabase();

    const groceryLists = await prisma.groceryList.findMany({
      include: {
        items: true,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return sortGroceryLists(groceryLists).map(serializeGroceryList);
  }

  async getGroceryList(id: string) {
    await bootstrapDatabase();

    const groceryList = await prisma.groceryList.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    return groceryList ? serializeGroceryList(groceryList) : null;
  }

  async getCurrentGroceryList() {
    await bootstrapDatabase();

    const groceryLists = await prisma.groceryList.findMany({
      include: {
        items: true,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const groceryList = sortGroceryLists(groceryLists)[0] ?? null;

    return groceryList ? serializeGroceryList(groceryList) : null;
  }

  async createGroceryList(input: CreateListInput) {
    await bootstrapDatabase();

    const parsedDate =
      input.date === undefined ? undefined : toDate(input.date);

    const groceryList = await prisma.groceryList.create({
      data: {
        name: input.name,
        date: parsedDate,
        favourite: input.favourite ?? false,
        items: {
          create: (input.items ?? []).map((item, index) => ({
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            category: item.category ?? "Other",
            notes: item.notes,
            meal: item.meal,
            checked: item.checked ?? false,
            sortOrder: index,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await publishCommittedChange("groceryList", "create", groceryList.id);
    return serializeGroceryList(groceryList);
  }

  async updateGroceryList(id: string, input: UpdateListInput) {
    await bootstrapDatabase();

    const data: {
      name?: string;
      date?: Date | null;
      favourite?: boolean;
    } = {};

    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.date !== undefined) {
      data.date = toDate(input.date);
    }
    if (input.favourite !== undefined) {
      data.favourite = input.favourite;
    }

    const groceryList = await prisma.groceryList.update({
      where: { id },
      data,
      include: {
        items: true,
      },
    });

    await publishCommittedChange("groceryList", "update", id);
    return serializeGroceryList(groceryList);
  }

  async deleteGroceryList(id: string) {
    await bootstrapDatabase();

    await prisma.groceryList.delete({
      where: { id },
    });

    await publishCommittedChange("groceryList", "delete", id);
    return { id };
  }

  async createGroceryItem(groceryListId: string, input: CreateItemInput) {
    await bootstrapDatabase();

    const maxOrder = await prisma.groceryItem.aggregate({
      where: { groceryListId },
      _max: {
        sortOrder: true,
      },
    });

    await prisma.groceryItem.create({
      data: {
        groceryListId,
        name: input.name,
        qty: input.qty,
        unit: input.unit,
        category: input.category ?? "Other",
        notes: input.notes,
        meal: input.meal,
        checked: input.checked ?? false,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    await publishCommittedChange("groceryList", "update", groceryListId);
    return serializeGroceryList(await getListOrThrow(groceryListId));
  }

  async updateGroceryItem(
    groceryListId: string,
    itemId: string,
    input: UpdateItemInput
  ) {
    await bootstrapDatabase();

    const existing = await prisma.groceryItem.findUnique({
      where: { id: itemId },
      select: { groceryListId: true },
    });

    if (!existing || existing.groceryListId !== groceryListId) {
      throw new Error("Grocery item not found");
    }

    await prisma.groceryItem.update({
      where: {
        id: itemId,
      },
      data: {
        name: input.name,
        qty: input.qty,
        unit: input.unit,
        category: input.category,
        notes: input.notes,
        meal: input.meal,
        checked: input.checked,
      },
    });

    await publishCommittedChange("groceryList", "update", groceryListId);
    return serializeGroceryList(await getListOrThrow(groceryListId));
  }

  async deleteGroceryItem(groceryListId: string, itemId: string) {
    await bootstrapDatabase();

    const existing = await prisma.groceryItem.findUnique({
      where: { id: itemId },
      select: { groceryListId: true },
    });

    if (!existing || existing.groceryListId !== groceryListId) {
      throw new Error("Grocery item not found");
    }

    await prisma.groceryItem.delete({
      where: {
        id: itemId,
      },
    });

    await publishCommittedChange("groceryList", "update", groceryListId);
    return serializeGroceryList(await getListOrThrow(groceryListId));
  }

  async reorderGroceryItems(groceryListId: string, itemIds: string[]) {
    await bootstrapDatabase();

    const existingItems = await prisma.groceryItem.findMany({
      where: {
        groceryListId,
        id: { in: itemIds },
      },
      select: {
        id: true,
      },
    });

    if (existingItems.length !== itemIds.length) {
      throw new Error("Some grocery items were not found");
    }

    await prisma.$transaction(
      itemIds.map((itemId, index) =>
        prisma.groceryItem.update({
          where: {
            id: itemId,
          },
          data: {
            sortOrder: index,
          },
        })
      )
    );

    await publishCommittedChange("groceryList", "bulk", groceryListId);
    return serializeGroceryList(await getListOrThrow(groceryListId));
  }

  async restoreGroceryListSnapshot(snapshot: GroceryListSnapshot) {
    await bootstrapDatabase();

    await prisma.$transaction(async (tx) => {
      await tx.groceryList.update({
        where: {
          id: snapshot.id,
        },
        data: {
          name: snapshot.name,
          date: snapshot.date ? new Date(snapshot.date) : null,
          favourite: snapshot.favourite,
        },
      });

      await tx.groceryItem.deleteMany({
        where: {
          groceryListId: snapshot.id,
        },
      });

      if (snapshot.items.length > 0) {
        await tx.groceryItem.createMany({
          data: snapshot.items.map((item, index) => ({
            id: item.id,
            groceryListId: snapshot.id,
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            category: item.category,
            notes: item.notes,
            meal: item.meal,
            checked: item.checked,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
    });

    await publishCommittedChange("groceryList", "bulk", snapshot.id);
    return serializeGroceryList(await getListOrThrow(snapshot.id));
  }

  async toggleItem(itemId: string, checked: boolean) {
    await bootstrapDatabase();

    const item = await prisma.groceryItem.update({
      where: {
        id: itemId,
      },
      data: {
        checked,
      },
      include: {
        groceryList: {
          include: {
            items: true,
          },
        },
      },
    });

    await publishCommittedChange("groceryList", "update", item.groceryList.id);
    return serializeGroceryList({
      ...item.groceryList,
      items: item.groceryList.items,
    });
  }
}
