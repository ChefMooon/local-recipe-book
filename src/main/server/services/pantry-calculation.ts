import { normalizePantryIdentity, normalizePantryUnit, pantryUnitDimension } from "@shared/schemas/pantry-schemas";
import type { PantryItemPayload } from "@shared/types";
import { TO_G, TO_ML } from "../lib/unit-converter";
import { prisma } from "../lib/prisma";

type PantryCandidate = Pick<PantryItemPayload, "id" | "name" | "normalizedName" | "stockMode" | "aliases" | "locations" | "packages" | "replenishmentTarget" | "replenishmentUnit">;

export type PantryMatch = {
  item: PantryCandidate | null;
  status: "matched" | "ambiguous" | "suggestion" | "unmatched";
  suggestions: Array<{ id: string; name: string; score: number }>;
  explanation: string | null;
};

export type PantryCalculation = {
  requiredQuantity: number | null;
  quantity: number | null;
  unit: string | null;
  explanation: string | null;
  packageSuggestion: { label: string; count: number } | null;
  match: PantryMatch;
};

function compatibleQuantity(quantity: number, fromUnit: string | null, toUnit: string | null) {
  const from = normalizePantryUnit(fromUnit);
  const to = normalizePantryUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return quantity;
  if (pantryUnitDimension(from) !== pantryUnitDimension(to)) return null;
  if (pantryUnitDimension(from) === "volume" && TO_ML[from] && TO_ML[to]) {
    return (quantity * TO_ML[from]) / TO_ML[to];
  }
  if (pantryUnitDimension(from) === "weight" && TO_G[from] && TO_G[to]) {
    return (quantity * TO_G[from]) / TO_G[to];
  }
  return null;
}

export function comparePantryQuantity(
  requiredQuantity: number | null,
  requiredUnit: string | null,
  stock: Array<{ quantity: number | null; unit: string | null; approximate: boolean }>,
  replenishmentTarget: number | null = null,
  replenishmentUnit: string | null = null
) {
  if (requiredQuantity == null || !requiredUnit || stock.some((entry) => entry.approximate)) {
    return { quantity: requiredQuantity, explanation: requiredQuantity == null ? "The recipe quantity is unspecified." : "Approximate pantry stock cannot be subtracted automatically." };
  }

  const comparable = stock.flatMap((entry) => {
    if (entry.quantity == null) return [];
    const converted = compatibleQuantity(entry.quantity, entry.unit, requiredUnit);
    return converted == null ? [] : [converted];
  });
  if (comparable.length !== stock.filter((entry) => entry.quantity != null).length) {
    return { quantity: requiredQuantity, explanation: "Pantry stock uses an incompatible or custom unit, so the full requirement is preserved." };
  }

  const available = comparable.reduce((total, value) => total + value, 0);
  let target = requiredQuantity;
  if (replenishmentTarget != null && replenishmentUnit) {
    const convertedTarget = compatibleQuantity(replenishmentTarget, replenishmentUnit, requiredUnit);
    if (convertedTarget != null) target = Math.max(target, convertedTarget);
  }
  const shortfall = Math.max(0, target - available);
  return {
    quantity: shortfall,
    explanation: shortfall === 0 ? "Usable pantry stock covers the requirement." : null,
  };
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let row = 1; row <= right.length; row += 1) {
    let previous = rows[0];
    rows[0] = row;
    for (let column = 1; column <= left.length; column += 1) {
      const current = rows[column];
      rows[column] = Math.min(
        rows[column] + 1,
        rows[column - 1] + 1,
        previous + (left[column - 1] === right[row - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return rows[left.length];
}

export function matchPantryCandidate(name: string, candidates: PantryCandidate[]): PantryMatch {
  const normalized = normalizePantryIdentity(name);
  const exact = candidates.filter(
    (candidate) =>
      candidate.normalizedName === normalized ||
      candidate.aliases.some((alias) => alias.normalizedAlias === normalized)
  );
  if (exact.length === 1) {
    return { item: exact[0], status: "matched", suggestions: [], explanation: null };
  }
  if (exact.length > 1) {
    return {
      item: null,
      status: "ambiguous",
      suggestions: exact.map((candidate) => ({ id: candidate.id, name: candidate.name, score: 1 })),
      explanation: "More than one Pantry item matches this ingredient; choose one explicitly.",
    };
  }

  const suggestions = candidates
    .map((candidate) => {
      const values = [candidate.normalizedName, ...candidate.aliases.map((alias) => alias.normalizedAlias)];
      const distance = Math.min(...values.map((value) => editDistance(normalized, value)));
      const score = 1 - distance / Math.max(normalized.length, values[0].length, 1);
      return { id: candidate.id, name: candidate.name, score };
    })
    .filter((candidate) => candidate.score >= 0.55)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  return {
    item: null,
    status: suggestions.length ? "suggestion" : "unmatched",
    suggestions,
    explanation: suggestions.length ? "A likely Pantry match needs confirmation." : "No Pantry item matches this ingredient.",
  };
}

export async function calculatePantryRequirement(
  name: string,
  requiredQuantity: number | null,
  requiredUnit: string | null
): Promise<PantryCalculation> {
  const candidates = await prisma.pantryItem.findMany({
    include: { aliases: true, locations: true, packages: true },
  });
  const match = matchPantryCandidate(name, candidates);
  if (!match.item) {
    return { requiredQuantity, quantity: requiredQuantity, unit: requiredUnit, explanation: match.explanation, packageSuggestion: null, match };
  }
  if (match.item.stockMode === "always-available") {
    return { requiredQuantity, quantity: null, unit: requiredUnit, explanation: "Always-available Pantry item skipped.", packageSuggestion: null, match };
  }

  const comparison = comparePantryQuantity(
    requiredQuantity,
    requiredUnit,
    match.item.locations,
    match.item.replenishmentTarget,
    match.item.replenishmentUnit
  );
  const packageCandidate = match.item.packages.find((pack) => pack.enabled && pack.confirmed && comparison.quantity != null && compatibleQuantity(pack.quantity, pack.unit, requiredUnit) != null);
  const packageQuantity = packageCandidate && requiredUnit ? compatibleQuantity(packageCandidate.quantity, packageCandidate.unit, requiredUnit) : null;
  return {
    requiredQuantity,
    quantity: comparison.quantity,
    unit: requiredUnit,
    explanation: comparison.explanation,
    packageSuggestion: packageCandidate && packageQuantity && packageQuantity > 0 && comparison.quantity != null && comparison.quantity > 0
      ? { label: packageCandidate.label, count: Math.ceil(comparison.quantity / packageQuantity) }
      : null,
    match,
  };
}