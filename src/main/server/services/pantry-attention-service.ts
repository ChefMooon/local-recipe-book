import {
  PantryAttentionMutationSchema,
  PantryGroceryLinkCreateSchema,
  PantryGroceryLinkLifecycleSchema,
  type PantryAttentionClear,
  type PantryAttentionMutation,
  type PantryGroceryLinkCreate,
  type PantryGroceryLinkLifecycle,
} from "@shared/schemas/pantry-attention-schemas";
import type { PantryAttentionPayload, PantryGroceryLinkPayload } from "@shared/types";
import { bootstrapDatabase } from "../lib/bootstrap";
import { prisma } from "../lib/prisma";
import { derivePantryAttention, type PantryAttentionView } from "./pantry-attention-policy";

type AttentionRow = {
  id: string;
  pantryItemId: string;
  source: string;
  expiresAt: Date | null;
  groceryLinkId: string | null;
  operationIdentity: string;
  reviewIdentity: string | null;
  active: boolean;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type LinkRow = {
  id: string;
  pantryItemId: string;
  groceryItemId: string;
  status: string;
  active: boolean;
  operationIdentity: string;
  reviewIdentity: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  groceryItemName?: string | null;
  groceryListId?: string | null;
  groceryListName?: string | null;
};

function serializeAttention(row: AttentionRow): PantryAttentionPayload {
  return {
    id: row.id,
    pantryItemId: row.pantryItemId,
    source: row.source as PantryAttentionPayload["source"],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    groceryLinkId: row.groceryLinkId,
    operationIdentity: row.operationIdentity,
    reviewIdentity: row.reviewIdentity,
    active: row.active,
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLink(row: LinkRow): PantryGroceryLinkPayload {
  return {
    id: row.id,
    pantryItemId: row.pantryItemId,
    groceryItemId: row.groceryItemId,
    groceryItemName: row.groceryItemName ?? null,
    groceryListId: row.groceryListId ?? null,
    groceryListName: row.groceryListName ?? null,
    status: row.status as PantryGroceryLinkPayload["status"],
    active: row.active,
    operationIdentity: row.operationIdentity,
    reviewIdentity: row.reviewIdentity,
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PantryAttentionService {
  async getAttention(pantryItemId: string) {
    await bootstrapDatabase();
    const row = await prisma.pantryAttention.findFirst({
      where: { pantryItemId, active: true },
      orderBy: { createdAt: "desc" },
    });
    return row ? serializeAttention(row as AttentionRow) : null;
  }

  async getAttentionView(
    pantryItemId: string,
    input: {
      status: "ok" | "low" | "empty" | "expiring-soon" | "expired";
      forecast: {
        state: "disabled" | "available" | "unavailable";
        attention: boolean;
      };
    }
  ): Promise<PantryAttentionView> {
    await bootstrapDatabase();
    const attentionDelegate = (prisma as unknown as { pantryAttention?: typeof prisma.pantryAttention }).pantryAttention;
    if (!attentionDelegate) {
      return derivePantryAttention({ ...input, persisted: null, linkedActive: false });
    }
    const row = await attentionDelegate.findFirst({
      where: { pantryItemId, active: true },
      orderBy: { createdAt: "desc" },
    });
    const groceryLinkDelegate = (prisma as unknown as { pantryGroceryLink?: typeof prisma.pantryGroceryLink }).pantryGroceryLink;
    const link = row?.source === "grocery-link" && row.groceryLinkId && groceryLinkDelegate
      ? await groceryLinkDelegate.findUnique({ where: { id: row.groceryLinkId } })
      : null;
    return derivePantryAttention({
      ...input,
      persisted: row ? serializeAttention(row as AttentionRow) : null,
      linkedActive: link?.active === true && link.status === "active",
    });
  }

  async setAttention(pantryItemId: string, input: PantryAttentionMutation) {
    const parsed = PantryAttentionMutationSchema.parse(input);
    await bootstrapDatabase();
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.pantryAttention.findUnique({
        where: { operationIdentity: parsed.operationIdentity },
      });
      if (existing) return existing;

      if (parsed.groceryLinkId) {
        const link = await tx.pantryGroceryLink.findUnique({ where: { id: parsed.groceryLinkId } });
        if (!link || link.pantryItemId !== pantryItemId) {
          throw new Error("Pantry grocery link not found");
        }
      }

      await tx.pantryAttention.updateMany({
        where: { pantryItemId, active: true },
        data: { active: false, closedAt: new Date(), closeReason: "replaced" },
      });
      return tx.pantryAttention.create({
        data: {
          pantryItemId,
          source: parsed.source,
          expiresAt: parsed.source === "snooze"
            ? new Date(Date.now() + 7 * 86_400_000)
            : parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          groceryLinkId: parsed.groceryLinkId ?? null,
          operationIdentity: parsed.operationIdentity,
          reviewIdentity: parsed.reviewIdentity ?? null,
          active: true,
        },
      });
    });
    return serializeAttention(row as AttentionRow);
  }

  async clearAttention(pantryItemId: string, input: PantryAttentionClear) {
    await bootstrapDatabase();
    const row = await prisma.pantryAttention.updateMany({
      where: { id: input.attentionId, pantryItemId, active: true },
      data: {
        active: false,
        closedAt: new Date(),
        closeReason: "cleared",
        reviewIdentity: input.reviewIdentity ?? null,
      },
    });
    return { cleared: row.count > 0, operationIdentity: input.operationIdentity };
  }

  async reconcileRestock(pantryItemId: string, previousUsableQuantity: number | null, currentUsableQuantity: number | null) {
    await bootstrapDatabase();
    const attentionDelegate = (prisma as unknown as { pantryAttention?: typeof prisma.pantryAttention }).pantryAttention;
    if (!attentionDelegate || previousUsableQuantity == null || currentUsableQuantity == null || currentUsableQuantity <= previousUsableQuantity) {
      return { cleared: false };
    }
    const result = await attentionDelegate.updateMany({
      where: { pantryItemId, source: "until-restocked", active: true },
      data: {
        active: false,
        closedAt: new Date(),
        closeReason: "restocked",
      },
    });
    return { cleared: result.count > 0 };
  }

  async getGroceryLink(pantryItemId: string) {
    await bootstrapDatabase();
    const row = await prisma.pantryGroceryLink.findFirst({
      where: { pantryItemId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const groceryItem = await prisma.groceryItem.findUnique({
      where: { id: row.groceryItemId },
      include: { groceryList: true },
    });
    return serializeLink({
      ...(row as LinkRow),
      groceryItemName: groceryItem?.name ?? null,
      groceryListId: groceryItem?.groceryListId ?? null,
      groceryListName: groceryItem?.groceryList?.name ?? null,
    });
  }

  async getGroceryLinkByOperation(operationIdentity: string) {
    await bootstrapDatabase();
    const row = await prisma.pantryGroceryLink.findUnique({ where: { operationIdentity } });
    return row ? serializeLink(row as LinkRow) : null;
  }

  async createGroceryLink(pantryItemId: string, input: PantryGroceryLinkCreate) {
    const parsed = PantryGroceryLinkCreateSchema.parse(input);
    await bootstrapDatabase();
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.pantryGroceryLink.findUnique({
        where: { operationIdentity: parsed.operationIdentity },
      });
      if (existing) return existing;

      const groceryItem = await tx.groceryItem.findUnique({ where: { id: parsed.groceryItemId } });
      if (!groceryItem) throw new Error("Grocery item not found");
      await tx.pantryGroceryLink.updateMany({
        where: { pantryItemId, active: true },
        data: { active: false, status: "unlinked", closedAt: new Date(), closeReason: "replaced" },
      });
      const link = await tx.pantryGroceryLink.create({
        data: {
          pantryItemId,
          groceryItemId: parsed.groceryItemId,
          status: "active",
          active: true,
          operationIdentity: parsed.operationIdentity,
          reviewIdentity: parsed.reviewIdentity ?? null,
        },
      });
      const attentionOperationIdentity = `grocery-link:${parsed.operationIdentity}`;
      const existingAttention = await tx.pantryAttention.findUnique({ where: { operationIdentity: attentionOperationIdentity } });
      if (!existingAttention) {
        await tx.pantryAttention.updateMany({
          where: { pantryItemId, active: true },
          data: { active: false, closedAt: new Date(), closeReason: "replaced" },
        });
        await tx.pantryAttention.create({
          data: {
            pantryItemId,
            source: "grocery-link",
            expiresAt: null,
            groceryLinkId: link.id,
            operationIdentity: attentionOperationIdentity,
            reviewIdentity: parsed.reviewIdentity ?? null,
            active: true,
          },
        });
      }
      return link;
    });
    return serializeLink(row as LinkRow);
  }

  async updateGroceryLinkLifecycle(input: PantryGroceryLinkLifecycle) {
    const parsed = PantryGroceryLinkLifecycleSchema.parse(input);
    await bootstrapDatabase();
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.pantryGroceryLink.findUnique({
        where: { operationIdentity: parsed.operationIdentity },
      });
      if (existing) return existing;

      const link = await tx.pantryGroceryLink.findUnique({ where: { id: parsed.linkId } });
      if (!link) throw new Error("Pantry grocery link not found");
      const updated = await tx.pantryGroceryLink.update({
        where: { id: parsed.linkId },
        data: {
          status: parsed.status,
          active: parsed.status === "active",
          closedAt: parsed.status === "active" ? null : new Date(),
          closeReason: parsed.status === "active" ? null : parsed.status,
          operationIdentity: parsed.operationIdentity,
          reviewIdentity: parsed.reviewIdentity ?? null,
        },
      });

      const attentionOperationIdentity = `grocery-link:${parsed.operationIdentity}`;
      const existingAttention = await tx.pantryAttention.findUnique({ where: { operationIdentity: attentionOperationIdentity } });
      if (parsed.status === "active") {
        if (!existingAttention) {
          await tx.pantryAttention.updateMany({
            where: { pantryItemId: link.pantryItemId, active: true },
            data: { active: false, closedAt: new Date(), closeReason: "replaced" },
          });
          await tx.pantryAttention.create({
            data: {
              pantryItemId: link.pantryItemId,
              source: "grocery-link",
              expiresAt: null,
              groceryLinkId: link.id,
              operationIdentity: attentionOperationIdentity,
              reviewIdentity: parsed.reviewIdentity ?? null,
              active: true,
            },
          });
        }
      } else if (!existingAttention) {
        await tx.pantryAttention.updateMany({
          where: { pantryItemId: link.pantryItemId, groceryLinkId: link.id, active: true },
          data: {
            active: false,
            closedAt: new Date(),
            closeReason: parsed.status,
            reviewIdentity: parsed.reviewIdentity ?? null,
          },
        });
      }
      return updated;
    });
    return serializeLink(row as LinkRow);
  }
}

export const pantryAttentionService = new PantryAttentionService();