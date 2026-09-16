import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { normalizePantryUnit, pantryUnitDimension } from "@shared/schemas/pantry-schemas";
import { TO_G, TO_ML } from "../lib/unit-converter";
import { publishCommittedChange } from "./change-event-bus";

const QUANTITY_TOLERANCE = 1e-8;

type TransactionClient = Prisma.TransactionClient;

type DailyUsageItem = {
  id: string;
  dailyUsageQuantity: number | null;
  dailyUsageUnit: string | null;
  dailyUsageState: {
    id: string;
    configRevision: number;
    baselineLocalDate: string;
    lastAppliedLocalDate: string;
  } | null;
};

type StockWithLots = {
  id: string;
  quantity: number | null;
  unit: string | null;
  lots: Array<{ id: string; quantity: number; unit: string | null; expiresAt: Date | null; createdAt: Date }>;
};

export function localDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareLocalDates(left: string, right: string) {
  return left.localeCompare(right);
}

function addLocalDate(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function convertCompatible(quantity: number, fromUnit: string | null, toUnit: string | null) {
  const from = normalizePantryUnit(fromUnit);
  const to = normalizePantryUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return quantity;
  if (pantryUnitDimension(from) !== pantryUnitDimension(to)) return null;
  if (pantryUnitDimension(from) === "volume") return (quantity * TO_ML[from]) / TO_ML[to];
  if (pantryUnitDimension(from) === "weight") return (quantity * TO_G[from]) / TO_G[to];
  return null;
}

function orderedLots(lots: StockWithLots["lots"]) {
  return [...lots].sort((left, right) => {
    if (left.expiresAt && right.expiresAt) return left.expiresAt.getTime() - right.expiresAt.getTime();
    if (left.expiresAt) return -1;
    if (right.expiresAt) return 1;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

async function allocateConsumption(
  tx: TransactionClient,
  itemId: string,
  requestedQuantity: number,
  requestedUnit: string
) {
  const locations = await tx.pantryLocationStock.findMany({
    where: { itemId },
    include: { lots: true },
    orderBy: { normalizedLocation: "asc" },
  }) as StockWithLots[];
  let remaining = requestedQuantity;
  let removed = 0;

  for (const location of locations) {
    if (remaining <= QUANTITY_TOLERANCE || location.quantity == null || !location.unit) break;
    const availableInRequestedUnit = convertCompatible(location.quantity, location.unit, requestedUnit);
    if (availableInRequestedUnit == null || availableInRequestedUnit <= QUANTITY_TOLERANCE) continue;

    let locationRemaining = Math.min(availableInRequestedUnit, remaining);
    for (const lot of orderedLots(location.lots)) {
      if (locationRemaining <= QUANTITY_TOLERANCE || lot.quantity <= QUANTITY_TOLERANCE) break;
      const lotInLocationUnit = convertCompatible(lot.quantity, lot.unit, location.unit);
      if (lotInLocationUnit == null) continue;
      const consumedInLocationUnit = Math.min(lotInLocationUnit, convertCompatible(locationRemaining, requestedUnit, location.unit) ?? 0);
      if (consumedInLocationUnit <= QUANTITY_TOLERANCE) continue;
      const consumedInLotUnit = convertCompatible(consumedInLocationUnit, location.unit, lot.unit);
      if (consumedInLotUnit == null) continue;
      await tx.pantryLot.update({
        where: { id: lot.id },
        data: { quantity: Math.max(0, lot.quantity - consumedInLotUnit) },
      });
      const consumedInRequestedUnit = convertCompatible(consumedInLocationUnit, location.unit, requestedUnit) ?? 0;
      locationRemaining -= consumedInRequestedUnit;
      remaining -= consumedInRequestedUnit;
      removed += consumedInRequestedUnit;
    }

    const aggregateConsumption = Math.min(locationRemaining, remaining);
    if (aggregateConsumption > QUANTITY_TOLERANCE) {
      remaining -= aggregateConsumption;
      removed += aggregateConsumption;
    }
    const consumedFromLocation = Math.min(availableInRequestedUnit, availableInRequestedUnit - locationRemaining);
    const consumedInLocationUnit = convertCompatible(consumedFromLocation, requestedUnit, location.unit) ?? 0;
    await tx.pantryLocationStock.update({
      where: { id: location.id },
      data: { quantity: Math.max(0, location.quantity - consumedInLocationUnit) },
    });
  }

  return { removed, remaining };
}

async function reconcileItemDate(
  item: DailyUsageItem,
  date: string,
  now: Date
) {
  if (!item.dailyUsageState || item.dailyUsageQuantity == null || !item.dailyUsageUnit) return false;
  const sourceIdentity = `pantry-daily-usage:${item.id}:${item.dailyUsageState.configRevision}:${date}`;

  try {
    const changed = await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.pantryInventoryEvent.findUnique({ where: { sourceIdentity } });
      if (existingEvent) {
        await tx.pantryDailyUsageState.update({
          where: { itemId: item.id },
          data: { lastAppliedLocalDate: date },
        });
        return false;
      }
      const allocation = await allocateConsumption(tx, item.id, item.dailyUsageQuantity as number, item.dailyUsageUnit as string);
      if (allocation.removed <= QUANTITY_TOLERANCE) {
        await tx.pantryDailyUsageState.update({
          where: { itemId: item.id },
          data: { lastAppliedLocalDate: date },
        });
        return false;
      }
      await tx.pantryInventoryEvent.create({
        data: {
          itemId: item.id,
          type: "consume",
          quantityDelta: -allocation.removed,
          quantity: allocation.removed,
          unit: item.dailyUsageUnit,
          approximate: false,
          sourceType: "automatic-daily-usage",
          sourceIdentity,
          metadataJson: JSON.stringify({ action: "automatic-daily-usage", localDate: date, requestedQuantity: item.dailyUsageQuantity, remainingUnfulfilled: allocation.remaining }),
          occurredAt: now,
        },
      });
      await tx.pantryDailyUsageState.update({
        where: { itemId: item.id },
        data: { lastAppliedLocalDate: date },
      });
      return true;
    });
    return changed;
  } catch (error) {
    if (error instanceof Error && /unique constraint|unique constraint failed/i.test(error.message)) return false;
    throw error;
  }
}

export async function reconcilePantryDailyUsage(now = new Date()) {
  const today = localDateKey(now);
  const items = await prisma.pantryItem.findMany({
    where: { dailyUsageQuantity: { gt: 0 }, dailyUsageUnit: { not: null } },
    select: {
      id: true,
      dailyUsageQuantity: true,
      dailyUsageUnit: true,
      dailyUsageState: true,
    },
  }) as DailyUsageItem[];
  const changedItemIds = new Set<string>();

  for (const item of items) {
    const state = item.dailyUsageState;
    if (!state) {
      try {
        await prisma.pantryDailyUsageState.create({
          data: { itemId: item.id, baselineLocalDate: today, lastAppliedLocalDate: today },
        });
      } catch (error) {
        if (!(error instanceof Error) || !/unique constraint|unique constraint failed/i.test(error.message)) throw error;
      }
      continue;
    }
    if (compareLocalDates(state.lastAppliedLocalDate, today) >= 0) continue;
    let date = addLocalDate(state.lastAppliedLocalDate, 1);
    while (compareLocalDates(date, today) <= 0) {
      const changed = await reconcileItemDate(item, date, now);
      if (changed) changedItemIds.add(item.id);
      date = addLocalDate(date, 1);
      if (!changed) {
        const refreshed = await prisma.pantryLocationStock.findMany({ where: { itemId: item.id }, select: { quantity: true } });
        if (refreshed.every((location) => location.quantity == null || location.quantity <= QUANTITY_TOLERANCE)) {
          await prisma.pantryDailyUsageState.update({ where: { itemId: item.id }, data: { lastAppliedLocalDate: today } });
          break;
        }
      }
    }
  }

  await Promise.all([...changedItemIds].map((id) => publishCommittedChange("pantry", "update", id)));
  return { processed: items.length, changed: changedItemIds.size };
}
