import { normalizePantryIdentity, normalizePantryUnit, pantryUnitDimension, PantryQuerySchema, type CreatePantryItemInput, type PantryPackageStockActionInput, type PantryQueryInput, type PantryStockActionInput, type UpdatePantryItemInput } from "@shared/schemas/pantry-schemas";
import type { PantryItemPayload, PantrySummaryPayload } from "@shared/types";
import { TO_G, TO_ML } from "../lib/unit-converter";
import { prisma } from "../lib/prisma";
import { bootstrapDatabase } from "../lib/bootstrap";
import { publishCommittedChange } from "./change-event-bus";
import { calculatePantryForecast } from "./pantry-forecast";

const DEFAULT_LOCATION = "Unspecified";
const DEFAULT_LOCATION_KEY = "unspecified";
const QUANTITY_TOLERANCE = 1e-8;

export type PantryLotSource = { id: string; quantity: number; unit: string | null; approximate: boolean; expiresAt: Date | null };

export function reconcilePantryLots(quantity: number | null, unit: string | null, lots: PantryLotSource[]) {
  const contributions = lots.map((lot) => ({ lot, quantity: convertCompatible(lot.quantity, lot.unit, unit) }));
  const incompatible = contributions.some((entry) => entry.quantity == null);
  const datedLotQuantity = contributions.reduce((total, entry) => total + (entry.quantity ?? 0), 0);
  const aggregateQuantity = quantity ?? 0;
  const difference = aggregateQuantity - datedLotQuantity;
  return {
    aggregateQuantity,
    datedLotQuantity,
    unassignedQuantity: Math.max(0, difference),
    state: incompatible ? "incompatible-lot-units" as const : Math.abs(difference) <= QUANTITY_TOLERANCE ? "consistent" as const : difference > 0 ? "aggregate-exceeds-lots" as const : "lots-exceed-aggregate" as const,
  };
}

type PantryWithRelations = Awaited<ReturnType<typeof findPantryItem>>;

async function findPantryItem(id: string) {
  return prisma.pantryItem.findUnique({
    where: { id },
    include: {
      aliases: true,
      locations: { include: { lots: true }, orderBy: { normalizedLocation: "asc" } },
      packages: { orderBy: { createdAt: "asc" } },
      warningRules: { orderBy: { createdAt: "asc" } },
    },
  });
}

function normalizeLocation(value: string | null | undefined) {
  const label = value?.trim() || DEFAULT_LOCATION;
  return { label, key: normalizePantryIdentity(label) || DEFAULT_LOCATION_KEY };
}

function convertCompatible(quantity: number, fromUnit: string | null, toUnit: string | null) {
  const from = normalizePantryUnit(fromUnit);
  const to = normalizePantryUnit(toUnit);
  if (!from || !to || from === to) return from === to ? quantity : null;
  if (pantryUnitDimension(from) !== pantryUnitDimension(to)) return null;
  if (pantryUnitDimension(from) === "volume") {
    return (quantity * TO_ML[from]) / TO_ML[to];
  }
  if (pantryUnitDimension(from) === "weight") {
    return (quantity * TO_G[from]) / TO_G[to];
  }
  return null;
}

function usableQuantity(item: NonNullable<PantryWithRelations>) {
  const comparable = item.locations.filter(
    (location) => location.quantity != null && !location.approximate && location.unit
  );
  const referenceUnit = comparable[0]?.unit ?? null;
  if (!referenceUnit) return null;

  const quantities = comparable.flatMap((location) => {
    const converted = convertCompatible(location.quantity as number, location.unit, referenceUnit);
    return converted == null ? [] : [converted];
  });
  return quantities.length > 0 ? quantities.reduce((total, value) => total + value, 0) : null;
}

function getStatus(item: NonNullable<PantryWithRelations>, now = new Date()): PantryItemPayload["status"] {
  const expired = item.locations.some((location) =>
    location.lots.some((lot) => lot.expiresAt && lot.expiresAt.getTime() < now.getTime() && lot.quantity > 0)
  );
  if (expired) return "expired";

  const expiringSoon = item.locations.some((location) =>
    location.lots.some((lot) => {
      if (!lot.expiresAt || lot.quantity <= 0 || item.expirationWarningDays == null) return false;
      const limit = now.getTime() + item.expirationWarningDays * 86_400_000;
      return lot.expiresAt.getTime() <= limit;
    })
  );
  if (expiringSoon) return "expiring-soon";

  if (item.stockMode === "always-available") return "ok";
  const quantity = usableQuantity(item);
  if (quantity == null || quantity <= 0) return "empty";
  if (item.stockMode === "replenish-to-target" && item.replenishmentTarget != null && quantity < item.replenishmentTarget) return "low";
  if (item.warningThreshold != null && quantity < item.warningThreshold) return "low";
  return "ok";
}

function serializeItem(item: NonNullable<PantryWithRelations>, includeEvents = false): PantryItemPayload {
  return {
    id: item.id,
    name: item.name,
    normalizedName: item.normalizedName,
    category: item.category,
    stockMode: item.stockMode,
    warningThreshold: item.warningThreshold,
    warningUnit: item.warningUnit,
    expirationWarningDays: item.expirationWarningDays,
    replenishmentTarget: item.replenishmentTarget,
    replenishmentUnit: item.replenishmentUnit,
    replenishmentQuantity: item.replenishmentQuantity,
    dailyUsageQuantity: item.dailyUsageQuantity,
    dailyUsageUnit: item.dailyUsageUnit,
    dailyUsageWarningDays: item.dailyUsageWarningDays,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    aliases: item.aliases.map((alias) => ({ id: alias.id, label: alias.label, normalizedAlias: alias.normalizedAlias })),
    locations: item.locations.map((location) => ({
      id: location.id,
      location: location.location,
      normalizedLocation: location.normalizedLocation,
      quantity: location.quantity,
      unit: location.unit,
      approximate: location.approximate,
      createdAt: location.createdAt.toISOString(),
      updatedAt: location.updatedAt.toISOString(),
      lots: location.lots.map((lot) => ({
        id: lot.id,
        quantity: lot.quantity,
        unit: lot.unit,
        approximate: lot.approximate,
        bestBeforeAt: lot.bestBeforeAt?.toISOString() ?? null,
        expiresAt: lot.expiresAt?.toISOString() ?? null,
        createdAt: lot.createdAt.toISOString(),
        updatedAt: lot.updatedAt.toISOString(),
      })),
    })),
    packages: item.packages.map((pack) => ({
      id: pack.id,
      label: pack.label,
      quantity: pack.quantity,
      unit: pack.unit,
      dimension: pack.dimension,
      confirmed: pack.confirmed,
      enabled: pack.enabled,
      createdAt: pack.createdAt.toISOString(),
      updatedAt: pack.updatedAt.toISOString(),
    })),
    warningRules: item.warningRules.map((rule) => ({
      id: rule.id,
      threshold: rule.threshold,
      unit: rule.unit,
      severity: rule.severity as "info" | "warning" | "critical",
      message: rule.message,
      enabled: rule.enabled,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    })),
    ...(includeEvents
      ? {
          events: [],
        }
      : {}),
    status: getStatus(item),
    usableQuantity: usableQuantity(item),
    forecast: calculatePantryForecast({
      dailyUsageQuantity: item.dailyUsageQuantity,
      dailyUsageUnit: item.dailyUsageUnit,
      dailyUsageWarningDays: item.dailyUsageWarningDays,
      locations: item.locations.map((location) => ({
        quantity: location.quantity,
        unit: location.unit,
        approximate: location.approximate,
        expired: location.lots.some((lot) => lot.expiresAt && lot.expiresAt.getTime() <= Date.now() && lot.quantity > 0),
      })),
    }),
  };
}

function itemData(input: CreatePantryItemInput | UpdatePantryItemInput) {
  return {
    name: input.name,
    normalizedName: normalizePantryIdentity(input.name),
    category: input.category,
    stockMode: input.stockMode,
    warningThreshold: input.warningThreshold ?? null,
    warningUnit: normalizePantryUnit(input.warningUnit),
    expirationWarningDays: input.expirationWarningDays ?? null,
    replenishmentTarget: input.replenishmentTarget ?? null,
    replenishmentUnit: normalizePantryUnit(input.replenishmentUnit),
    replenishmentQuantity: input.replenishmentQuantity ?? null,
    dailyUsageQuantity: input.dailyUsageQuantity ?? null,
    dailyUsageUnit: normalizePantryUnit(input.dailyUsageUnit),
    dailyUsageWarningDays: input.dailyUsageWarningDays ?? null,
    notes: input.notes ?? null,
  };
}

export class PantryService {
  async migrateLegacyStaples() {
    await bootstrapDatabase();
    const preferenceDelegate = (prisma as unknown as {
      userPreference?: { findUnique: (args: unknown) => Promise<{ pantryStaples: string } | null> };
    }).userPreference;
    if (!preferenceDelegate) return 0;
    const preference = await preferenceDelegate.findUnique({ where: { id: "default" } });
    if (!preference) return 0;

    let legacyValues: unknown;
    try {
      legacyValues = JSON.parse(preference.pantryStaples);
    } catch {
      return 0;
    }
    if (!Array.isArray(legacyValues)) return 0;

    const names = legacyValues.filter((value): value is string => typeof value === "string")
      .map((value) => value.trim()).filter(Boolean);
    const uniqueNames: string[] = [];
    const seenNames = new Set<string>();
    for (const name of names) {
      const normalizedName = normalizePantryIdentity(name);
      if (seenNames.has(normalizedName)) continue;
      seenNames.add(normalizedName);
      uniqueNames.push(name);
    }
    let created = 0;
    for (const name of uniqueNames) {
      const normalizedName = normalizePantryIdentity(name);
      const existing = await prisma.pantryItem.findUnique({ where: { normalizedName } });
      if (existing) continue;
      await prisma.pantryItem.create({ data: {
        name,
        normalizedName,
        category: "Legacy pantry staple",
        stockMode: "always-available",
        notes: "Migrated from legacy Pantry staples. Confirm this item in Pantry.",
      } });
      created += 1;
    }
    if (created > 0) await publishCommittedChange("pantry", "bulk");
    return created;
  }

  async list(input: Partial<PantryQueryInput> = {}) {
    await bootstrapDatabase();
    await this.migrateLegacyStaples();
    const query = PantryQuerySchema.parse(input);
    const items = await prisma.pantryItem.findMany({
      include: {
        aliases: true,
        locations: { include: { lots: true }, orderBy: { normalizedLocation: "asc" } },
        packages: { orderBy: { createdAt: "asc" } },
        warningRules: { orderBy: { createdAt: "asc" } },
      },
    });
    const search = input.search?.toLocaleLowerCase();
    const filtered = items.filter((item) => {
      const searchable = [item.name, item.normalizedName, item.category, ...item.aliases.map((alias) => alias.label), ...item.locations.map((location) => location.location)].join(" ").toLocaleLowerCase();
      if (search && !searchable.includes(search)) return false;
      const status = getStatus(item);
      if (query.filter === "low-stock" && status !== "low") return false;
      if (query.filter === "empty" && status !== "empty") return false;
      if (query.filter === "expiring-soon" && status !== "expiring-soon") return false;
      if (query.filter === "expired" && status !== "expired") return false;
      if (query.filter === "always-available" && item.stockMode !== "always-available") return false;
      if (query.filter === "track-quantity" && item.stockMode !== "track-quantity") return false;
      if (query.filter === "replenish-to-target" && item.stockMode !== "replenish-to-target") return false;
      if (query.filter === "recent-updates" && item.updatedAt.getTime() < Date.now() - 7 * 86_400_000) return false;
      if (query.filter === "forecast-attention" && !serializeItem(item).forecast.attention) return false;
      return true;
    });
    filtered.sort((left, right) => {
      const direction = query.direction === "asc" ? 1 : -1;
      if (query.sort === "name") return direction * left.normalizedName.localeCompare(right.normalizedName);
      if (query.sort === "category") return direction * left.category.localeCompare(right.category);
      if (query.sort === "status") return direction * getStatus(left).localeCompare(getStatus(right));
      return direction * (left.updatedAt.getTime() - right.updatedAt.getTime());
    });
    return filtered.map((item) => serializeItem(item));
  }

  async get(id: string, includeEvents = false) {
    await bootstrapDatabase();
    const item = await findPantryItem(id);
    if (!item) return null;
    const payload = serializeItem(item, includeEvents);
    if (includeEvents) {
      const events = await prisma.pantryInventoryEvent.findMany({ where: { itemId: id }, orderBy: { occurredAt: "desc" } });
      payload.events = events.map((event) => ({
        id: event.id,
        type: event.type,
        quantityDelta: event.quantityDelta,
        quantity: event.quantity,
        unit: event.unit,
        approximate: event.approximate,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        sourceIdentity: event.sourceIdentity,
        occurredAt: event.occurredAt.toISOString(),
        importedAt: event.importedAt?.toISOString() ?? null,
      }));
    }
    return payload;
  }

  async create(input: CreatePantryItemInput) {
    await bootstrapDatabase();
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.pantryItem.create({ data: itemData(input) });
      if (input.aliases.length) await tx.pantryAlias.createMany({ data: input.aliases.map((alias) => ({ itemId: item.id, label: alias.label, normalizedAlias: normalizePantryIdentity(alias.label) })) });
      if (input.locations.length) await tx.pantryLocationStock.createMany({ data: input.locations.map((location) => ({ itemId: item.id, location: normalizeLocation(location.location).label, normalizedLocation: normalizeLocation(location.location).key, quantity: location.quantity ?? null, unit: normalizePantryUnit(location.unit), approximate: location.approximate })) });
      if (input.packages.length) await tx.pantryPackage.createMany({ data: input.packages.map((pack) => ({ ...pack, itemId: item.id, unit: normalizePantryUnit(pack.unit) ?? pack.unit })) });
      if (input.warningRules.length) await tx.pantryWarningRule.createMany({ data: input.warningRules.map((rule) => ({ ...rule, itemId: item.id, unit: normalizePantryUnit(rule.unit), message: rule.message ?? null })) });
      return item;
    });
    await publishCommittedChange("pantry", "create", created.id);
    return this.get(created.id);
  }

  async update(id: string, input: UpdatePantryItemInput) {
    await bootstrapDatabase();
    const existing = await prisma.pantryItem.findUnique({ where: { id } });
    if (!existing) return null;
    await prisma.$transaction(async (tx) => {
      await tx.pantryItem.update({ where: { id }, data: itemData(input) });
      if (input.locations) {
        for (const location of input.locations) {
          const normalizedLocation = normalizeLocation(location.location);
          await tx.pantryLocationStock.upsert({
            where: { itemId_normalizedLocation: { itemId: id, normalizedLocation: normalizedLocation.key } },
            update: {
              location: normalizedLocation.label,
              quantity: location.quantity ?? null,
              unit: normalizePantryUnit(location.unit),
              approximate: location.approximate,
            },
            create: {
              itemId: id,
              location: normalizedLocation.label,
              normalizedLocation: normalizedLocation.key,
              quantity: location.quantity ?? null,
              unit: normalizePantryUnit(location.unit),
              approximate: location.approximate,
            },
          });
        }
      }
      if (input.aliases) {
        await tx.pantryAlias.deleteMany({ where: { itemId: id } });
        await tx.pantryAlias.createMany({ data: input.aliases.map((alias) => ({ itemId: id, label: alias.label, normalizedAlias: normalizePantryIdentity(alias.label) })) });
      }
      if (input.packages) {
        await tx.pantryPackage.deleteMany({ where: { itemId: id } });
        await tx.pantryPackage.createMany({ data: input.packages.map((pack) => ({ ...pack, itemId: id, unit: normalizePantryUnit(pack.unit) ?? pack.unit })) });
      }
      if (input.warningRules) {
        await tx.pantryWarningRule.deleteMany({ where: { itemId: id } });
        await tx.pantryWarningRule.createMany({ data: input.warningRules.map((rule) => ({ ...rule, itemId: id, unit: normalizePantryUnit(rule.unit), message: rule.message ?? null })) });
      }
    });
    await publishCommittedChange("pantry", "update", id);
    return this.get(id);
  }

  async remove(id: string) {
    await bootstrapDatabase();
    const deleted = await prisma.pantryItem.deleteMany({ where: { id } });
    if (deleted.count === 0) return false;
    await publishCommittedChange("pantry", "delete", id);
    return true;
  }

  async applyStockAction(id: string, input: PantryStockActionInput) {
    await bootstrapDatabase();
    await prisma.$transaction(async (tx) => {
      const item = await tx.pantryItem.findUnique({ where: { id } });
      if (!item) throw new Error("Pantry item not found");
      const location = normalizeLocation(input.location);
      const stock = await tx.pantryLocationStock.upsert({
        where: { itemId_normalizedLocation: { itemId: id, normalizedLocation: location.key } },
        update: {},
        create: { itemId: id, location: location.label, normalizedLocation: location.key, quantity: 0, unit: normalizePantryUnit(input.unit), approximate: input.approximate },
      });
      const unit = normalizePantryUnit(input.unit) ?? stock.unit;
      const current = stock.quantity ?? 0;
      const converted = input.quantity == null ? 0 : convertCompatible(input.quantity, unit, stock.unit);
      if (input.quantity != null && stock.quantity != null && converted == null) throw new Error("Pantry quantity units are incompatible");
      let next = current;
      const allocations: Array<{ lotId: string; quantity: number; unit: string | null }> = [];
      const source = input.source ?? (input.lotId ? { type: "lot" as const, lotId: input.lotId } : { type: "earliest-expiring-lots" as const });
      if (input.type === "mark-empty") next = 0;
      else if (input.type === "add") next += converted ?? input.quantity ?? 0;
      else if (input.type === "consume" || input.type === "discard") {
        const requested = converted ?? input.quantity ?? 0;
        const lots = await tx.pantryLot.findMany({ where: { locationStockId: stock.id, quantity: { gt: 0 } }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }] });
        const reconciliation = reconcilePantryLots(stock.quantity, stock.unit, lots);
        const candidates = source.type === "aggregate"
          ? []
          : source.type === "lot"
            ? lots.filter((lot) => lot.id === source.lotId)
            : lots.filter((lot) => !lot.expiresAt || lot.expiresAt.getTime() > Date.now());
        if (source.type === "lot" && candidates.length === 0) throw new Error("Selected Pantry lot was not found in this location");
        if (source.type === "aggregate" && reconciliation.unassignedQuantity + QUANTITY_TOLERANCE < requested) throw new Error("Unassigned Pantry stock is not sufficient for this action");
        let remaining = requested;
        for (const lot of candidates) {
          if (remaining <= QUANTITY_TOLERANCE) break;
          const lotQuantity = convertCompatible(lot.quantity, lot.unit, unit);
          if (lotQuantity == null) throw new Error("Pantry lot units are incompatible with this stock unit");
          const consumed = Math.min(lotQuantity, remaining);
          const lotConsumed = convertCompatible(consumed, unit, lot.unit);
          if (lotConsumed == null) throw new Error("Pantry lot units are incompatible with this stock unit");
          await tx.pantryLot.update({ where: { id: lot.id }, data: { quantity: Math.max(0, lot.quantity - lotConsumed) } });
          allocations.push({ lotId: lot.id, quantity: lotConsumed, unit: lot.unit });
          remaining -= consumed;
        }
        if (source.type !== "aggregate" && remaining > QUANTITY_TOLERANCE) throw new Error("Selected Pantry source is not sufficient for this action");
        next = Math.max(0, next - requested);
      }
      else if (input.type === "correction") next = input.quantity ?? 0;
      await tx.pantryLocationStock.update({ where: { id: stock.id }, data: { quantity: next, unit: stock.unit ?? unit, approximate: stock.approximate || input.approximate } });

      if (input.type === "mark-empty") {
        await tx.pantryLot.updateMany({ where: { locationStockId: stock.id }, data: { quantity: 0 } });
      }
      await tx.pantryInventoryEvent.create({ data: { itemId: id, locationStockId: stock.id, lotId: allocations.length === 1 ? allocations[0].lotId : null, type: input.type, quantityDelta: next - current, quantity: input.quantity ?? null, unit, approximate: input.approximate, sourceType: "manual", metadataJson: JSON.stringify({ action: input.type === "consume" ? "use-stock" : input.type, source: source.type, selectedLotId: source.type === "lot" ? source.lotId : null, allocations, note: input.note ?? null }), occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date() } });
      return stock.id;
    });
    await publishCommittedChange("pantry", "update", id);
    return this.get(id);
  }

  async applyPackageStockAction(id: string, input: PantryPackageStockActionInput) {
    await bootstrapDatabase();
    await prisma.$transaction(async (tx) => {
      const item = await tx.pantryItem.findUnique({ where: { id } });
      if (!item) throw new Error("Pantry item not found");
      const pack = await tx.pantryPackage.findUnique({ where: { id: input.packageId } });
      if (!pack || pack.itemId !== id) throw new Error("Pantry package was not found for this item");
      if (!pack.enabled) throw new Error("Pantry package is disabled");
      if (!pack.confirmed) throw new Error("Confirm this Pantry package before using it for stock");

      const location = normalizeLocation(input.location);
      const stock = await tx.pantryLocationStock.upsert({
        where: { itemId_normalizedLocation: { itemId: id, normalizedLocation: location.key } },
        update: {},
        create: { itemId: id, location: location.label, normalizedLocation: location.key, quantity: 0, unit: normalizePantryUnit(pack.unit), approximate: false },
      });
      const packageUnit = normalizePantryUnit(pack.unit) ?? pack.unit;
      const packageQuantity = pack.quantity * input.packageCount;
      let stockUnit = stock.unit ?? packageUnit;
      let addition = convertCompatible(packageQuantity, packageUnit, stockUnit);
      let eventQuantity = packageQuantity;
      let eventUnit = packageUnit;

      if (input.mismatchResolution === "custom-unit") {
        const receivedUnit = normalizePantryUnit(input.receivedUnit) as string;
        const receivedQuantity = input.receivedQuantity as number;
        if (stock.unit && stock.unit !== receivedUnit && !input.replaceLocationUnit) throw new Error(`Confirm replacing this location's stored unit with ${receivedUnit}`);
        stockUnit = receivedUnit;
        addition = receivedQuantity;
        eventQuantity = receivedQuantity;
        eventUnit = receivedUnit;
      }

      if (addition == null) {
        throw new Error(`Pantry package unit ${packageUnit} does not match location unit ${stock.unit ?? "none"}`);
      }

      const replacingUnit = input.mismatchResolution === "custom-unit" && stock.unit !== stockUnit;
      const current = replacingUnit ? 0 : stock.quantity ?? 0;
      await tx.pantryLocationStock.update({
        where: { id: stock.id },
        data: { quantity: current + addition, unit: stockUnit, approximate: stock.approximate },
      });
      await tx.pantryInventoryEvent.create({
        data: {
          itemId: id,
          locationStockId: stock.id,
          lotId: null,
          type: "add",
          quantityDelta: addition,
          quantity: eventQuantity,
          unit: eventUnit,
          approximate: false,
          sourceType: "package",
          sourceId: pack.id,
          metadataJson: JSON.stringify({ action: "add-package-stock", packageId: pack.id, packageLabel: pack.label, packageCount: input.packageCount, mismatchResolution: input.mismatchResolution }),
          occurredAt: new Date(),
        },
      });
    });
    await publishCommittedChange("pantry", "update", id);
    return this.get(id);
  }

  async addLot(id: string, input: { location: string; quantity: number; unit?: string | null; approximate?: boolean; bestBeforeAt?: string | null; expiresAt?: string | null }) {
    await bootstrapDatabase();
    const location = normalizeLocation(input.location);
    const lot = await prisma.$transaction(async (tx) => {
      const item = await tx.pantryItem.findUnique({ where: { id } });
      if (!item) throw new Error("Pantry item not found");
      const stock = await tx.pantryLocationStock.upsert({ where: { itemId_normalizedLocation: { itemId: id, normalizedLocation: location.key } }, update: {}, create: { itemId: id, location: location.label, normalizedLocation: location.key, quantity: 0, unit: normalizePantryUnit(input.unit), approximate: input.approximate ?? false } });
      const lotUnit = normalizePantryUnit(input.unit);
      const convertedQuantity = lotUnit && stock.unit ? convertCompatible(input.quantity, lotUnit, stock.unit) : input.quantity;
      if (convertedQuantity == null) throw new Error("Pantry lot units are incompatible with the selected location");
      await tx.pantryLocationStock.update({ where: { id: stock.id }, data: { quantity: (stock.quantity ?? 0) + convertedQuantity, unit: stock.unit ?? lotUnit, approximate: stock.approximate || (input.approximate ?? false) } });
      return tx.pantryLot.create({ data: { locationStockId: stock.id, quantity: input.quantity, unit: lotUnit, approximate: input.approximate ?? false, bestBeforeAt: input.bestBeforeAt ? new Date(input.bestBeforeAt) : null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
    });
    await publishCommittedChange("pantry", "update", id);
    return lot;
  }

  async removeLot(id: string, lotId: string) {
    await bootstrapDatabase();
    await prisma.$transaction(async (tx) => {
      const lot = await tx.pantryLot.findUnique({ where: { id: lotId }, include: { locationStock: true } });
      if (!lot || lot.locationStock.itemId !== id) throw new Error("Pantry lot not found");
      const remaining = lot.unit && lot.locationStock.unit
        ? convertCompatible(lot.quantity, lot.unit, lot.locationStock.unit)
        : lot.quantity;
      if (remaining == null) throw new Error("Pantry lot units are incompatible with its location");
      await tx.pantryLocationStock.update({ where: { id: lot.locationStockId }, data: { quantity: Math.max(0, (lot.locationStock.quantity ?? 0) - remaining) } });
      await tx.pantryInventoryEvent.create({ data: { itemId: id, locationStockId: lot.locationStockId, lotId, type: "discard", quantityDelta: -remaining, quantity: lot.quantity, unit: lot.unit, approximate: lot.approximate, sourceType: "manual", metadataJson: JSON.stringify({ action: "remove-lot" }), occurredAt: new Date() } });
      await tx.pantryLot.delete({ where: { id: lotId } });
    });
    await publishCommittedChange("pantry", "update", id);
  }

  async updateLot(id: string, lotId: string, input: { location: string; quantity: number; unit?: string | null; approximate?: boolean; bestBeforeAt?: string | null; expiresAt?: string | null }) {
    await bootstrapDatabase();
    const updatedLot = await prisma.$transaction(async (tx) => {
      const lot = await tx.pantryLot.findUnique({ where: { id: lotId }, include: { locationStock: true } });
      if (!lot || lot.locationStock.itemId !== id) throw new Error("Pantry lot not found");
      const nextLocation = normalizeLocation(input.location);
      const oldStock = lot.locationStock;
      const lotUnit = normalizePantryUnit(input.unit);
      const oldContribution = lot.unit && oldStock.unit ? convertCompatible(lot.quantity, lot.unit, oldStock.unit) : lot.quantity;
      if (oldContribution == null) throw new Error("Pantry lot units are incompatible with its location");
      const sameLocation = oldStock.normalizedLocation === nextLocation.key;
      const nextStock = sameLocation
        ? oldStock
        : await tx.pantryLocationStock.upsert({ where: { itemId_normalizedLocation: { itemId: id, normalizedLocation: nextLocation.key } }, update: {}, create: { itemId: id, location: nextLocation.label, normalizedLocation: nextLocation.key, quantity: 0, unit: lotUnit, approximate: input.approximate ?? false } });
      const newContribution = lotUnit && nextStock.unit ? convertCompatible(input.quantity, lotUnit, nextStock.unit) : input.quantity;
      if (newContribution == null) throw new Error("Pantry lot units are incompatible with the selected location");
      if (sameLocation) {
        await tx.pantryLocationStock.update({ where: { id: oldStock.id }, data: { quantity: Math.max(0, (oldStock.quantity ?? 0) - oldContribution + newContribution), unit: oldStock.unit ?? lotUnit, approximate: oldStock.approximate || (input.approximate ?? false) } });
      } else {
        await tx.pantryLocationStock.update({ where: { id: oldStock.id }, data: { quantity: Math.max(0, (oldStock.quantity ?? 0) - oldContribution) } });
        await tx.pantryLocationStock.update({ where: { id: nextStock.id }, data: { quantity: (nextStock.quantity ?? 0) + newContribution, unit: nextStock.unit ?? lotUnit, approximate: nextStock.approximate || (input.approximate ?? false) } });
      }
      const updated = await tx.pantryLot.update({ where: { id: lotId }, data: { locationStockId: nextStock.id, quantity: input.quantity, unit: lotUnit, approximate: input.approximate ?? false, bestBeforeAt: input.bestBeforeAt ? new Date(input.bestBeforeAt) : null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
      await tx.pantryInventoryEvent.create({ data: { itemId: id, locationStockId: nextStock.id, lotId, type: "correction", quantityDelta: newContribution - oldContribution, quantity: input.quantity, unit: lotUnit, approximate: input.approximate ?? false, sourceType: "manual", metadataJson: JSON.stringify({ action: "update-lot" }), occurredAt: new Date() } });
      return updated;
    });
    await publishCommittedChange("pantry", "update", id);
    return updatedLot;
  }

  async addPackage(id: string, input: { label: string; quantity: number; unit: string; dimension: string; confirmed?: boolean; enabled?: boolean }) {
    await bootstrapDatabase();
    const pack = await prisma.pantryPackage.create({ data: { itemId: id, label: input.label.trim(), quantity: input.quantity, unit: normalizePantryUnit(input.unit) ?? input.unit.trim().toLowerCase(), dimension: input.dimension, confirmed: input.confirmed ?? true, enabled: input.enabled ?? true } });
    await publishCommittedChange("pantry", "update", id);
    return pack;
  }

  async addWarning(id: string, input: { threshold: number; unit?: string | null; severity?: string; message?: string | null; enabled?: boolean }) {
    await bootstrapDatabase();
    const rule = await prisma.pantryWarningRule.create({ data: { itemId: id, threshold: input.threshold, unit: normalizePantryUnit(input.unit), severity: input.severity ?? "warning", message: input.message ?? null, enabled: input.enabled ?? true } });
    await publishCommittedChange("pantry", "update", id);
    return rule;
  }

  async events(id: string) {
    await bootstrapDatabase();
    return prisma.pantryInventoryEvent.findMany({ where: { itemId: id }, orderBy: { occurredAt: "desc" } });
  }

  async summary(): Promise<PantrySummaryPayload> {
    const items = await this.list({ filter: "all", sort: "name", direction: "asc" });
    return {
      trackedItems: items.length,
      lowStock: items.filter((item) => item.status === "low").length,
      empty: items.filter((item) => item.status === "empty").length,
      expiringSoon: items.filter((item) => item.status === "expiring-soon").length,
      expired: items.filter((item) => item.status === "expired").length,
      forecastAttention: items.filter((item) => item.forecast.attention).length,
    };
  }

  async analysis(period: 30 | 90 | 365 | "all") {
    await bootstrapDatabase();
    const events = await prisma.pantryInventoryEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    const now = Date.now();
    const cutoff = period === "all" ? null : now - period * 86_400_000;
    const filtered = events.filter((event) => cutoff == null || event.occurredAt.getTime() >= cutoff);
    const historyStart = events[0]?.occurredAt ?? null;
    const historyEnd = events.at(-1)?.occurredAt ?? null;
    const weekly = new Map<string, number>();
    const consumed = new Map<string, number>();
    for (const event of filtered) {
      const week = new Date(event.occurredAt);
      week.setDate(week.getDate() - week.getDay());
      const weekLabel = week.toISOString().slice(0, 10);
      weekly.set(weekLabel, (weekly.get(weekLabel) ?? 0) + (event.type === "consume" || event.type === "discard" ? Math.abs(event.quantityDelta ?? 0) : 0));
      if (event.type === "consume" || event.type === "discard") {
        consumed.set(event.itemId, (consumed.get(event.itemId) ?? 0) + Math.abs(event.quantityDelta ?? 0));
      }
    }
    const items = await this.list({ filter: "all", sort: "name", direction: "asc" });
    const itemNames = new Map(items.map((item) => [item.id, item.name]));
    const historyDays = historyStart ? Math.max(1, Math.round((now - historyStart.getTime()) / 86_400_000)) : 0;
    const dataQuality = events.length === 0 ? "insufficient" : historyDays < (period === "all" ? 30 : period) ? "partial" : "full";
    return {
      period,
      historyStart: historyStart?.toISOString() ?? null,
      historyEnd: historyEnd?.toISOString() ?? null,
      dataQuality,
      estimate: dataQuality !== "full",
      eventCount: filtered.length,
      weeklyTrend: [...weekly.entries()].map(([weekLabel, consumedQuantity]) => ({ weekLabel, consumedQuantity })),
      topConsumed: [...consumed.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10).map(([itemId, quantity]) => ({ itemId, itemName: itemNames.get(itemId) ?? "Unknown item", quantity })),
    };
  }
}

export const pantryService = new PantryService();
