import { prisma } from "../lib/prisma";
import { bootstrapDatabase } from "../lib/bootstrap";
import { publishCommittedChange } from "./change-event-bus";
import { calculatePantryRequirement } from "./pantry-calculation";
import { pantryService } from "./pantry-service";
import { pantryAttentionService } from "./pantry-attention-service";
import type { PantryCompletionDecision } from "@shared/schemas/grocery-pantry-review-schemas";
import { normalizePantryIdentity } from "@shared/schemas/pantry-schemas";

type SerializedPantryLink = {
  id: string;
  pantryItemId: string;
  groceryItemId: string;
  status: string;
  active: boolean;
};

async function getPantryLinks(groceryItemIds: string[]) {
  const links = new Map<string, SerializedPantryLink>();
  if (groceryItemIds.length === 0) return links;
  const delegate = (prisma as unknown as { pantryGroceryLink?: typeof prisma.pantryGroceryLink }).pantryGroceryLink;
  if (!delegate) return links;
  const rows = await delegate.findMany({
    where: { groceryItemId: { in: groceryItemIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const row of rows) {
    if (!links.has(row.groceryItemId)) {
      links.set(row.groceryItemId, {
        id: row.id,
        pantryItemId: row.pantryItemId,
        groceryItemId: row.groceryItemId,
        status: row.status,
        active: row.active,
      });
    }
  }
  return links;
}

async function serializeGroceryList(groceryList: {
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
  const pantryLinks = await getPantryLinks(groceryList.items.map((item) => item.id));

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
        pantryLink: pantryLinks.get(item.id) ?? null,
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
  operationIdentity?: string;
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
  private async getPantryLinkForItem(groceryItemId: string) {
    const delegate = (prisma as unknown as { pantryGroceryLink?: typeof prisma.pantryGroceryLink }).pantryGroceryLink;
    if (!delegate) return null;
    return delegate.findFirst({
      where: { groceryItemId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  private async transitionPantryLink(
    groceryItemId: string,
    status: "active" | "checked" | "removed" | "completed" | "skipped" | "failed-review",
    operationIdentity: string,
    reviewIdentity?: string
  ) {
    const link = await this.getPantryLinkForItem(groceryItemId);
    if (!link) return null;
    const result = await pantryAttentionService.updateGroceryLinkLifecycle({
      linkId: link.id,
      status,
      operationIdentity,
      reviewIdentity: reviewIdentity ?? null,
    });
    await publishCommittedChange("pantry", "update", link.pantryItemId);
    return result;
  }

  async getPantryCompletionProposals(groceryListId: string) {
    await bootstrapDatabase();
    const list = await getListOrThrow(groceryListId);
    return Promise.all(
      list.items.map(async (item) => {
        const quantity = item.qty == null ? null : Number.parseFloat(item.qty);
        const calculation = await calculatePantryRequirement(item.name, quantity, item.unit);
        const link = await this.getPantryLinkForItem(item.id);
        const linkedPantryItem = link ? await pantryService.get(link.pantryItemId) : null;
        const match = linkedPantryItem
          ? {
              status: "matched" as const,
              item: {
                id: linkedPantryItem.id,
                name: linkedPantryItem.name,
                stockMode: linkedPantryItem.stockMode as "always-available" | "track-quantity" | "replenish-to-target",
              },
              suggestions: [],
              explanation: "Explicit Pantry link",
            }
          : calculation.match;
        return {
          groceryItemId: item.id,
          name: item.name,
          quantity,
          unit: item.unit,
          checked: item.checked,
          ...calculation,
          match,
          decisionRequired: match.status !== "matched",
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
      if (!item) continue;
      const reviewIdentity = decision.reviewIdentity ?? `grocery-review:${groceryListId}:${item.id}:${decision.action}`;
      if (decision.action === "skip") {
        await this.transitionPantryLink(item.id, "skipped", `grocery-review:${reviewIdentity}:skipped`, reviewIdentity);
        results.push({ groceryItemId: item.id, status: "skipped" });
        continue;
      }
      const quantity = decision.purchasedQuantity ?? (item.qty == null ? null : Number.parseFloat(item.qty));
      if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
        await this.transitionPantryLink(item.id, "failed-review", `grocery-review:${reviewIdentity}:failed`, reviewIdentity);
        results.push({ groceryItemId: item.id, status: "failed-review", error: "A positive purchased quantity is required" });
        continue;
      }

      let pantryItemId = decision.pantryItemId;
      const linked = await this.getPantryLinkForItem(item.id);
      if (linked) pantryItemId = linked.pantryItemId;
      if (decision.action === "match" && pantryItemId) {
        const pantryItem = await pantryService.get(pantryItemId);
        if (!pantryItem) {
          await this.transitionPantryLink(item.id, "failed-review", `grocery-review:${reviewIdentity}:failed`, reviewIdentity);
          results.push({ groceryItemId: item.id, status: "failed-review", error: "Pantry item not found" });
          continue;
        }
        if (pantryItem.stockMode === "always-available") {
          await this.transitionPantryLink(item.id, "skipped", `grocery-review:${reviewIdentity}:skipped`, reviewIdentity);
          results.push({ groceryItemId: item.id, status: "skipped" });
          continue;
        }
      }
      if (decision.action === "create" && !linked) {
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
      if (!pantryItemId) {
        await this.transitionPantryLink(item.id, "failed-review", `grocery-review:${reviewIdentity}:failed`, reviewIdentity);
        results.push({ groceryItemId: item.id, status: "failed-review", error: `Pantry match is required for ${item.name}` });
        continue;
      }
      try {
        const updated = await pantryService.applyStockAction(pantryItemId, {
          type: "add",
          location: decision.location ?? "Unspecified",
          quantity,
          unit: decision.unit ?? item.unit,
          approximate: decision.approximate ?? false,
          sourceIdentity: reviewIdentity,
          note: `Purchased from grocery list ${groceryListId}`,
        });
        await this.transitionPantryLink(item.id, "completed", `grocery-review:${reviewIdentity}:completed`, reviewIdentity);
        results.push({ groceryItemId: item.id, pantryItemId, status: "completed", item: updated });
      } catch (error) {
        await this.transitionPantryLink(item.id, "failed-review", `grocery-review:${reviewIdentity}:failed`, reviewIdentity);
        results.push({ groceryItemId: item.id, pantryItemId, status: "failed-review", error: error instanceof Error ? error.message : "Unable to update Pantry" });
      }
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

    return Promise.all(sortGroceryLists(groceryLists).map(serializeGroceryList));
  }

  async getGroceryList(id: string) {
    await bootstrapDatabase();

    const groceryList = await prisma.groceryList.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    return groceryList ? await serializeGroceryList(groceryList) : null;
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

    return groceryList ? await serializeGroceryList(groceryList) : null;
  }

  async addPantryItemToCurrentList(
    pantryItemId: string,
    input: { operationIdentity: string; reviewIdentity?: string | null }
  ) {
    await bootstrapDatabase();
    const existingLink = await pantryAttentionService.getGroceryLinkByOperation(input.operationIdentity);
    if (existingLink) {
      const existingItem = await prisma.groceryItem.findUnique({ where: { id: existingLink.groceryItemId } });
      if (!existingItem) throw new Error("Linked grocery item not found");
      return this.getGroceryList(existingItem.groceryListId);
    }

    const pantryItem = await pantryService.get(pantryItemId);
    if (!pantryItem) throw new Error("Pantry item not found");

    let currentList = await this.getCurrentGroceryList();
    if (!currentList) {
      currentList = await this.createGroceryList({ name: "Pantry Restock", date: null });
    }
    const maxOrder = await prisma.groceryItem.aggregate({
      where: { groceryListId: currentList.id },
      _max: { sortOrder: true },
    });
    const groceryItem = await prisma.groceryItem.create({
      data: {
        groceryListId: currentList.id,
        name: pantryItem.name,
        category: "Pantry",
        notes: "Added from Pantry. Confirm purchase through Pantry review.",
        checked: false,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });
    await publishCommittedChange("groceryList", "update", currentList.id);

    await pantryAttentionService.createGroceryLink(pantryItemId, {
      groceryItemId: groceryItem.id,
      operationIdentity: input.operationIdentity,
      reviewIdentity: input.reviewIdentity ?? null,
    });
    return this.getGroceryList(currentList.id);
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

    const list = await getListOrThrow(id);
    await Promise.all(list.items.map((item) =>
      this.transitionPantryLink(item.id, "removed", `grocery-list:${id}:item:${item.id}:removed`)
    ));

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
      select: { groceryListId: true, checked: true },
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

    if (input.checked !== undefined && input.checked !== existing.checked) {
      await this.transitionPantryLink(
        itemId,
        input.checked ? "checked" : "active",
        input.operationIdentity ?? `grocery-item:${itemId}:${input.checked ? "checked" : "unchecked"}`
      );
    }

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

    await this.transitionPantryLink(itemId, "removed", `grocery-item:${itemId}:removed`);

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

    const current = await getListOrThrow(snapshot.id);
    const restoredIds = new Set(snapshot.items.map((item) => item.id));
    await Promise.all(current.items
      .filter((item) => !restoredIds.has(item.id))
      .map((item) => this.transitionPantryLink(item.id, "removed", `grocery-snapshot:${snapshot.id}:item:${item.id}:removed`)));

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

    await this.transitionPantryLink(
      itemId,
      checked ? "checked" : "active",
      `grocery-item:${itemId}:${checked ? "checked" : "unchecked"}`
    );

    await publishCommittedChange("groceryList", "update", item.groceryList.id);
    return serializeGroceryList({
      ...item.groceryList,
      items: item.groceryList.items,
    });
  }
}
