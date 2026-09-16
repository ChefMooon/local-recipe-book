import { z } from "zod";
import {
  RECIPE_CANONICAL_UNITS,
  normalizeRecipeUnit,
} from "../recipe-units";

export const PANTRY_STOCK_MODES = [
  "always-available",
  "track-quantity",
  "replenish-to-target",
] as const;

export const PANTRY_EVENT_TYPES = [
  "add",
  "consume",
  "discard",
  "mark-empty",
  "correction",
  "imported-baseline",
] as const;

export const PANTRY_WARNING_SEVERITIES = ["info", "warning", "critical"] as const;

const trimmedString = z.string().trim().min(1);
const nullableTrimmedString = z.string().trim().min(1).nullable().optional();
const finiteQuantity = z.number().finite().nonnegative();
const positiveFiniteQuantity = z.number().finite().positive();

const unitSchema = z.preprocess((value) => {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim().toLowerCase();
  return normalizeRecipeUnit(trimmed) ?? trimmed;
}, z.string().trim().min(1).nullable().optional());

const dateSchema = z.string().datetime().nullable().optional();

export const PantryLocationInputSchema = z.object({
  location: trimmedString.default("Unspecified"),
  quantity: finiteQuantity.nullable().optional(),
  unit: unitSchema,
  approximate: z.boolean().default(false),
});

export const PantryAliasInputSchema = z.object({
  label: trimmedString,
});

export const PantryPackageInputSchema = z.object({
  label: trimmedString,
  quantity: finiteQuantity,
  unit: unitSchema.pipe(z.string().min(1)),
  dimension: z.enum(["volume", "weight", "count", "custom"]),
  confirmed: z.boolean().default(true),
  enabled: z.boolean().default(true),
}).superRefine((value, ctx) => {
  const actualDimension = pantryUnitDimension(value.unit);
  if (actualDimension !== "custom" && actualDimension !== value.dimension) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dimension"],
      message: `Unit ${value.unit} belongs to the ${actualDimension} dimension`,
    });
  }
});

export const PantryWarningRuleInputSchema = z.object({
  threshold: finiteQuantity,
  unit: unitSchema,
  severity: z.enum(PANTRY_WARNING_SEVERITIES).default("warning"),
  message: nullableTrimmedString,
  enabled: z.boolean().default(true),
});

export const PantryLotInputSchema = z.object({
  location: trimmedString.default("Unspecified"),
  quantity: finiteQuantity,
  unit: unitSchema,
  approximate: z.boolean().default(false),
  bestBeforeAt: dateSchema,
  expiresAt: dateSchema,
});

export const PantryStockSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("earliest-expiring-lots") }),
  z.object({ type: z.literal("aggregate") }),
  z.object({ type: z.literal("lot"), lotId: trimmedString }),
]);

const pantryItemFields = {
  name: trimmedString,
  category: trimmedString.default("Other"),
  stockMode: z.enum(PANTRY_STOCK_MODES).default("always-available"),
  warningThreshold: finiteQuantity.nullable().optional(),
  warningUnit: unitSchema,
  expirationWarningDays: z.number().int().nonnegative().nullable().optional(),
  replenishmentTarget: finiteQuantity.nullable().optional(),
  replenishmentUnit: unitSchema,
  replenishmentQuantity: finiteQuantity.nullable().optional(),
  dailyUsageQuantity: positiveFiniteQuantity.nullable().optional(),
  dailyUsageUnit: unitSchema,
  dailyUsageWarningDays: z.number().int().nonnegative().nullable().optional(),
  notes: nullableTrimmedString,
};

function validateDailyUsageFields(
  value: { dailyUsageQuantity?: number | null; dailyUsageUnit?: string | null },
  ctx: z.RefinementCtx
) {
  const hasQuantity = value.dailyUsageQuantity != null;
  const hasUnit = value.dailyUsageUnit != null;
  if (hasQuantity !== hasUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasQuantity ? "dailyUsageUnit" : "dailyUsageQuantity"],
      message: "Daily usage quantity and unit must be provided together",
    });
  }
}

export const CreatePantryItemSchema = z.object({
  ...pantryItemFields,
  aliases: z.array(PantryAliasInputSchema).default([]),
  locations: z.array(PantryLocationInputSchema).default([]),
  packages: z.array(PantryPackageInputSchema).default([]),
  warningRules: z.array(PantryWarningRuleInputSchema).default([]),
}).superRefine(validateDailyUsageFields);

export const UpdatePantryItemSchema = z.object({
  ...pantryItemFields,
  aliases: z.array(PantryAliasInputSchema).optional(),
  locations: z.array(PantryLocationInputSchema).optional(),
  packages: z.array(PantryPackageInputSchema).optional(),
  warningRules: z.array(PantryWarningRuleInputSchema).optional(),
}).superRefine(validateDailyUsageFields);

export const PantryStockActionSchema = z.object({
  type: z.enum(["add", "consume", "discard", "mark-empty", "correction"]),
  location: trimmedString.default("Unspecified"),
  quantity: finiteQuantity.nullable().optional(),
  unit: unitSchema,
  approximate: z.boolean().default(false),
  lotId: trimmedString.optional(),
  source: PantryStockSourceSchema.optional(),
  sourceIdentity: trimmedString.optional(),
  note: z.string().trim().optional(),
  occurredAt: z.string().datetime().optional(),
});

export const PantryPackageStockActionSchema = z.object({
  packageId: trimmedString,
  location: trimmedString.default("Unspecified"),
  packageCount: z.number().finite().int().positive(),
  mismatchResolution: z.enum(["package", "custom-unit"]).default("package"),
  receivedQuantity: positiveFiniteQuantity.optional(),
  receivedUnit: unitSchema,
  replaceLocationUnit: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.mismatchResolution === "custom-unit") {
    if (value.receivedQuantity == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["receivedQuantity"], message: "Enter the received quantity when resolving a unit mismatch" });
    }
    if (!value.receivedUnit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["receivedUnit"], message: "Enter the received unit when resolving a unit mismatch" });
    }
    if (!value.replaceLocationUnit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["replaceLocationUnit"], message: "Confirm replacing this location's stored unit" });
    }
  }
});

export const PantryQuerySchema = z.object({
  search: z.string().trim().optional(),
  filter: z.enum([
    "all",
    "low-stock",
    "empty",
    "expiring-soon",
    "expired",
    "always-available",
    "track-quantity",
    "replenish-to-target",
    "recent-updates",
    "forecast-attention",
  ]).default("all"),
  sort: z.enum(["name", "updated", "category", "status"]).default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export type PantryStockMode = (typeof PANTRY_STOCK_MODES)[number];
export type PantryEventType = (typeof PANTRY_EVENT_TYPES)[number];
export type PantryUnit = (typeof RECIPE_CANONICAL_UNITS)[number] | string;
export type CreatePantryItemInput = z.infer<typeof CreatePantryItemSchema>;
export type UpdatePantryItemInput = z.infer<typeof UpdatePantryItemSchema>;
export type PantryLotInput = z.infer<typeof PantryLotInputSchema>;
export type PantryStockActionInput = z.infer<typeof PantryStockActionSchema>;
export type PantryPackageStockActionInput = z.infer<typeof PantryPackageStockActionSchema>;
export type PantryQueryInput = z.infer<typeof PantryQuerySchema>;

export function normalizePantryIdentity(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function normalizePantryUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeRecipeUnit(value);
  const customUnit = value.trim().toLowerCase();
  return normalized ?? (customUnit || null);
}

export function pantryUnitDimension(unit: string | null | undefined) {
  const normalized = normalizePantryUnit(unit);
  if (!normalized) return "custom" as const;
  if (["ml", "l", "tsp", "tbsp", "fl oz", "cup", "pt", "qt"].includes(normalized)) return "volume" as const;
  if (["g", "kg", "oz", "lb"].includes(normalized)) return "weight" as const;
  if (["clove", "slice", "piece", "pinch", "dash", "count"].includes(normalized)) return "count" as const;
  return "custom" as const;
}