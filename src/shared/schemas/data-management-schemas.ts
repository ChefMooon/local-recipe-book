import { z } from "zod";

export const DATA_ARCHIVE_FORMAT = "local-recipe-book" as const;
export const DATA_ARCHIVE_FORMAT_VERSION = 1 as const;
export const DATA_ARCHIVE_SCHEMA_VERSION = 1 as const;
export const DATA_ARCHIVE_DOMAIN_VERSION = 1 as const;
export const DATA_ARCHIVE_EXTENSION = ".lrb" as const;
export const DATA_ARCHIVE_FILE_PREFIX = "local-recipe-book" as const;

export const DATA_ARCHIVE_LAYOUT = {
  manifest: "manifest.json",
  domains: {
    "meal-plan": "data/meal-plan.json",
    recipes: "data/recipes.json",
    grocery: "data/grocery.json",
    "prep-lists": "data/prep-lists.json",
    preferences: "data/preferences.json",
    pantry: "data/pantry.json",
  },
  assets: {
    mealPhotos: "assets/meal-photos",
  },
} as const;

export const ExportScopeSchema = z.enum(["meal-plan", "recipes", "all"]);
export type ExportScope = z.infer<typeof ExportScopeSchema>;

export const DataArchiveDomainSchema = z.enum([
  "meal-plan",
  "recipes",
  "grocery",
  "prep-lists",
  "preferences",
  "pantry",
]);
export type DataArchiveDomain = z.infer<typeof DataArchiveDomainSchema>;

export const DATA_ARCHIVE_SCOPE_DOMAINS = {
  "meal-plan": ["meal-plan", "recipes"],
  recipes: ["recipes"],
  all: ["meal-plan", "recipes", "grocery", "prep-lists", "preferences", "pantry"],
} as const satisfies Record<ExportScope, readonly DataArchiveDomain[]>;

export const SAFE_PREFERENCE_FIELDS = [
  "householdSize",
  "cookingLength",
  "dietaryTags",
  "favoriteCuisines",
  "avoidCuisines",
  "avoidIngredients",
  "pantryStaples",
  "planningNotes",
  "nutritionTags",
  "skillLevel",
  "budgetRange",
  "autoGenerateGrocery",
  "consolidateIngredients",
  "autoReviewPantry",
  "defaultPlanLength",
  "groceryGrouping",
  "defaultRecipeView",
  "defaultUnitMode",
] as const;
export type SafePreferenceField = (typeof SAFE_PREFERENCE_FIELDS)[number];

export const DATA_ARCHIVE_ASSET_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const DataArchiveAssetMimeTypeSchema = z.enum(
  DATA_ARCHIVE_ASSET_MIME_TYPES
);
export type DataArchiveAssetMimeType = z.infer<
  typeof DataArchiveAssetMimeTypeSchema
>;

const DATA_ARCHIVE_ASSET_EXTENSIONS = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<DataArchiveAssetMimeType, string>;

const DATA_ARCHIVE_MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(DATA_ARCHIVE_ASSET_EXTENSIONS).map(([mimeType, extension]) => [
    extension,
    mimeType,
  ])
) as Record<string, DataArchiveAssetMimeType>;

const archiveIdSchema = z.string().trim().min(1).max(200);
const archiveTextSchema = z.string().max(50_000);
const archiveNullableTextSchema = archiveTextSchema.nullable();
const archiveDateSchema = z.string().datetime({ offset: true });
const archiveNullableDateSchema = archiveDateSchema.nullable();
const archiveNonNegativeIntegerSchema = z.number().int().nonnegative();

function isSafeArchiveEntryPath(path: string) {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

export function isMealPhotoArchivePath(path: string) {
  if (!isSafeArchiveEntryPath(path)) {
    return false;
  }

  const prefix = `${DATA_ARCHIVE_LAYOUT.assets.mealPhotos}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  const fileName = path.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(avif|gif|jpg|png|webp)$/i.test(
    fileName
  );
}

export function isCanonicalArchiveEntryPath(path: string) {
  return (
    path === DATA_ARCHIVE_LAYOUT.manifest ||
    Object.values(DATA_ARCHIVE_LAYOUT.domains).some(
      (domainPath) => domainPath === path
    ) ||
    isMealPhotoArchivePath(path)
  );
}

export const ArchiveEntryPathSchema = z
  .string()
  .trim()
  .refine(isSafeArchiveEntryPath, "Archive entry path is unsafe")
  .refine(
    isCanonicalArchiveEntryPath,
    "Archive entry path is not part of the canonical layout"
  );

export function getDataArchiveAssetExtension(
  mimeType: DataArchiveAssetMimeType
) {
  return DATA_ARCHIVE_ASSET_EXTENSIONS[mimeType];
}

export function getDataArchiveAssetMimeType(extension: string) {
  return DATA_ARCHIVE_MIME_BY_EXTENSION[
    extension.toLowerCase().replace(/^\./, "")
  ];
}

export function getMealPhotoArchivePath(
  mealId: string,
  mimeType: DataArchiveAssetMimeType
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mealId)) {
    throw new Error("Meal IDs must be safe archive path components");
  }

  return `${DATA_ARCHIVE_LAYOUT.assets.mealPhotos}/meal-${mealId}.${getDataArchiveAssetExtension(mimeType)}`;
}

export const ArchiveMetadataSchema = z
  .object({
    format: z.literal(DATA_ARCHIVE_FORMAT),
    formatVersion: z.literal(DATA_ARCHIVE_FORMAT_VERSION),
    schemaVersion: z.literal(DATA_ARCHIVE_SCHEMA_VERSION),
    appVersion: z.string().trim().min(1).max(64),
    exportedAt: archiveDateSchema,
    scope: ExportScopeSchema,
  })
  .strict();
export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

export const ArchiveDomainDescriptorSchema = z
  .object({
    domain: DataArchiveDomainSchema,
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    path: ArchiveEntryPathSchema,
  })
  .strict();
export type ArchiveDomainDescriptor = z.infer<
  typeof ArchiveDomainDescriptorSchema
>;

export const ArchiveIdPolicySchema = z
  .object({
    sourceIds: z.literal("preserved"),
    importIdMap: z.literal("required"),
  })
  .strict();

export const AssetManifestEntrySchema = z
  .object({
    id: archiveIdSchema,
    kind: z.literal("meal-photo"),
    path: z
      .string()
      .refine(isMealPhotoArchivePath, "Invalid meal photo asset path"),
    mealId: archiveIdSchema,
    mimeType: DataArchiveAssetMimeTypeSchema,
    originalFileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[\\/\0]/.test(value),
        "Filename must not contain a path"
      ),
    size: z.number().int().positive(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 checksum"),
  })
  .strict()
  .superRefine((asset, context) => {
    const extension = asset.path
      .slice(asset.path.lastIndexOf(".") + 1)
      .toLowerCase();
    if (getDataArchiveAssetMimeType(extension) !== asset.mimeType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "Asset path extension does not match MIME type",
      });
    }
  });
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const ArchiveManifestSchema = ArchiveMetadataSchema.extend({
  domains: z.array(ArchiveDomainDescriptorSchema).min(1),
  assets: z.array(AssetManifestEntrySchema),
  idPolicy: ArchiveIdPolicySchema,
})
  .strict()
  .superRefine((manifest, context) => {
    const expectedDomains = DATA_ARCHIVE_SCOPE_DOMAINS[manifest.scope];
    const seenDomains = new Set<DataArchiveDomain>();

    for (const descriptor of manifest.domains) {
      if (seenDomains.has(descriptor.domain)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["domains"],
          message: `Duplicate domain descriptor: ${descriptor.domain}`,
        });
      }
      seenDomains.add(descriptor.domain);

      if (descriptor.path !== DATA_ARCHIVE_LAYOUT.domains[descriptor.domain]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["domains"],
          message: `Unexpected path for domain ${descriptor.domain}`,
        });
      }
    }

    for (const domain of expectedDomains) {
      if (!seenDomains.has(domain)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["domains"],
          message: `Missing domain descriptor: ${domain}`,
        });
      }
    }

    if (seenDomains.size !== expectedDomains.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["domains"],
        message: "Manifest contains a domain outside the selected scope",
      });
    }

    const assetPaths = new Set<string>();
    for (const asset of manifest.assets) {
      if (assetPaths.has(asset.path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets"],
          message: `Duplicate asset path: ${asset.path}`,
        });
      }
      assetPaths.add(asset.path);
    }

    if (manifest.scope === "recipes" && manifest.assets.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "Recipe-only archives cannot contain meal photo assets",
      });
    }
  });
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;

const archiveSummarySchema = z
  .object({
    id: archiveIdSchema,
    title: z.string().trim().min(1).max(500),
  })
  .strict();

export const MealIngredientArchiveSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    quantity: z.string().nullable(),
    unit: z.string().nullable(),
    group: z.string().nullable(),
    notes: z.string().nullable(),
    order: archiveNonNegativeIntegerSchema,
  })
  .strict();

export const RecipeIngredientArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(500),
    quantity: z.number().finite().nonnegative().nullable(),
    quantityNumerator: z.number().int().nonnegative().nullable(),
    quantityDenominator: z.number().int().positive().nullable(),
    unit: z.string().nullable(),
    group: z.string().nullable(),
    notes: z.string().nullable(),
    parseConfidence: z.enum(["high", "low"]).nullable(),
    parseRaw: z.string().nullable(),
    order: archiveNonNegativeIntegerSchema,
  })
  .strict();

export const RecipeLinkArchiveRecordSchema = z
  .object({
    id: archiveIdSchema,
    parentId: archiveIdSchema,
    subRecipeId: archiveIdSchema,
  })
  .strict();
export type RecipeLinkArchiveRecord = z.infer<
  typeof RecipeLinkArchiveRecordSchema
>;

export const RecipeArchiveRecordSchema = z
  .object({
    id: archiveIdSchema,
    title: z.string().trim().min(1).max(500),
    description: archiveNullableTextSchema,
    servings: z.number().int().positive(),
    prepTime: z.number().int().nonnegative().nullable(),
    cookTime: z.number().int().nonnegative().nullable(),
    difficulty: z.string().nullable(),
    cuisine: z.string().nullable(),
    instructions: z.array(z.string().trim().min(1).max(10_000)),
    sourceUrl: z.string().url().nullable(),
    sourceLabel: z.string().nullable(),
    origin: z.enum(["manual", "imported"]),
    favourite: z.boolean(),
    rating: z.number().int().min(1).max(5).nullable(),
    cookNotes: z.string().nullable(),
    lastMadeAt: archiveNullableDateSchema,
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
    sourceRecipeId: archiveIdSchema.nullable(),
    sourceRecipe: archiveSummarySchema.nullable(),
    ingredients: z.array(RecipeIngredientArchiveSchema),
    tags: z.array(z.string().trim().min(1).max(200)),
    linkedSubRecipes: z.array(archiveSummarySchema),
  })
  .strict();
export type RecipeArchiveRecord = z.infer<typeof RecipeArchiveRecordSchema>;

export const MealTypeDefinitionArchiveSchema = z
  .object({
    id: archiveIdSchema,
    profileId: archiveIdSchema,
    name: z.string().trim().min(1).max(200),
    slug: z.string().trim().min(1).max(200),
    color: z.string().trim().min(1).max(32),
    enabled: z.boolean(),
    sortOrder: z.number().int(),
    cutoffTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .default("23:59"),
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
  })
  .strict();

export const MealSubTypeDefinitionArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(200),
    slug: z.string().trim().min(1).max(200),
    color: z.string().trim().min(1).max(32),
    enabled: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
  })
  .strict();

export const MealTypeProfileArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(200),
    color: z.string().trim().min(1).max(32),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    priority: z.number().int(),
    startDate: archiveNullableDateSchema,
    endDate: archiveNullableDateSchema,
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
  })
  .strict();

export const MealArchiveRecordSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(500),
    date: archiveNullableDateSchema,
    mealType: z.string().trim().min(1).max(100),
    mealTypeDefinitionId: archiveIdSchema.nullable(),
    mealSubTypeDefinitionId: archiveIdSchema.nullable(),
    notes: z.string().nullable(),
    ingredients: z.array(MealIngredientArchiveSchema),
    description: z.string().nullable(),
    instructions: z.array(z.string().max(10_000)),
    sortOrder: z.number().int(),
    servings: z.number().int().positive(),
    prepTime: z.number().int().nonnegative().nullable(),
    cookTime: z.number().int().nonnegative().nullable(),
    cuisine: z.string().nullable(),
    servingsOverride: z.number().int().positive().nullable(),
    recipeId: archiveIdSchema.nullable(),
    photoAssetId: archiveIdSchema.nullable(),
    createdAt: archiveDateSchema,
  })
  .strict();
export type MealArchiveRecord = z.infer<typeof MealArchiveRecordSchema>;

export const MealPlanPayloadSchema = z
  .object({
    domain: z.literal("meal-plan"),
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    meals: z.array(MealArchiveRecordSchema),
    mealTypeProfiles: z.array(MealTypeProfileArchiveSchema),
    mealTypeDefinitions: z.array(MealTypeDefinitionArchiveSchema),
    mealSubTypeDefinitions: z.array(MealSubTypeDefinitionArchiveSchema),
  })
  .strict();
export type MealPlanPayload = z.infer<typeof MealPlanPayloadSchema>;

export const RecipesPayloadSchema = z
  .object({
    domain: z.literal("recipes"),
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    recipes: z.array(RecipeArchiveRecordSchema),
    links: z.array(RecipeLinkArchiveRecordSchema),
  })
  .strict();
export type RecipesPayload = z.infer<typeof RecipesPayloadSchema>;

export const GroceryItemArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(500),
    qty: z.string().nullable(),
    unit: z.string().nullable(),
    category: z.string().trim().min(1).max(200),
    notes: z.string().nullable(),
    meal: z.string().nullable(),
    checked: z.boolean(),
    sortOrder: z.number().int(),
  })
  .strict();

export const GroceryListArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(500),
    date: archiveNullableDateSchema,
    favourite: z.boolean(),
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
    items: z.array(GroceryItemArchiveSchema),
  })
  .strict();

export const GroceryPayloadSchema = z
  .object({
    domain: z.literal("grocery"),
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    lists: z.array(GroceryListArchiveSchema),
  })
  .strict();
export type GroceryPayload = z.infer<typeof GroceryPayloadSchema>;

export const PrepItemArchiveSchema = z
  .object({
    id: archiveIdSchema,
    kind: z.enum(["ingredient", "task"]),
    name: z.string().trim().min(1).max(500),
    qty: z.string().nullable(),
    unit: z.string().nullable(),
    ingredientType: z.string().nullable(),
    prepGroup: z.string().nullable(),
    dish: z.string().nullable(),
    notes: z.string().nullable(),
    checked: z.boolean(),
    sortOrder: z.number().int(),
    sourceMealIds: z.array(archiveIdSchema),
    sourceRecipeIds: z.array(archiveIdSchema),
    sourceLabels: z.array(z.string().max(500)),
  })
  .strict();

export const PrepListArchiveSchema = z
  .object({
    id: archiveIdSchema,
    name: z.string().trim().min(1).max(500),
    notes: z.string().nullable(),
    date: archiveNullableDateSchema,
    fromDate: archiveNullableDateSchema,
    toDate: archiveNullableDateSchema,
    sourceMode: z.enum([
      "manual",
      "single-meal",
      "meal-slot",
      "day",
      "week",
      "month",
      "date-range",
      "historical",
    ]),
    sourceLabel: z.string().nullable(),
    sourceMealIds: z.array(archiveIdSchema),
    sourceRecipeIds: z.array(archiveIdSchema),
    favourite: z.boolean(),
    sortMode: z.enum(["manual", "name", "dish", "type", "kind", "checked"]),
    groupBy: z.enum(["dish", "type", "prepGroup", "kind", "none"]),
    includeIngredients: z.boolean(),
    includeTasks: z.boolean(),
    includeQuantities: z.boolean(),
    includeIngredientTypes: z.boolean(),
    includeSourceLabels: z.boolean(),
    excludePantryStaples: z.boolean(),
    createdAt: archiveDateSchema,
    updatedAt: archiveDateSchema,
    items: z.array(PrepItemArchiveSchema),
  })
  .strict();

export const PrepListsPayloadSchema = z
  .object({
    domain: z.literal("prep-lists"),
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    lists: z.array(PrepListArchiveSchema),
  })
  .strict();
export type PrepListsPayload = z.infer<typeof PrepListsPayloadSchema>;

export const SafePreferencesSchema = z
  .object({
    householdSize: z.number().int().positive(),
    cookingLength: z.string().max(200),
    dietaryTags: z.array(z.string().max(200)),
    favoriteCuisines: z.array(z.string().max(200)),
    avoidCuisines: z.array(z.string().max(200)),
    avoidIngredients: z.array(z.string().max(500)),
    pantryStaples: z.array(z.string().max(500)),
    planningNotes: z.string().max(50_000),
    nutritionTags: z.array(z.string().max(200)),
    skillLevel: z.string().max(200),
    budgetRange: z.string().max(200),
    autoGenerateGrocery: z.boolean(),
    consolidateIngredients: z.boolean(),
    autoReviewPantry: z.boolean().default(true),
    defaultPlanLength: z.string().max(50),
    groceryGrouping: z.string().max(200),
    defaultRecipeView: z.string().max(200),
    defaultUnitMode: z.string().max(200),
  })
  .strict();
export type SafePreferences = z.infer<typeof SafePreferencesSchema>;

export const PreferencesArchiveRecordSchema = SafePreferencesSchema.extend({
  id: archiveIdSchema,
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
}).strict();

export const PreferencesPayloadSchema = z
  .object({
    domain: z.literal("preferences"),
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
    preferences: z.array(PreferencesArchiveRecordSchema).max(1),
  })
  .strict();
export type DataArchivePreferencesPayload = z.infer<
  typeof PreferencesPayloadSchema
>;

const PantryAliasArchiveSchema = z.object({
  id: archiveIdSchema,
  label: z.string().trim().min(1).max(500),
  normalizedAlias: z.string().trim().min(1).max(500),
  createdAt: archiveDateSchema,
}).passthrough();

const PantryLotArchiveSchema = z.object({
  id: archiveIdSchema,
  quantity: z.number().finite().nonnegative(),
  unit: z.string().nullable(),
  approximate: z.boolean(),
  bestBeforeAt: archiveNullableDateSchema,
  expiresAt: archiveNullableDateSchema,
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
}).passthrough();

const PantryLocationArchiveSchema = z.object({
  id: archiveIdSchema,
  location: z.string().trim().min(1).max(500),
  normalizedLocation: z.string().trim().min(1).max(500),
  quantity: z.number().finite().nullable(),
  unit: z.string().nullable(),
  approximate: z.boolean(),
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
  lots: z.array(PantryLotArchiveSchema),
}).passthrough();

const PantryPackageArchiveSchema = z.object({
  id: archiveIdSchema,
  label: z.string().trim().min(1).max(500),
  quantity: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1).max(100),
  dimension: z.string().trim().min(1).max(100),
  confirmed: z.boolean(),
  enabled: z.boolean(),
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
}).passthrough();

const PantryWarningArchiveSchema = z.object({
  id: archiveIdSchema,
  threshold: z.number().finite().nonnegative(),
  unit: z.string().nullable(),
  severity: z.string().trim().min(1).max(50),
  message: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
}).passthrough();

const PantryEventArchiveSchema = z.object({
  id: archiveIdSchema,
  itemId: archiveIdSchema,
  locationStockId: archiveIdSchema.nullable(),
  lotId: archiveIdSchema.nullable(),
  type: z.string().trim().min(1).max(100),
  quantityDelta: z.number().finite().nullable(),
  quantity: z.number().finite().nullable(),
  unit: z.string().nullable(),
  approximate: z.boolean(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceIdentity: z.string().nullable(),
  metadataJson: z.string(),
  occurredAt: archiveDateSchema,
  importedAt: archiveNullableDateSchema,
}).passthrough();

const pantryDailyUsageQuantitySchema = z.number().finite().positive().nullable().optional().default(null);
const pantryDailyUsageUnitSchema = z.string().trim().min(1).max(100).nullable().optional().default(null);
const pantryDailyUsageWarningDaysSchema = z.number().int().nonnegative().nullable().optional().default(null);

export const PantryArchiveItemSchema = z.object({
  id: archiveIdSchema,
  name: z.string().trim().min(1).max(500),
  normalizedName: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(200),
  stockMode: z.string().trim().min(1).max(100),
  warningThreshold: z.number().finite().nullable(),
  warningUnit: z.string().nullable(),
  expirationWarningDays: z.number().int().nonnegative().nullable(),
  replenishmentTarget: z.number().finite().nullable(),
  replenishmentUnit: z.string().nullable(),
  replenishmentQuantity: z.number().finite().nullable(),
  dailyUsageQuantity: pantryDailyUsageQuantitySchema,
  dailyUsageUnit: pantryDailyUsageUnitSchema,
  dailyUsageWarningDays: pantryDailyUsageWarningDaysSchema,
  notes: z.string().nullable(),
  createdAt: archiveDateSchema,
  updatedAt: archiveDateSchema,
  aliases: z.array(PantryAliasArchiveSchema),
  locations: z.array(PantryLocationArchiveSchema),
  packages: z.array(PantryPackageArchiveSchema),
  warningRules: z.array(PantryWarningArchiveSchema),
}).passthrough().superRefine((item, context) => {
  const hasQuantity = item.dailyUsageQuantity != null;
  const hasUnit = item.dailyUsageUnit != null;
  if (hasQuantity !== hasUnit) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [hasQuantity ? "dailyUsageUnit" : "dailyUsageQuantity"], message: "Daily usage quantity and unit must be provided together" });
  }
});
export type PantryArchiveItem = z.infer<typeof PantryArchiveItemSchema>;

export const PantryPayloadSchema = z.object({
  domain: z.literal("pantry"),
  version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
  historyIncluded: z.boolean(),
  items: z.array(PantryArchiveItemSchema),
  events: z.array(PantryEventArchiveSchema),
}).passthrough();
export type PantryPayload = z.infer<typeof PantryPayloadSchema>;

export const DomainPayloadEnvelopeSchema = z
  .object({
    domain: DataArchiveDomainSchema,
    version: z.literal(DATA_ARCHIVE_DOMAIN_VERSION),
  })
  .strict();

export const DataArchivePayloadSchema = z.discriminatedUnion("domain", [
  MealPlanPayloadSchema,
  RecipesPayloadSchema,
  GroceryPayloadSchema,
  PrepListsPayloadSchema,
  PreferencesPayloadSchema,
  PantryPayloadSchema,
]);
export type DataArchivePayload = z.infer<typeof DataArchivePayloadSchema>;

export const ImportModeSchema = z.enum(["merge", "replace"]);
export type ImportMode = z.infer<typeof ImportModeSchema>;

export const ArchiveIdMapSchema = z
  .object({
    meals: z.record(archiveIdSchema, archiveIdSchema),
    recipes: z.record(archiveIdSchema, archiveIdSchema),
    groceryLists: z.record(archiveIdSchema, archiveIdSchema),
    groceryItems: z.record(archiveIdSchema, archiveIdSchema),
    prepLists: z.record(archiveIdSchema, archiveIdSchema),
    prepItems: z.record(archiveIdSchema, archiveIdSchema),
    mealTypeProfiles: z.record(archiveIdSchema, archiveIdSchema),
    mealTypeDefinitions: z.record(archiveIdSchema, archiveIdSchema),
    mealSubTypeDefinitions: z.record(archiveIdSchema, archiveIdSchema),
    preferences: z.record(archiveIdSchema, archiveIdSchema),
    pantryItems: z.record(archiveIdSchema, archiveIdSchema),
    assets: z.record(archiveIdSchema, archiveIdSchema),
  })
  .strict();
export type ArchiveIdMap = z.infer<typeof ArchiveIdMapSchema>;

export const ConflictBulkDecisionSchema = z.enum([
  "keep-local",
  "import",
  "skip",
]);
export type ConflictBulkDecision = z.infer<typeof ConflictBulkDecisionSchema>;

export const ArchiveValidationErrorCodeSchema = z.enum([
  "INVALID_ARCHIVE",
  "UNSUPPORTED_FORMAT_VERSION",
  "INVALID_MANIFEST",
  "INVALID_LAYOUT",
  "INVALID_DOMAIN_PAYLOAD",
  "MISSING_ENTRY",
  "UNKNOWN_ENTRY",
  "PATH_TRAVERSAL",
  "ARCHIVE_TOO_LARGE",
  "TOO_MANY_ENTRIES",
  "ASSET_TOO_LARGE",
  "TOO_MANY_ASSETS",
  "UNSUPPORTED_ASSET_TYPE",
  "CHECKSUM_MISMATCH",
]);
export type ArchiveValidationErrorCode = z.infer<
  typeof ArchiveValidationErrorCodeSchema
>;

export const ArchiveValidationErrorSchema = z
  .object({
    code: ArchiveValidationErrorCodeSchema,
    message: z.string().min(1).max(2_000),
    path: z.array(z.union([z.string(), z.number()])).default([]),
    entryPath: z.string().nullable().optional(),
  })
  .strict();
export type ArchiveValidationError = z.infer<
  typeof ArchiveValidationErrorSchema
>;

export const ArchiveValidationErrorsSchema = z
  .object({
    errors: z.array(ArchiveValidationErrorSchema).min(1),
  })
  .strict();

export const ConflictDomainSchema = z.enum([
  "meal",
  "recipe",
  "grocery-list",
  "grocery-item",
  "prep-list",
  "prep-item",
  "meal-type-profile",
  "meal-type-definition",
  "meal-sub-type-definition",
  "preferences",
  "pantry-item",
]);

export const ConflictRecordSchema = z
  .object({
    id: archiveIdSchema,
    domain: ConflictDomainSchema,
    identity: z.string().trim().min(1).max(500),
    reason: z.enum(["same-id", "same-identity", "reference-conflict"]),
    localSummary: z.record(z.string(), z.unknown()),
    importedSummary: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ConflictRecord = z.infer<typeof ConflictRecordSchema>;

export const ConflictDecisionSchema = z
  .object({
    conflictId: archiveIdSchema,
    decision: z.enum(["keep-local", "import", "replace", "skip"]),
  })
  .strict();
export type ConflictDecision = z.infer<typeof ConflictDecisionSchema>;

export const ImportSummarySchema = z
  .object({
    mode: ImportModeSchema,
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    replaced: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    assets: z
      .object({
        imported: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    preferencesRestored: z.boolean(),
  })
  .strict();
export type ImportSummary = z.infer<typeof ImportSummarySchema>;

export const ArchiveImportRequestSchema = z
  .object({
    mode: ImportModeSchema,
    idMap: ArchiveIdMapSchema.default({
      meals: {},
      recipes: {},
      groceryLists: {},
      groceryItems: {},
      prepLists: {},
      prepItems: {},
      mealTypeProfiles: {},
      mealTypeDefinitions: {},
      mealSubTypeDefinitions: {},
      preferences: {},
      pantryItems: {},
      assets: {},
    }),
    restorePreferences: z.boolean().default(false),
    decisions: z.array(ConflictDecisionSchema).default([]),
    bulkDecision: ConflictBulkDecisionSchema.optional(),
  })
  .strict();
export type ArchiveImportRequest = z.infer<typeof ArchiveImportRequestSchema>;

export const ArchiveValidationResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(ArchiveValidationErrorSchema),
    manifest: ArchiveManifestSchema.nullable(),
    counts: z
      .object({
        entries: z.number().int().nonnegative(),
        uncompressedBytes: z.number().int().nonnegative(),
        assets: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ArchiveValidationResult = z.infer<
  typeof ArchiveValidationResultSchema
>;

export const ArchivePreviewSummarySchema = z
  .object({
    local: z.record(z.string(), z.number().int().nonnegative()),
    imported: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

export const ArchivePreviewResultSchema = z
  .object({
    valid: z.literal(true),
    manifest: ArchiveManifestSchema,
    conflicts: z.array(ConflictRecordSchema),
    summary: ArchivePreviewSummarySchema,
    idMap: ArchiveIdMapSchema,
    bulkDecisions: z.array(ConflictBulkDecisionSchema),
  })
  .strict();
export type ArchivePreviewResult = z.infer<typeof ArchivePreviewResultSchema>;

export function getArchiveDomainPaths(scope: ExportScope) {
  return DATA_ARCHIVE_SCOPE_DOMAINS[scope].map(
    (domain) => DATA_ARCHIVE_LAYOUT.domains[domain]
  );
}

export function getArchiveLayoutPaths(
  scope: ExportScope,
  assetPaths: readonly string[] = []
) {
  return [
    DATA_ARCHIVE_LAYOUT.manifest,
    ...getArchiveDomainPaths(scope),
    ...[...assetPaths].sort(),
  ];
}

export function validateArchiveLayout(
  scope: ExportScope,
  paths: readonly string[]
) {
  const expected = new Set(getArchiveLayoutPaths(scope));
  const actual = new Set<string>();
  const duplicate: string[] = [];
  const unexpected: string[] = [];

  for (const path of paths) {
    if (actual.has(path)) {
      duplicate.push(path);
      continue;
    }
    actual.add(path);

    const isExpected = expected.has(path);
    const isAllowedAsset = scope !== "recipes" && isMealPhotoArchivePath(path);
    if (!isExpected && !isAllowedAsset) {
      unexpected.push(path);
    }
  }

  const missing = [...expected].filter((path) => !actual.has(path));
  return {
    valid:
      duplicate.length === 0 && unexpected.length === 0 && missing.length === 0,
    duplicate,
    unexpected,
    missing,
  };
}

export function validateArchivePayloadConsistency(
  scope: ExportScope,
  payloads: readonly DataArchivePayload[],
  manifest?: Pick<ArchiveManifest, "assets">
) {
  const errors: ArchiveValidationError[] = [];
  const expectedDomains = new Set(DATA_ARCHIVE_SCOPE_DOMAINS[scope]);
  const payloadByDomain = new Map<DataArchiveDomain, DataArchivePayload>();

  const addError = (message: string, path: string[]) => {
    errors.push({
      code: "INVALID_DOMAIN_PAYLOAD",
      message,
      path,
    });
  };

  for (const payload of payloads) {
    if (!expectedDomains.has(payload.domain)) {
      addError(
        `Payload ${payload.domain} is outside the selected ${scope} scope`,
        ["domains"]
      );
      continue;
    }
    if (payloadByDomain.has(payload.domain)) {
      addError(`Duplicate payload domain: ${payload.domain}`, ["domains"]);
      continue;
    }
    payloadByDomain.set(payload.domain, payload);
  }

  for (const domain of expectedDomains) {
    if (!payloadByDomain.has(domain)) {
      addError(`Missing payload domain: ${domain}`, ["domains"]);
    }
  }

  const mealPlan = payloadByDomain.get("meal-plan");
  const recipes = payloadByDomain.get("recipes");
  const mealPlanPayload =
    mealPlan?.domain === "meal-plan" ? mealPlan : undefined;
  const recipesPayload = recipes?.domain === "recipes" ? recipes : undefined;

  const recipeIds = new Set(recipesPayload?.recipes.map((recipe) => recipe.id));
  if (mealPlanPayload) {
    const profileIds = new Set(
      mealPlanPayload.mealTypeProfiles.map((profile) => profile.id)
    );
    const definitionIds = new Set(
      mealPlanPayload.mealTypeDefinitions.map((definition) => definition.id)
    );
    const subTypeDefinitionIds = new Set(
      mealPlanPayload.mealSubTypeDefinitions.map((definition) => definition.id)
    );

    for (const definition of mealPlanPayload.mealTypeDefinitions) {
      if (!profileIds.has(definition.profileId)) {
        addError(
          `Meal type definition ${definition.id} references a missing profile`,
          ["mealTypeDefinitions", definition.id, "profileId"]
        );
      }
    }

    for (const meal of mealPlanPayload.meals) {
      if (meal.recipeId && !recipeIds.has(meal.recipeId)) {
        addError(`Meal ${meal.id} references a recipe outside the archive`, [
          "meals",
          meal.id,
          "recipeId",
        ]);
      }
      if (
        meal.mealTypeDefinitionId &&
        !definitionIds.has(meal.mealTypeDefinitionId)
      ) {
        addError(`Meal ${meal.id} references a missing meal type definition`, [
          "meals",
          meal.id,
          "mealTypeDefinitionId",
        ]);
      }
      if (
        meal.mealSubTypeDefinitionId &&
        !subTypeDefinitionIds.has(meal.mealSubTypeDefinitionId)
      ) {
        addError(
          `Meal ${meal.id} references a missing meal sub-type definition`,
          ["meals", meal.id, "mealSubTypeDefinitionId"]
        );
      }
      if (meal.photoAssetId && manifest) {
        const asset = manifest.assets.find(
          (entry) => entry.id === meal.photoAssetId
        );
        if (!asset || asset.mealId !== meal.id) {
          addError(
            `Meal ${meal.id} references a missing or mismatched photo asset`,
            ["meals", meal.id, "photoAssetId"]
          );
        }
      }
    }
  }

  if (recipesPayload) {
    for (const recipe of recipesPayload.recipes) {
      if (recipe.sourceRecipeId && !recipeIds.has(recipe.sourceRecipeId)) {
        addError(`Recipe ${recipe.id} references a missing source recipe`, [
          "recipes",
          recipe.id,
          "sourceRecipeId",
        ]);
      }
      for (const linkedRecipe of recipe.linkedSubRecipes) {
        if (!recipeIds.has(linkedRecipe.id)) {
          addError(`Recipe ${recipe.id} references a missing linked recipe`, [
            "recipes",
            recipe.id,
            "linkedSubRecipes",
          ]);
        }
      }
    }

    for (const link of recipesPayload.links) {
      if (!recipeIds.has(link.parentId) || !recipeIds.has(link.subRecipeId)) {
        addError(`Recipe link ${link.id} references a missing recipe`, [
          "links",
          link.id,
        ]);
      }
    }
  }

  const prepLists = payloadByDomain.get("prep-lists");
  if (prepLists?.domain === "prep-lists") {
    const mealIds = new Set(mealPlanPayload?.meals.map((meal) => meal.id));
    for (const list of prepLists.lists) {
      for (const mealId of list.sourceMealIds) {
        if (!mealIds.has(mealId)) {
          addError(`Prep list ${list.id} references a missing meal`, [
            "prepLists",
            list.id,
            "sourceMealIds",
          ]);
        }
      }
      for (const recipeId of list.sourceRecipeIds) {
        if (!recipeIds.has(recipeId)) {
          addError(`Prep list ${list.id} references a missing recipe`, [
            "prepLists",
            list.id,
            "sourceRecipeIds",
          ]);
        }
      }
      for (const item of list.items) {
        for (const mealId of item.sourceMealIds) {
          if (!mealIds.has(mealId)) {
            addError(`Prep item ${item.id} references a missing meal`, [
              "prepLists",
              list.id,
              "items",
              item.id,
              "sourceMealIds",
            ]);
          }
        }
        for (const recipeId of item.sourceRecipeIds) {
          if (!recipeIds.has(recipeId)) {
            addError(`Prep item ${item.id} references a missing recipe`, [
              "prepLists",
              list.id,
              "items",
              item.id,
              "sourceRecipeIds",
            ]);
          }
        }
      }
    }
  }

  return errors;
}
