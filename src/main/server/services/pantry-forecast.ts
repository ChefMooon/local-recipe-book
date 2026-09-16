import { normalizePantryUnit, pantryUnitDimension } from "@shared/schemas/pantry-schemas";
import { TO_G, TO_ML } from "../lib/unit-converter";

export type PantryForecastUnavailableReason =
  | "missing-daily-usage"
  | "missing-stock"
  | "approximate-stock"
  | "incompatible-unit"
  | "expired-stock";

export type PantryForecast = {
  state: "disabled" | "available" | "unavailable";
  reason: PantryForecastUnavailableReason | null;
  severity: "info" | "warning" | "critical";
  attention: boolean;
  remainingQuantity: number | null;
  remainingUnit: string | null;
  remainingDays: number | null;
  projectedRunOutAt: string | null;
  estimate: {
    isEstimate: true;
    source: "location-quantity";
    evaluatedAt: string;
  };
};

type ForecastLocation = {
  quantity: number | null;
  unit: string | null;
  approximate: boolean;
  expired: boolean;
};

type ForecastInput = {
  dailyUsageQuantity: number | null;
  dailyUsageUnit: string | null;
  dailyUsageWarningDays: number | null;
  locations: ForecastLocation[];
  now?: Date;
};

function convertCompatible(quantity: number, fromUnit: string, toUnit: string): number | null {
  const from = normalizePantryUnit(fromUnit);
  const to = normalizePantryUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return quantity;
  const dimension = pantryUnitDimension(from);
  if (dimension !== pantryUnitDimension(to)) return null;
  if (dimension === "volume" && TO_ML[from] && TO_ML[to]) return (quantity * TO_ML[from]) / TO_ML[to];
  if (dimension === "weight" && TO_G[from] && TO_G[to]) return (quantity * TO_G[from]) / TO_G[to];
  return null;
}

function unavailable(
  reason: PantryForecastUnavailableReason,
  now: Date,
  attention = true
): PantryForecast {
  return {
    state: "unavailable",
    reason,
    severity: attention ? "warning" : "info",
    attention,
    remainingQuantity: null,
    remainingUnit: null,
    remainingDays: null,
    projectedRunOutAt: null,
    estimate: { isEstimate: true, source: "location-quantity", evaluatedAt: now.toISOString() },
  };
}

export function calculatePantryForecast(input: ForecastInput): PantryForecast {
  const now = input.now ?? new Date();
  const dailyUnit = normalizePantryUnit(input.dailyUsageUnit);
  if (input.dailyUsageQuantity == null || !dailyUnit) {
    return {
      ...unavailable("missing-daily-usage", now, false),
      state: "disabled",
      reason: "missing-daily-usage",
    };
  }
  if (input.locations.length === 0 || input.locations.some((location) => location.quantity == null || !location.unit)) {
    return unavailable("missing-stock", now);
  }
  if (input.locations.some((location) => location.approximate)) return unavailable("approximate-stock", now);
  if (input.locations.some((location) => location.expired)) return unavailable("expired-stock", now);

  let remainingQuantity = 0;
  for (const location of input.locations) {
    const converted = convertCompatible(location.quantity as number, location.unit as string, dailyUnit);
    if (converted == null) return unavailable("incompatible-unit", now);
    remainingQuantity += converted;
  }

  const remainingDays = remainingQuantity / input.dailyUsageQuantity;
  const projectedRunOutAt = new Date(now.getTime() + remainingDays * 86_400_000).toISOString();
  const attention = remainingDays <= (input.dailyUsageWarningDays ?? 0);
  return {
    state: "available",
    reason: null,
    severity: remainingDays <= 0 ? "critical" : attention ? "warning" : "info",
    attention,
    remainingQuantity,
    remainingUnit: dailyUnit,
    remainingDays,
    projectedRunOutAt,
    estimate: { isEstimate: true, source: "location-quantity", evaluatedAt: now.toISOString() },
  };
}
