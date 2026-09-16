import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Prisma } from "@prisma/client";

import { bootstrapDatabase } from "../lib/bootstrap";
import {
  createDataArchive,
  extractDataArchive,
  sha256Hex,
} from "../lib/data-archive";
import {
  deleteMealPhotoFile,
  readMealPhotoFile,
  saveMealPhotoDataUrl,
} from "../lib/meal-photo-storage";
import { prisma } from "../lib/prisma";
import {
  ArchiveManifestSchema,
  ArchiveIdMapSchema,
  ArchivePreviewResultSchema,
  ArchiveValidationResultSchema,
  ConflictBulkDecisionSchema,
  ConflictDecisionSchema,
  DATA_ARCHIVE_DOMAIN_VERSION,
  DATA_ARCHIVE_FILE_PREFIX,
  DATA_ARCHIVE_FORMAT,
  DATA_ARCHIVE_FORMAT_VERSION,
  DATA_ARCHIVE_LAYOUT,
  DATA_ARCHIVE_SCHEMA_VERSION,
  DATA_ARCHIVE_SCOPE_DOMAINS,
  DataArchiveAssetMimeTypeSchema,
  DataArchivePayloadSchema,
  ExportScopeSchema,
  getDataArchiveAssetMimeType,
  getMealPhotoArchivePath,
  SAFE_PREFERENCE_FIELDS,
  validateArchiveLayout,
  validateArchivePayloadConsistency,
  type ArchiveManifest,
  type ArchiveIdMap,
  type ArchivePreviewResult,
  type ArchiveValidationError,
  type ArchiveValidationResult,
  type ConflictBulkDecision,
  type ConflictRecord,
  type ConflictDecision,
  type DataArchiveAssetMimeType,
  type DataArchivePayload,
  type ExportScope,
  type ImportMode,
} from "@shared/schemas/data-management-schemas";
import type { MealPayload } from "@shared/types";

import { GroceryService } from "./grocery-service";
import { MealService } from "./meal-service";
import { MealSubTypeService } from "./meal-sub-type-service";
import { MealTypeService } from "./meal-type-service";
import { PrepListService } from "./prep-list-service";
import { PreferenceService } from "./preference-service";
import { RecipeService } from "./recipe-service";
import { publishCommittedChange } from "./change-event-bus";

type PhotoReader = typeof readMealPhotoFile;
type PhotoWriter = typeof saveMealPhotoDataUrl;
type PhotoDeleter = typeof deleteMealPhotoFile;
type ImportTransaction = Prisma.TransactionClient;

export type MissingMealPhoto = {
  mealId: string;
  reason: "missing-file" | "invalid-mime-type" | "empty-file" | "read-failed";
};

export type DataManagementExport = {
  archive: Buffer;
  fileName: string;
  manifest: ArchiveManifest;
  missingPhotos: MissingMealPhoto[];
};

export type DataManagementValidation = ArchiveValidationResult;

export type DataManagementApplyInput = {
  mode: ImportMode;
  idMap?: ArchiveIdMap;
  restorePreferences?: boolean;
  decisions?: ConflictDecision[];
  bulkDecision?: ConflictBulkDecision;
};

export type DataManagementApplyResult = {
  summary: {
    mode: ImportMode;
    imported: number;
    skipped: number;
    replaced: number;
    unresolved: number;
    conflicts: number;
    assets: {
      imported: number;
      skipped: number;
      failed: number;
    };
    preferencesRestored: boolean;
  };
  backupPath?: string;
};

export type DataManagementServiceDependencies = {
  mealService: Pick<MealService, "listAllMeals">;
  recipeService: Pick<RecipeService, "exportRecipes">;
  groceryService: Pick<GroceryService, "listGroceryLists">;
  prepListService: Pick<PrepListService, "listPrepLists">;
  mealTypeService: Pick<MealTypeService, "listProfiles">;
  mealSubTypeService: Pick<MealSubTypeService, "listDefinitions">;
  preferenceService: Pick<PreferenceService, "getPreferences">;
  readPhoto: PhotoReader;
  writePhoto: PhotoWriter;
  deletePhoto: PhotoDeleter;
  writeBackup: (archive: Buffer, fileName: string) => Promise<string>;
  replaceEnabled: boolean;
  appVersion: string;
};

export class DataManagementExportError extends Error {
  readonly code = "DATA_ARCHIVE_EXPORT_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "DataManagementExportError";
  }
}

export class DataManagementValidationError extends Error {
  readonly code = "DATA_ARCHIVE_VALIDATION_FAILED";
  readonly errors: ArchiveValidationError[];

  constructor(errors: ArchiveValidationError[]) {
    super(errors[0]?.message ?? "The data archive is invalid.");
    this.name = "DataManagementValidationError";
    this.errors = errors;
  }
}

export class DataManagementApplyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DataManagementApplyError";
    this.code = code;
  }
}

function getAppVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    return process.env.npm_package_version?.trim() || "unknown";
  }

  return process.env.npm_package_version?.trim() || "unknown";
}

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJsonArray<T>(
  value: string | null | undefined,
  fallback: T[] = []
) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function parseInstructions(value: string | null | undefined) {
  return parseJsonArray<unknown>(value).filter(
    (entry): entry is string => typeof entry === "string"
  );
}

function normalizeOrigin(value: string) {
  return value === "imported" ? "imported" : "manual";
}

function normalizeSourceUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

function getRecipeSummary(
  recipe: { id: string; title: string } | null | undefined
) {
  return recipe ? { id: recipe.id, title: recipe.title } : null;
}

function getStableArchiveDate(exportedAt: string) {
  return exportedAt.slice(0, 10);
}

function getStablePhotoFileName(
  photoFileName: string | null | undefined,
  photoPath: string,
  mealId: string,
  extension: string
) {
  const source =
    photoFileName?.trim() || basename(photoPath.replace(/\\/g, "/"));
  const fileName = basename(source).replace(/\0/g, "").trim();
  return fileName || `meal-${mealId}.${extension}`;
}

function pickSafePreferences(
  preferences: Awaited<ReturnType<PreferenceService["getPreferences"]>>
) {
  const safeFields = Object.fromEntries(
    SAFE_PREFERENCE_FIELDS.map((field) => [field, preferences[field]])
  );

  return {
    id: preferences.id,
    createdAt: preferences.createdAt,
    updatedAt: preferences.updatedAt,
    ...safeFields,
  };
}

function emptyArchiveIdMap(): ArchiveIdMap {
  return {
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
  };
}

function cloneArchiveIdMap(input?: ArchiveIdMap) {
  const result = emptyArchiveIdMap();
  if (!input) {
    return result;
  }

  for (const key of Object.keys(result) as Array<keyof ArchiveIdMap>) {
    Object.assign(result[key], input[key]);
  }
  return result;
}

function archiveValidationError(
  code: ArchiveValidationError["code"],
  message: string,
  path: Array<string | number> = [],
  entryPath?: string
): ArchiveValidationError {
  return {
    code,
    message,
    path,
    ...(entryPath ? { entryPath } : {}),
  };
}

function formatZodArchiveErrors(
  error: { issues: Array<{ path: (string | number)[]; message: string }> },
  prefix: string[],
  entryPath: string
) {
  return error.issues.map((issue) =>
    archiveValidationError(
      "INVALID_DOMAIN_PAYLOAD",
      issue.message,
      [...prefix, ...issue.path],
      entryPath
    )
  );
}

function parseArchiveJson(entry: Buffer, entryPath: string) {
  try {
    return JSON.parse(entry.toString("utf8")) as unknown;
  } catch {
    throw new DataManagementValidationError([
      archiveValidationError(
        entryPath === DATA_ARCHIVE_LAYOUT.manifest
          ? "INVALID_MANIFEST"
          : "INVALID_DOMAIN_PAYLOAD",
        `Archive entry is not valid JSON: ${entryPath}`,
        [],
        entryPath
      ),
    ]);
  }
}

function normalizeIdentityText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeIdentityUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalizeIdentityText(value);
  }
}

function dateIdentity(value: string | Date | null | undefined) {
  if (!value) {
    return "unscheduled";
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function recipeIdentityValues(record: { title: string; sourceUrl?: string | null }) {
  const identities = [`title:${normalizeIdentityText(record.title)}`];
  const sourceUrl = normalizeIdentityUrl(record.sourceUrl);
  if (sourceUrl) {
    identities.unshift(`source:${sourceUrl}`);
  }
  return identities;
}

function mealIdentity(record: {
  date: string | null;
  mealType: string;
  name: string;
  sortOrder: number;
}) {
  return `meal:${dateIdentity(record.date)}:${normalizeIdentityText(
    record.mealType
  )}:${normalizeIdentityText(record.name)}:${record.sortOrder}`;
}

function listIdentity(record: {
  date: string | null;
  name: string;
}) {
  return `list:${dateIdentity(record.date)}:${normalizeIdentityText(record.name)}`;
}

function itemIdentity(record: {
  name: string;
  category?: string;
  kind?: string;
  sortOrder: number;
  parentId: string;
}) {
  return `item:${record.parentId}:${normalizeIdentityText(record.kind ?? "item")}:${normalizeIdentityText(
    record.name
  )}:${normalizeIdentityText(record.category)}:${record.sortOrder}`;
}

function profileIdentity(record: { name: string }) {
  return `profile:${normalizeIdentityText(record.name)}`;
}

function definitionIdentity(record: { profileId: string; slug: string }) {
  return `definition:${record.profileId}:${normalizeIdentityText(record.slug)}`;
}

function subTypeIdentity(record: { slug: string }) {
  return `sub-type:${normalizeIdentityText(record.slug)}`;
}

function recordSummary(record: Record<string, unknown>) {
  const summary: Record<string, unknown> = {};
  for (const key of [
    "id",
    "name",
    "title",
    "date",
    "mealType",
    "sourceUrl",
    "category",
    "kind",
    "slug",
    "profileId",
    "checked",
    "itemCount",
  ]) {
    if (key in record) {
      summary[key] = record[key];
    }
  }
  return summary;
}

function csvPreferenceValue(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(",");
}

function safePreferenceDatabaseData(
  preferences: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of SAFE_PREFERENCE_FIELDS) {
    const value = preferences[field];
    if (field === "dietaryTags" || field === "favoriteCuisines" || field === "avoidCuisines" || field === "nutritionTags") {
      data[field] = csvPreferenceValue(Array.isArray(value) ? (value as string[]) : []);
    } else if (field === "avoidIngredients" || field === "pantryStaples") {
      data[field] = JSON.stringify(Array.isArray(value) ? value : []);
    } else {
      data[field] = value;
    }
  }
  return data;
}

type LocalSnapshot = {
  meals: Array<Record<string, unknown>>;
  recipes: Array<Record<string, unknown>>;
  recipeLinks: Array<Record<string, unknown>>;
  groceryLists: Array<Record<string, unknown>>;
  groceryItems: Array<Record<string, unknown>>;
  prepLists: Array<Record<string, unknown>>;
  prepItems: Array<Record<string, unknown>>;
  mealTypeProfiles: Array<Record<string, unknown>>;
  mealTypeDefinitions: Array<Record<string, unknown>>;
  mealSubTypeDefinitions: Array<Record<string, unknown>>;
  preferences: Record<string, unknown> | null;
  pantryItems: Array<Record<string, unknown>>;
};

type ParsedDataArchive = {
  entries: Map<string, Buffer>;
  manifest: ArchiveManifest;
  payloads: DataArchivePayload[];
};

type ConflictMatch = {
  conflict: ConflictRecord;
  mapKey: keyof ArchiveIdMap;
  importedId: string;
  localId: string;
};

type ImportAnalysis = {
  local: LocalSnapshot;
  conflicts: ConflictMatch[];
  idMap: ArchiveIdMap;
};

type MutationCounts = {
  imported: number;
  skipped: number;
  replaced: number;
  unresolved: number;
  assets: { imported: number; skipped: number; failed: number };
  preferencesRestored: boolean;
};

export class DataManagementService {
  private readonly dependencies: DataManagementServiceDependencies;

  constructor(dependencies?: Partial<DataManagementServiceDependencies>) {
    this.dependencies = {
      mealService: dependencies?.mealService ?? new MealService(),
      recipeService: dependencies?.recipeService ?? new RecipeService(),
      groceryService: dependencies?.groceryService ?? new GroceryService(),
      prepListService: dependencies?.prepListService ?? new PrepListService(),
      mealTypeService: dependencies?.mealTypeService ?? new MealTypeService(),
      mealSubTypeService:
        dependencies?.mealSubTypeService ?? new MealSubTypeService(),
      preferenceService:
        dependencies?.preferenceService ?? new PreferenceService(),
      readPhoto: dependencies?.readPhoto ?? readMealPhotoFile,
      writePhoto: dependencies?.writePhoto ?? saveMealPhotoDataUrl,
      deletePhoto: dependencies?.deletePhoto ?? deleteMealPhotoFile,
      writeBackup:
        dependencies?.writeBackup ??
        (async (archive, fileName) => {
          const directory = await mkdtemp(
            join(tmpdir(), "local-recipe-book-backup-")
          );
          const path = join(directory, fileName);
          await writeFile(path, archive);
          return path;
        }),
      replaceEnabled: dependencies?.replaceEnabled ?? true,
      appVersion: dependencies?.appVersion ?? getAppVersion(),
    };
  }

  private async exportRecipes(recipeIds: Set<string> | undefined) {
    const legacyExport = await this.dependencies.recipeService.exportRecipes();
    const legacyById = new Map(
      legacyExport.recipes.map((recipe) => [recipe.id, recipe])
    );

    const rows = await prisma.recipe.findMany({
      include: {
        ingredients: true,
        tags: true,
        sourceRecipe: { select: { id: true, title: true } },
        linkedFrom: {
          select: { subRecipe: { select: { id: true, title: true } } },
        },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
    const links = await prisma.recipeLink.findMany({
      select: { id: true, parentId: true, subRecipeId: true },
      orderBy: [{ parentId: "asc" }, { subRecipeId: "asc" }, { id: "asc" }],
    });

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const includedIds = new Set<string>(
      recipeIds
        ? [...recipeIds].filter((id) => rowsById.has(id))
        : rows.map((row) => row.id)
    );

    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!includedIds.has(row.id)) {
          continue;
        }

        if (
          row.sourceRecipeId &&
          rowsById.has(row.sourceRecipeId) &&
          !includedIds.has(row.sourceRecipeId)
        ) {
          includedIds.add(row.sourceRecipeId);
          changed = true;
        }
      }

      for (const link of links) {
        if (
          !includedIds.has(link.parentId) &&
          !includedIds.has(link.subRecipeId)
        ) {
          continue;
        }
        if (rowsById.has(link.parentId) && !includedIds.has(link.parentId)) {
          includedIds.add(link.parentId);
          changed = true;
        }
        if (
          rowsById.has(link.subRecipeId) &&
          !includedIds.has(link.subRecipeId)
        ) {
          includedIds.add(link.subRecipeId);
          changed = true;
        }
      }
    }

    const recipes = rows
      .filter((row) => includedIds.has(row.id))
      .map((row) => {
        const legacy = legacyById.get(row.id);
        const linkedSubRecipes = row.linkedFrom
          .filter((link) => includedIds.has(link.subRecipe.id))
          .map((link) => ({
            id: link.subRecipe.id,
            title: link.subRecipe.title,
          }));

        return {
          id: row.id,
          title: row.title,
          description: row.description,
          servings: row.servings,
          prepTime: row.prepTime,
          cookTime: row.cookTime,
          difficulty: row.difficulty,
          cuisine: row.cuisine,
          instructions:
            legacy?.instructions ?? parseInstructions(row.instructions),
          sourceUrl: normalizeSourceUrl(row.sourceUrl),
          sourceLabel: row.sourceLabel,
          origin: normalizeOrigin(row.origin),
          favourite: row.favourite,
          rating: row.rating,
          cookNotes: row.cookNotes,
          lastMadeAt: toIsoDate(row.lastMadeAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          sourceRecipeId:
            row.sourceRecipeId && includedIds.has(row.sourceRecipeId)
              ? row.sourceRecipeId
              : null,
          sourceRecipe:
            row.sourceRecipe && includedIds.has(row.sourceRecipe.id)
              ? getRecipeSummary(row.sourceRecipe)
              : null,
          ingredients: (legacy?.ingredients ?? row.ingredients)
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((ingredient) => ({
              id:
                "id" in ingredient && typeof ingredient.id === "string"
                  ? ingredient.id
                  : `recipe-ingredient-${row.id}-${ingredient.order}`,
              name: ingredient.name,
              quantity: ingredient.quantity ?? null,
              quantityNumerator: ingredient.quantityNumerator ?? null,
              quantityDenominator: ingredient.quantityDenominator ?? null,
              unit: ingredient.unit ?? null,
              group: ingredient.group ?? null,
              notes: ingredient.notes ?? null,
              parseConfidence:
                ingredient.parseConfidence === "high" ||
                ingredient.parseConfidence === "low"
                  ? ingredient.parseConfidence
                  : null,
              parseRaw: ingredient.parseRaw ?? null,
              order: ingredient.order,
            })),
          tags: (legacy?.tags ?? row.tags.map((tag) => tag.tag)).slice().sort(),
          linkedSubRecipes,
        };
      });

    return {
      domain: "recipes" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      recipes,
      links: links.filter(
        (link) =>
          includedIds.has(link.parentId) && includedIds.has(link.subRecipeId)
      ),
    };
  }

  private async exportMealPlan() {
    const [meals, rawMeals, profiles, subTypeDefinitions] = await Promise.all([
      this.dependencies.mealService.listAllMeals(),
      prisma.meal.findMany({
        select: {
          id: true,
          createdAt: true,
          photoPath: true,
          photoMimeType: true,
          photoFileName: true,
        },
      }),
      this.dependencies.mealTypeService.listProfiles(),
      this.dependencies.mealSubTypeService.listDefinitions(),
    ]);
    const rawMealById = new Map(rawMeals.map((meal) => [meal.id, meal]));
    const assets = new Map<
      string,
      {
        id: string;
        kind: "meal-photo";
        path: string;
        mealId: string;
        mimeType: DataArchiveAssetMimeType;
        originalFileName: string;
        size: number;
        sha256: string;
        data: Buffer;
      }
    >();
    const missingPhotos: MissingMealPhoto[] = [];

    for (const meal of meals) {
      const rawMeal = rawMealById.get(meal.id);
      if (!rawMeal?.photoPath) {
        continue;
      }

      const mimeType = DataArchiveAssetMimeTypeSchema.safeParse(
        rawMeal.photoMimeType ??
          getDataArchiveAssetMimeType(rawMeal.photoPath.split(".").pop() ?? "")
      );
      if (!mimeType.success) {
        missingPhotos.push({ mealId: meal.id, reason: "invalid-mime-type" });
        continue;
      }

      let photo;
      try {
        photo = await this.dependencies.readPhoto(rawMeal.photoPath);
      } catch (error) {
        missingPhotos.push({
          mealId: meal.id,
          reason:
            error instanceof Error &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "missing-file"
              : "read-failed",
        });
        continue;
      }

      if (photo.data.byteLength === 0) {
        missingPhotos.push({ mealId: meal.id, reason: "empty-file" });
        continue;
      }

      const extension =
        mimeType.data === "image/jpeg"
          ? "jpg"
          : mimeType.data.slice("image/".length);
      const data = Buffer.from(photo.data);
      assets.set(meal.id, {
        id: `meal-photo-${meal.id}`,
        kind: "meal-photo",
        path: getMealPhotoArchivePath(meal.id, mimeType.data),
        mealId: meal.id,
        mimeType: mimeType.data,
        originalFileName: getStablePhotoFileName(
          rawMeal.photoFileName,
          rawMeal.photoPath,
          meal.id,
          extension
        ),
        size: data.byteLength,
        sha256: sha256Hex(data),
        data,
      });
    }

    const mealTypeDefinitions = profiles
      .flatMap((profile) => profile.mealTypes)
      .map((definition) => ({
        id: definition.id,
        profileId: definition.profileId,
        name: definition.name,
        slug: definition.slug,
        color: definition.color,
        enabled: definition.enabled,
        sortOrder: definition.sortOrder,
        cutoffTime: definition.cutoffTime ?? "23:59",
        createdAt: normalizeDate(definition.createdAt) ?? definition.createdAt,
        updatedAt: normalizeDate(definition.updatedAt) ?? definition.updatedAt,
      }));
    const mealTypeProfiles = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      color: profile.color,
      description: profile.description,
      isDefault: profile.isDefault,
      priority: profile.priority,
      startDate: normalizeDate(profile.startDate),
      endDate: normalizeDate(profile.endDate),
      createdAt: normalizeDate(profile.createdAt) ?? profile.createdAt,
      updatedAt: normalizeDate(profile.updatedAt) ?? profile.updatedAt,
    }));
    const mealSubTypes = subTypeDefinitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      slug: definition.slug,
      color: definition.color,
      enabled: definition.enabled,
      sortOrder: definition.sortOrder,
      createdAt: normalizeDate(definition.createdAt) ?? definition.createdAt,
      updatedAt: normalizeDate(definition.updatedAt) ?? definition.updatedAt,
    }));

    const mealPlan = {
      domain: "meal-plan" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      meals: meals.map((meal: MealPayload) => ({
        id: meal.id,
        name: meal.name,
        date: normalizeDate(meal.date),
        mealType: meal.mealType,
        mealTypeDefinitionId: meal.mealTypeDefinitionId ?? null,
        mealSubTypeDefinitionId: meal.mealSubTypeDefinitionId ?? null,
        notes: meal.notes,
        ingredients: meal.ingredients,
        description: meal.description,
        instructions: meal.instructions,
        sortOrder: meal.sortOrder,
        servings: meal.servings,
        prepTime: meal.prepTime,
        cookTime: meal.cookTime,
        cuisine: meal.cuisine,
        servingsOverride: meal.servingsOverride,
        recipeId: meal.recipeId,
        photoAssetId: assets.get(meal.id)?.id ?? null,
        createdAt:
          rawMealById.get(meal.id)?.createdAt.toISOString() ??
          new Date(0).toISOString(),
      })),
      mealTypeProfiles,
      mealTypeDefinitions,
      mealSubTypeDefinitions: mealSubTypes,
    };

    return { mealPlan, assets, missingPhotos };
  }

  private async exportGrocery() {
    const lists = await this.dependencies.groceryService.listGroceryLists();
    return {
      domain: "grocery" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        date: normalizeDate(list.date),
        favourite: list.favourite,
        createdAt: normalizeDate(list.createdAt) ?? list.createdAt,
        updatedAt: normalizeDate(list.updatedAt) ?? list.updatedAt,
        items: list.items.map((item) => ({
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
      })),
    };
  }

  private async exportPrepLists() {
    const lists = await this.dependencies.prepListService.listPrepLists();
    return {
      domain: "prep-lists" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        notes: list.notes,
        date: normalizeDate(list.date),
        fromDate: normalizeDate(list.fromDate),
        toDate: normalizeDate(list.toDate),
        sourceMode: list.sourceMode,
        sourceLabel: list.sourceLabel,
        sourceMealIds: list.sourceMealIds,
        sourceRecipeIds: list.sourceRecipeIds,
        favourite: list.favourite,
        sortMode: list.sortMode,
        groupBy: list.groupBy,
        includeIngredients: list.includeIngredients,
        includeTasks: list.includeTasks,
        includeQuantities: list.includeQuantities,
        includeIngredientTypes: list.includeIngredientTypes,
        includeSourceLabels: list.includeSourceLabels,
        excludePantryStaples: list.excludePantryStaples,
        createdAt: normalizeDate(list.createdAt) ?? list.createdAt,
        updatedAt: normalizeDate(list.updatedAt) ?? list.updatedAt,
        items: list.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          qty: item.qty,
          unit: item.unit,
          ingredientType: item.ingredientType,
          prepGroup: item.prepGroup,
          dish: item.dish,
          notes: item.notes,
          checked: item.checked,
          sortOrder: item.sortOrder,
          sourceMealIds: item.sourceMealIds,
          sourceRecipeIds: item.sourceRecipeIds,
          sourceLabels: item.sourceLabels,
        })),
      })),
    };
  }

  private async exportPreferences() {
    const preferences =
      await this.dependencies.preferenceService.getPreferences();
    return {
      domain: "preferences" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      preferences: [pickSafePreferences(preferences)],
    };
  }

  private async exportPantry(historyIncluded: boolean) {
    const pantryDelegate = (prisma as unknown as {
      pantryItem?: typeof prisma.pantryItem;
      pantryInventoryEvent?: typeof prisma.pantryInventoryEvent;
    }).pantryItem;
    if (!pantryDelegate) {
      return {
        domain: "pantry" as const,
        version: DATA_ARCHIVE_DOMAIN_VERSION,
        historyIncluded,
        items: [],
        events: [],
      };
    }
    const items = await pantryDelegate.findMany({
      include: {
        aliases: true,
        locations: { include: { lots: true }, orderBy: { normalizedLocation: "asc" } },
        packages: { orderBy: { createdAt: "asc" } },
        warningRules: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
    });
    const events = historyIncluded
      ? await (prisma as unknown as { pantryInventoryEvent: typeof prisma.pantryInventoryEvent }).pantryInventoryEvent.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })
      : [];

    return {
      domain: "pantry" as const,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      historyIncluded,
      items: items.map((item) => ({
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
        aliases: item.aliases.map((alias) => ({
          id: alias.id,
          label: alias.label,
          normalizedAlias: alias.normalizedAlias,
          createdAt: alias.createdAt.toISOString(),
        })),
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
            bestBeforeAt: toIsoDate(lot.bestBeforeAt),
            expiresAt: toIsoDate(lot.expiresAt),
            createdAt: lot.createdAt.toISOString(),
            updatedAt: lot.updatedAt.toISOString(),
          })),
        })),
        packages: item.packages.map((pack) => ({ ...pack, createdAt: pack.createdAt.toISOString(), updatedAt: pack.updatedAt.toISOString() })),
        warningRules: item.warningRules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() })),
      })),
      events: events.map((event) => ({
        id: event.id,
        itemId: event.itemId,
        locationStockId: event.locationStockId,
        lotId: event.lotId,
        type: event.type,
        quantityDelta: event.quantityDelta,
        quantity: event.quantity,
        unit: event.unit,
        approximate: event.approximate,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        sourceIdentity: event.sourceIdentity,
        metadataJson: event.metadataJson,
        occurredAt: event.occurredAt.toISOString(),
        importedAt: toIsoDate(event.importedAt),
      })),
    };
  }

  async exportArchive(scopeInput: ExportScope, historyIncluded = false) {
    const scope = ExportScopeSchema.parse(scopeInput);
    await bootstrapDatabase();
    const exportedAt = new Date().toISOString();

    let mealPlan:
      | Awaited<ReturnType<DataManagementService["exportMealPlan"]>>
      | undefined;
    if (scope !== "recipes") {
      mealPlan = await this.exportMealPlan();
    }

    const recipeIds =
      scope === "meal-plan"
        ? new Set(
            mealPlan?.mealPlan.meals.flatMap((meal) =>
              meal.recipeId ? [meal.recipeId] : []
            )
          )
        : undefined;
    const recipes = await this.exportRecipes(recipeIds);
    const payloads: DataArchivePayload[] = [
      ...(mealPlan ? [DataArchivePayloadSchema.parse(mealPlan.mealPlan)] : []),
      DataArchivePayloadSchema.parse(recipes),
    ];

    if (scope === "all") {
      payloads.push(
        DataArchivePayloadSchema.parse(await this.exportGrocery()),
        DataArchivePayloadSchema.parse(await this.exportPrepLists()),
        DataArchivePayloadSchema.parse(await this.exportPreferences()),
        DataArchivePayloadSchema.parse(await this.exportPantry(historyIncluded))
      );
    }

    const assets = [...(mealPlan?.assets.values() ?? [])]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ data: _data, ...asset }) => asset);
    const manifest = ArchiveManifestSchema.parse({
      format: DATA_ARCHIVE_FORMAT,
      formatVersion: DATA_ARCHIVE_FORMAT_VERSION,
      schemaVersion: DATA_ARCHIVE_SCHEMA_VERSION,
      appVersion: this.dependencies.appVersion,
      exportedAt,
      scope,
      domains: DATA_ARCHIVE_SCOPE_DOMAINS[scope].map((domain) => ({
        domain,
        version: DATA_ARCHIVE_DOMAIN_VERSION,
        path: DATA_ARCHIVE_LAYOUT.domains[domain],
      })),
      assets,
      idPolicy: {
        sourceIds: "preserved",
        importIdMap: "required",
      },
    });

    const consistencyErrors = validateArchivePayloadConsistency(
      scope,
      payloads,
      manifest
    );
    if (consistencyErrors.length > 0) {
      throw new DataManagementExportError(consistencyErrors[0].message);
    }

    const entries = [
      {
        path: DATA_ARCHIVE_LAYOUT.manifest,
        data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      },
      ...payloads.map((payload) => ({
        path: DATA_ARCHIVE_LAYOUT.domains[payload.domain],
        data: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      })),
      ...(mealPlan
        ? [...mealPlan.assets.values()].map((asset) => ({
            path: asset.path,
            data: asset.data,
          }))
        : []),
    ];

    const archive = createDataArchive(entries);
    const fileName = `${DATA_ARCHIVE_FILE_PREFIX}-${scope}-${getStableArchiveDate(exportedAt)}.lrb`;

    return {
      archive,
      fileName,
      manifest,
      missingPhotos: mealPlan?.missingPhotos ?? [],
    } satisfies DataManagementExport;
  }

  private parseArchive(input: Uint8Array): ParsedDataArchive {
    let entries: Map<string, Buffer>;
    try {
      entries = extractDataArchive(input);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "INVALID_ARCHIVE";
      const entryPath =
        error && typeof error === "object" && "entryPath" in error
          ? typeof error.entryPath === "string"
            ? error.entryPath
            : undefined
          : undefined;
      throw new DataManagementValidationError([
        archiveValidationError(
          code as ArchiveValidationError["code"],
          error instanceof Error ? error.message : "Unable to extract archive",
          [],
          entryPath
        ),
      ]);
    }

    const manifestEntry = entries.get(DATA_ARCHIVE_LAYOUT.manifest);
    if (!manifestEntry) {
      throw new DataManagementValidationError([
        archiveValidationError(
          "MISSING_ENTRY",
          `Archive must contain ${DATA_ARCHIVE_LAYOUT.manifest}`,
          [],
          DATA_ARCHIVE_LAYOUT.manifest
        ),
      ]);
    }

    const rawManifest = parseArchiveJson(
      manifestEntry,
      DATA_ARCHIVE_LAYOUT.manifest
    );
    if (
      typeof rawManifest !== "object" ||
      rawManifest === null ||
      ("format" in rawManifest && rawManifest.format !== DATA_ARCHIVE_FORMAT) ||
      ("formatVersion" in rawManifest &&
        rawManifest.formatVersion !== DATA_ARCHIVE_FORMAT_VERSION) ||
      ("schemaVersion" in rawManifest &&
        rawManifest.schemaVersion !== DATA_ARCHIVE_SCHEMA_VERSION)
    ) {
      throw new DataManagementValidationError([
        archiveValidationError(
          "UNSUPPORTED_FORMAT_VERSION",
          "The archive format or schema version is not supported.",
          ["manifest"],
          DATA_ARCHIVE_LAYOUT.manifest
        ),
      ]);
    }

    const manifestResult = ArchiveManifestSchema.safeParse(rawManifest);
    if (!manifestResult.success) {
      throw new DataManagementValidationError(
        manifestResult.error.issues.map((issue) =>
          archiveValidationError(
            "INVALID_MANIFEST",
            issue.message,
            ["manifest", ...issue.path],
            DATA_ARCHIVE_LAYOUT.manifest
          )
        )
      );
    }
    const manifest = manifestResult.data;

    const layout = validateArchiveLayout(manifest.scope, [...entries.keys()]);
    const layoutErrors: ArchiveValidationError[] = [
      ...layout.duplicate.map((path) =>
        archiveValidationError("INVALID_LAYOUT", `Duplicate archive entry: ${path}`, [], path)
      ),
      ...layout.unexpected.map((path) =>
        archiveValidationError(
          "UNKNOWN_ENTRY",
          `Archive entry is outside the selected scope: ${path}`,
          [],
          path
        )
      ),
      ...layout.missing.map((path) =>
        archiveValidationError("MISSING_ENTRY", `Missing archive entry: ${path}`, [], path)
      ),
    ];

    const manifestAssetPaths = new Set<string>();
    const manifestAssetIds = new Set<string>();
    for (const asset of manifest.assets) {
      if (manifestAssetIds.has(asset.id)) {
        layoutErrors.push(
          archiveValidationError(
            "INVALID_MANIFEST",
            `Duplicate asset id: ${asset.id}`,
            ["assets", asset.id]
          )
        );
      }
      manifestAssetIds.add(asset.id);
      if (manifestAssetPaths.has(asset.path)) {
        layoutErrors.push(
          archiveValidationError(
            "INVALID_MANIFEST",
            `Duplicate asset path: ${asset.path}`,
            ["assets", asset.id],
            asset.path
          )
        );
      }
      manifestAssetPaths.add(asset.path);
    }
    for (const path of entries.keys()) {
      if (
        path.startsWith(`${DATA_ARCHIVE_LAYOUT.assets.mealPhotos}/`) &&
        !manifestAssetPaths.has(path)
      ) {
        layoutErrors.push(
          archiveValidationError(
            "INVALID_LAYOUT",
            `Asset is not declared in the manifest: ${path}`,
            [],
            path
          )
        );
      }
    }

    const payloads: DataArchivePayload[] = [];
    for (const descriptor of manifest.domains) {
      const entry = entries.get(descriptor.path);
      if (!entry) {
        continue;
      }
      const parsed = parseArchiveJson(entry, descriptor.path);
      const payloadResult = DataArchivePayloadSchema.safeParse(parsed);
      if (!payloadResult.success) {
        layoutErrors.push(
          ...formatZodArchiveErrors(
            payloadResult.error,
            [descriptor.domain],
            descriptor.path
          )
        );
        continue;
      }
      payloads.push(payloadResult.data);
    }

    const consistencyErrors = validateArchivePayloadConsistency(
      manifest.scope,
      payloads,
      manifest
    );
    layoutErrors.push(...consistencyErrors);

    const payloadByDomain = new Map(payloads.map((payload) => [payload.domain, payload]));
    const mealPlanForAssets = payloadByDomain.get("meal-plan");
    if (mealPlanForAssets?.domain === "meal-plan") {
      const mealIds = new Set(mealPlanForAssets.meals.map((meal) => meal.id));
      for (const asset of manifest.assets) {
        if (!mealIds.has(asset.mealId)) {
          layoutErrors.push(
            archiveValidationError(
              "INVALID_DOMAIN_PAYLOAD",
              `Photo asset ${asset.id} references a missing meal`,
              ["assets", asset.id, "mealId"],
              asset.path
            )
          );
        }
      }
    }
    const duplicateIds = (records: Array<{ id: string }>, path: string, entryPath: string) => {
      const seen = new Set<string>();
      for (const record of records) {
        if (seen.has(record.id)) {
          layoutErrors.push(
            archiveValidationError(
              "INVALID_DOMAIN_PAYLOAD",
              `Duplicate record id: ${record.id}`,
              [path, record.id],
              entryPath
            )
          );
        }
        seen.add(record.id);
      }
    };

    const mealPlan = payloadByDomain.get("meal-plan");
    if (mealPlan?.domain === "meal-plan") {
      duplicateIds(mealPlan.meals, "meals", DATA_ARCHIVE_LAYOUT.domains["meal-plan"]);
      duplicateIds(
        mealPlan.mealTypeProfiles,
        "mealTypeProfiles",
        DATA_ARCHIVE_LAYOUT.domains["meal-plan"]
      );
      duplicateIds(
        mealPlan.mealTypeDefinitions,
        "mealTypeDefinitions",
        DATA_ARCHIVE_LAYOUT.domains["meal-plan"]
      );
      duplicateIds(
        mealPlan.mealSubTypeDefinitions,
        "mealSubTypeDefinitions",
        DATA_ARCHIVE_LAYOUT.domains["meal-plan"]
      );
    }

    const recipes = payloadByDomain.get("recipes");
    if (recipes?.domain === "recipes") {
      duplicateIds(recipes.recipes, "recipes", DATA_ARCHIVE_LAYOUT.domains.recipes);
      duplicateIds(recipes.links, "links", DATA_ARCHIVE_LAYOUT.domains.recipes);
    }

    const grocery = payloadByDomain.get("grocery");
    if (grocery?.domain === "grocery") {
      duplicateIds(grocery.lists, "lists", DATA_ARCHIVE_LAYOUT.domains.grocery);
      for (const list of grocery.lists) {
        duplicateIds(list.items, `lists.${list.id}.items`, DATA_ARCHIVE_LAYOUT.domains.grocery);
      }
    }

    const prepLists = payloadByDomain.get("prep-lists");
    if (prepLists?.domain === "prep-lists") {
      duplicateIds(prepLists.lists, "lists", DATA_ARCHIVE_LAYOUT.domains["prep-lists"]);
      for (const list of prepLists.lists) {
        duplicateIds(list.items, `lists.${list.id}.items`, DATA_ARCHIVE_LAYOUT.domains["prep-lists"]);
      }
    }

    for (const asset of manifest.assets) {
      const entry = entries.get(asset.path);
      if (!entry) {
        layoutErrors.push(
          archiveValidationError(
            "MISSING_ENTRY",
            `Missing asset entry: ${asset.path}`,
            ["assets", asset.id],
            asset.path
          )
        );
        continue;
      }
      if (entry.byteLength !== asset.size) {
        layoutErrors.push(
          archiveValidationError(
            "INVALID_ARCHIVE",
            `Asset size does not match the manifest: ${asset.path}`,
            ["assets", asset.id, "size"],
            asset.path
          )
        );
      }
      if (sha256Hex(entry) !== asset.sha256) {
        layoutErrors.push(
          archiveValidationError(
            "CHECKSUM_MISMATCH",
            `Checksum mismatch for archive entry: ${asset.path}`,
            ["assets", asset.id, "sha256"],
            asset.path
          )
        );
      }
    }

    if (layoutErrors.length > 0) {
      throw new DataManagementValidationError(layoutErrors);
    }

    return { entries, manifest, payloads };
  }

  private getValidationResult(
    input: Uint8Array
  ): DataManagementValidation {
    try {
      const parsed = this.parseArchive(input);
      const assets = parsed.manifest.assets.length;
      const uncompressedBytes = [...parsed.entries.values()].reduce(
        (total, entry) => total + entry.byteLength,
        0
      );
      return ArchiveValidationResultSchema.parse({
        valid: true,
        errors: [],
        manifest: parsed.manifest,
        counts: {
          entries: parsed.entries.size,
          uncompressedBytes,
          assets,
        },
      });
    } catch (error) {
      const errors =
        error instanceof DataManagementValidationError
          ? error.errors
          : [
              archiveValidationError(
                "INVALID_ARCHIVE",
                error instanceof Error ? error.message : "The archive is invalid."
              ),
            ];
      return ArchiveValidationResultSchema.parse({
        valid: false,
        errors,
        manifest: null,
        counts: { entries: 0, uncompressedBytes: 0, assets: 0 },
      });
    }
  }

  async validateArchive(input: Uint8Array) {
    return this.getValidationResult(input);
  }

  private async loadLocalSnapshot(): Promise<LocalSnapshot> {
    const [
      meals,
      recipes,
      recipeLinks,
      groceryLists,
      prepLists,
      profiles,
      subTypes,
      preferences,
      pantryItems,
    ] = await Promise.all([
      prisma.meal.findMany(),
      prisma.recipe.findMany(),
      prisma.recipeLink.findMany(),
      prisma.groceryList.findMany({ include: { items: true } }),
      prisma.prepList.findMany({ include: { items: true } }),
      prisma.mealTypeProfile.findMany({ include: { mealTypes: true } }),
      prisma.mealSubTypeDefinition.findMany(),
      prisma.userPreference.findUnique({ where: { id: "default" } }),
      (prisma as unknown as { pantryItem?: typeof prisma.pantryItem }).pantryItem?.findMany({ select: { id: true, name: true, normalizedName: true, category: true } }) ?? [],
    ]);

    const groceryRecords = groceryLists as Array<Record<string, unknown>>;
    const prepRecords = prepLists as Array<Record<string, unknown>>;
    const profileRecords = profiles as Array<Record<string, unknown>>;

    return {
      meals: meals as Array<Record<string, unknown>>,
      recipes: recipes as Array<Record<string, unknown>>,
      recipeLinks: recipeLinks as Array<Record<string, unknown>>,
      groceryLists: groceryRecords,
      groceryItems: groceryRecords.flatMap((list) =>
        (Array.isArray(list.items) ? list.items : []).map((item) => ({
          ...(item as Record<string, unknown>),
          groceryListId: list.id,
        }))
      ),
      prepLists: prepRecords,
      prepItems: prepRecords.flatMap((list) =>
        (Array.isArray(list.items) ? list.items : []).map((item) => ({
          ...(item as Record<string, unknown>),
          prepListId: list.id,
        }))
      ),
      mealTypeProfiles: profileRecords,
      mealTypeDefinitions: profileRecords.flatMap((profile) =>
        (Array.isArray(profile.mealTypes) ? profile.mealTypes : []) as Array<
          Record<string, unknown>
        >
      ),
      mealSubTypeDefinitions: subTypes as Array<Record<string, unknown>>,
      preferences: (preferences as Record<string, unknown> | null) ?? null,
      pantryItems: pantryItems as Array<Record<string, unknown>>,
    };
  }

  private buildImportAnalysis(
    payloads: DataArchivePayload[],
    local: LocalSnapshot
  ): ImportAnalysis {
    const idMap = emptyArchiveIdMap();
    const conflicts: ConflictMatch[] = [];
    const addConflict = (
      domain: ConflictRecord["domain"],
      mapKey: keyof ArchiveIdMap,
      imported: Record<string, unknown>,
      localRecord: Record<string, unknown>,
      identity: string,
      reason: ConflictRecord["reason"]
    ) => {
      const importedId = String(imported.id);
      const localId = String(localRecord.id);
      idMap[mapKey][importedId] = localId;
      conflicts.push({
        conflict: {
          id: `${domain}:${importedId}`,
          domain,
          identity,
          reason,
          localSummary: recordSummary(localRecord),
          importedSummary: recordSummary(imported),
        },
        mapKey,
        importedId,
        localId,
      });
    };

    const addNew = (
      mapKey: keyof ArchiveIdMap,
      imported: Record<string, unknown>
    ) => {
      idMap[mapKey][String(imported.id)] = String(imported.id);
    };

    const findById = (
      records: Array<Record<string, unknown>>,
      id: string
    ) => records.find((record) => record.id === id);

    const findByIdentity = (
      records: Array<Record<string, unknown>>,
      identity: (record: Record<string, unknown>) => boolean
    ) => records.find(identity);

    for (const payload of payloads) {
      if (payload.domain === "recipes") {
        for (const recipe of payload.recipes) {
          const byId = findById(local.recipes, recipe.id);
          const identities = recipeIdentityValues(recipe);
          const bySource = recipe.sourceUrl
            ? findByIdentity(local.recipes, (record) =>
                identities.includes(
                  `source:${normalizeIdentityUrl(String(record.sourceUrl ?? ""))}`
                )
              )
            : undefined;
          const byTitle = findByIdentity(local.recipes, (record) =>
            identities.includes(`title:${normalizeIdentityText(String(record.title ?? ""))}`)
          );
          const match = byId ?? bySource ?? byTitle;
          if (match) {
            addConflict(
              "recipe",
              "recipes",
              recipe,
              match,
              byId
                ? `recipe:id:${recipe.id}`
                : bySource
                  ? `recipe:source:${normalizeIdentityUrl(recipe.sourceUrl)}`
                  : `recipe:title:${normalizeIdentityText(recipe.title)}`,
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("recipes", recipe);
          }
        }
      }

      if (payload.domain === "meal-plan") {
        for (const profile of payload.mealTypeProfiles) {
          const byId = findById(local.mealTypeProfiles, profile.id);
          const byName = findByIdentity(local.mealTypeProfiles, (record) =>
            profileIdentity({ name: String(record.name ?? "") }) === profileIdentity(profile)
          );
          const match = byId ?? byName;
          if (match) {
            addConflict(
              "meal-type-profile",
              "mealTypeProfiles",
              profile,
              match,
              byId ? `profile:id:${profile.id}` : profileIdentity(profile),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("mealTypeProfiles", profile);
          }
        }

        for (const definition of payload.mealTypeDefinitions) {
          const mappedProfileId = idMap.mealTypeProfiles[definition.profileId] ?? definition.profileId;
          const byId = findById(local.mealTypeDefinitions, definition.id);
          const byIdentity = findByIdentity(local.mealTypeDefinitions, (record) =>
            definitionIdentity({
              profileId: String(record.profileId ?? ""),
              slug: String(record.slug ?? ""),
            }) === definitionIdentity({ profileId: mappedProfileId, slug: definition.slug })
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "meal-type-definition",
              "mealTypeDefinitions",
              definition,
              match,
              byId
                ? `definition:id:${definition.id}`
                : definitionIdentity({ profileId: mappedProfileId, slug: definition.slug }),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("mealTypeDefinitions", definition);
          }
        }

        for (const definition of payload.mealSubTypeDefinitions) {
          const byId = findById(local.mealSubTypeDefinitions, definition.id);
          const byIdentity = findByIdentity(local.mealSubTypeDefinitions, (record) =>
            subTypeIdentity({ slug: String(record.slug ?? "") }) ===
            subTypeIdentity(definition)
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "meal-sub-type-definition",
              "mealSubTypeDefinitions",
              definition,
              match,
              byId ? `sub-type:id:${definition.id}` : subTypeIdentity(definition),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("mealSubTypeDefinitions", definition);
          }
        }

        for (const meal of payload.meals) {
          const byId = findById(local.meals, meal.id);
          const byIdentity = findByIdentity(local.meals, (record) =>
            mealIdentity({
              date: meal.date,
              mealType: meal.mealType,
              name: meal.name,
              sortOrder: meal.sortOrder,
            }) ===
            mealIdentity({
              date: record.date instanceof Date ? record.date.toISOString() : (record.date as string | null),
              mealType: String(record.mealType ?? ""),
              name: String(record.name ?? ""),
              sortOrder: Number(record.sortOrder ?? 0),
            })
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "meal",
              "meals",
              meal,
              match,
              byId ? `meal:id:${meal.id}` : mealIdentity(meal),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("meals", meal);
          }
        }
      }

      if (payload.domain === "grocery") {
        for (const list of payload.lists) {
          const byId = findById(local.groceryLists, list.id);
          const byIdentity = findByIdentity(local.groceryLists, (record) =>
            listIdentity({
              date: list.date,
              name: list.name,
            }) ===
            listIdentity({
              date: record.date instanceof Date ? record.date.toISOString() : (record.date as string | null),
              name: String(record.name ?? ""),
            })
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "grocery-list",
              "groceryLists",
              list,
              match,
              byId ? `grocery-list:id:${list.id}` : listIdentity(list),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("groceryLists", list);
          }

          const targetParentId = idMap.groceryLists[list.id] ?? list.id;
          for (const item of list.items) {
            const byId = findById(local.groceryItems, item.id);
            const byIdentity = findByIdentity(local.groceryItems, (record) =>
              itemIdentity({
                parentId: targetParentId,
                name: item.name,
                category: item.category,
                sortOrder: item.sortOrder,
              }) ===
              itemIdentity({
                parentId: String(record.groceryListId ?? ""),
                name: String(record.name ?? ""),
                category: String(record.category ?? ""),
                sortOrder: Number(record.sortOrder ?? 0),
              })
            );
            const itemMatch = byId ?? byIdentity;
            if (itemMatch) {
              addConflict(
                "grocery-item",
                "groceryItems",
                item,
                itemMatch,
                byId
                  ? `grocery-item:id:${item.id}`
                  : itemIdentity({
                      parentId: targetParentId,
                      name: item.name,
                      category: item.category,
                      sortOrder: item.sortOrder,
                    }),
                byId ? "same-id" : "same-identity"
              );
            } else {
              addNew("groceryItems", item);
            }
          }
        }
      }

      if (payload.domain === "prep-lists") {
        for (const list of payload.lists) {
          const byId = findById(local.prepLists, list.id);
          const byIdentity = findByIdentity(local.prepLists, (record) =>
            listIdentity({
              date: list.date,
              name: list.name,
            }) ===
            listIdentity({
              date: record.date instanceof Date ? record.date.toISOString() : (record.date as string | null),
              name: String(record.name ?? ""),
            })
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "prep-list",
              "prepLists",
              list,
              match,
              byId ? `prep-list:id:${list.id}` : listIdentity(list),
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("prepLists", list);
          }

          const targetParentId = idMap.prepLists[list.id] ?? list.id;
          for (const item of list.items) {
            const byId = findById(local.prepItems, item.id);
            const byIdentity = findByIdentity(local.prepItems, (record) =>
              itemIdentity({
                parentId: targetParentId,
                name: item.name,
                kind: item.kind,
                sortOrder: item.sortOrder,
              }) ===
              itemIdentity({
                parentId: String(record.prepListId ?? ""),
                name: String(record.name ?? ""),
                kind: String(record.kind ?? ""),
                sortOrder: Number(record.sortOrder ?? 0),
              })
            );
            const itemMatch = byId ?? byIdentity;
            if (itemMatch) {
              addConflict(
                "prep-item",
                "prepItems",
                item,
                itemMatch,
                byId
                  ? `prep-item:id:${item.id}`
                  : itemIdentity({
                      parentId: targetParentId,
                      name: item.name,
                      kind: item.kind,
                      sortOrder: item.sortOrder,
                    }),
                byId ? "same-id" : "same-identity"
              );
            } else {
              addNew("prepItems", item);
            }
          }
        }
      }

      if (payload.domain === "preferences" && payload.preferences.length > 0) {
        const preferences = payload.preferences[0];
        if (local.preferences) {
          addConflict(
            "preferences",
            "preferences",
            preferences,
            local.preferences,
            "preferences:default",
            "same-id"
          );
        }
      }

      if (payload.domain === "pantry") {
        for (const item of payload.items) {
          const byId = findById(local.pantryItems, item.id);
          const byIdentity = findByIdentity(local.pantryItems, (record) =>
            normalizeIdentityText(String(record.normalizedName ?? record.name ?? "")) ===
            normalizeIdentityText(item.normalizedName)
          );
          const match = byId ?? byIdentity;
          if (match) {
            addConflict(
              "pantry-item",
              "pantryItems",
              item,
              match,
              byId ? `pantry-item:id:${item.id}` : `pantry-item:name:${item.normalizedName}`,
              byId ? "same-id" : "same-identity"
            );
          } else {
            addNew("pantryItems", item);
          }
        }
      }
    }

    return { local, conflicts, idMap };
  }

  async previewImport(input: Uint8Array): Promise<ArchivePreviewResult> {
    const parsed = this.parseArchive(input);
    const local = await this.loadLocalSnapshot();
    const analysis = this.buildImportAnalysis(parsed.payloads, local);
    return ArchivePreviewResultSchema.parse({
      valid: true,
      manifest: parsed.manifest,
      conflicts: analysis.conflicts.map((match) => match.conflict),
      summary: {
        local: {
          meals: local.meals.length,
          recipes: local.recipes.length,
          groceryLists: local.groceryLists.length,
          groceryItems: local.groceryItems.length,
          prepLists: local.prepLists.length,
          prepItems: local.prepItems.length,
          mealTypeProfiles: local.mealTypeProfiles.length,
          mealTypeDefinitions: local.mealTypeDefinitions.length,
          mealSubTypeDefinitions: local.mealSubTypeDefinitions.length,
          preferences: local.preferences ? 1 : 0,
          pantryItems: local.pantryItems.length,
        },
        imported: {
          meals: parsed.payloads.find((payload) => payload.domain === "meal-plan")?.domain === "meal-plan"
            ? (parsed.payloads.find((payload) => payload.domain === "meal-plan") as Extract<DataArchivePayload, { domain: "meal-plan" }>).meals.length
            : 0,
          recipes: parsed.payloads.find((payload) => payload.domain === "recipes")?.domain === "recipes"
            ? (parsed.payloads.find((payload) => payload.domain === "recipes") as Extract<DataArchivePayload, { domain: "recipes" }>).recipes.length
            : 0,
          groceryLists: parsed.payloads.find((payload) => payload.domain === "grocery")?.domain === "grocery"
            ? (parsed.payloads.find((payload) => payload.domain === "grocery") as Extract<DataArchivePayload, { domain: "grocery" }>).lists.length
            : 0,
          groceryItems: parsed.payloads.find((payload) => payload.domain === "grocery")?.domain === "grocery"
            ? (parsed.payloads.find((payload) => payload.domain === "grocery") as Extract<DataArchivePayload, { domain: "grocery" }>).lists.reduce((count, list) => count + list.items.length, 0)
            : 0,
          prepLists: parsed.payloads.find((payload) => payload.domain === "prep-lists")?.domain === "prep-lists"
            ? (parsed.payloads.find((payload) => payload.domain === "prep-lists") as Extract<DataArchivePayload, { domain: "prep-lists" }>).lists.length
            : 0,
          prepItems: parsed.payloads.find((payload) => payload.domain === "prep-lists")?.domain === "prep-lists"
            ? (parsed.payloads.find((payload) => payload.domain === "prep-lists") as Extract<DataArchivePayload, { domain: "prep-lists" }>).lists.reduce((count, list) => count + list.items.length, 0)
            : 0,
          mealTypeProfiles: parsed.payloads.find((payload) => payload.domain === "meal-plan")?.domain === "meal-plan"
            ? (parsed.payloads.find((payload) => payload.domain === "meal-plan") as Extract<DataArchivePayload, { domain: "meal-plan" }>).mealTypeProfiles.length
            : 0,
          mealTypeDefinitions: parsed.payloads.find((payload) => payload.domain === "meal-plan")?.domain === "meal-plan"
            ? (parsed.payloads.find((payload) => payload.domain === "meal-plan") as Extract<DataArchivePayload, { domain: "meal-plan" }>).mealTypeDefinitions.length
            : 0,
          mealSubTypeDefinitions: parsed.payloads.find((payload) => payload.domain === "meal-plan")?.domain === "meal-plan"
            ? (parsed.payloads.find((payload) => payload.domain === "meal-plan") as Extract<DataArchivePayload, { domain: "meal-plan" }>).mealSubTypeDefinitions.length
            : 0,
          preferences: parsed.payloads.find((payload) => payload.domain === "preferences")?.domain === "preferences"
            ? (parsed.payloads.find((payload) => payload.domain === "preferences") as Extract<DataArchivePayload, { domain: "preferences" }>).preferences.length
            : 0,
          pantryItems: parsed.payloads.find((payload) => payload.domain === "pantry")?.domain === "pantry"
            ? (parsed.payloads.find((payload) => payload.domain === "pantry") as Extract<DataArchivePayload, { domain: "pantry" }>).items.length
            : 0,
        },
      },
      idMap: analysis.idMap,
      bulkDecisions: ["keep-local", "import", "skip"],
    });
  }

  private getConflictAction(
    mapKey: keyof ArchiveIdMap,
    importedId: string,
    analysis: ImportAnalysis,
    decisions: Map<string, ConflictDecision["decision"]>,
    mode: ImportMode,
    restorePreferences: boolean
  ) {
    if (mode === "replace") {
      return "create" as const;
    }

    const conflict = analysis.conflicts.find(
      (match) => match.mapKey === mapKey && match.importedId === importedId
    );
    if (!conflict) {
      return "create" as const;
    }
    if (mapKey === "preferences" && !restorePreferences) {
      return "skip" as const;
    }

    const decision = decisions.get(conflict.conflict.id);
    if (!decision) {
      throw new DataManagementApplyError(
        "DATA_ARCHIVE_CONFLICT_DECISIONS_REQUIRED",
        `A decision is required for conflict ${conflict.conflict.id}.`
      );
    }

    return decision === "replace" ? ("replace" as const) : decision === "import" ? ("create" as const) : ("skip" as const);
  }

  private buildApplyAnalysis(
    parsed: ParsedDataArchive,
    local: LocalSnapshot,
    input: DataManagementApplyInput
  ) {
    const analysis = this.buildImportAnalysis(parsed.payloads, local);
    const decisions = new Map<string, ConflictDecision["decision"]>();
    if (input.mode === "merge" && input.bulkDecision) {
      const bulkResult = ConflictBulkDecisionSchema.safeParse(input.bulkDecision);
      if (!bulkResult.success) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_INVALID_DECISION",
          "Import bulk decision is invalid."
        );
      }
      for (const conflict of analysis.conflicts) {
        decisions.set(conflict.conflict.id, bulkResult.data);
      }
    }
    const explicitDecisionIds = new Set<string>();
    for (const rawDecision of input.mode === "merge" ? input.decisions ?? [] : []) {
      const decisionResult = ConflictDecisionSchema.safeParse(rawDecision);
      if (!decisionResult.success) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_INVALID_DECISION",
          "Import decisions contain an invalid conflict decision."
        );
      }
      if (explicitDecisionIds.has(decisionResult.data.conflictId)) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_INVALID_DECISION",
          `Duplicate conflict decision: ${decisionResult.data.conflictId}.`
        );
      }
      explicitDecisionIds.add(decisionResult.data.conflictId);
      decisions.set(decisionResult.data.conflictId, decisionResult.data.decision);
    }

    if (input.mode === "merge") {
      const conflictIds = new Set(analysis.conflicts.map((match) => match.conflict.id));
      for (const conflictId of decisions.keys()) {
        if (!conflictIds.has(conflictId)) {
          throw new DataManagementApplyError(
            "DATA_ARCHIVE_INVALID_DECISION",
            `Decision references an unknown conflict: ${conflictId}.`
          );
        }
      }
    }

    const idMap = cloneArchiveIdMap(analysis.idMap);
    if (input.idMap) {
      const idMapResult = ArchiveIdMapSchema.safeParse(input.idMap);
      if (!idMapResult.success) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_INVALID_ID_MAP",
          "Import ID maps are invalid."
        );
      }
      for (const key of Object.keys(idMap) as Array<keyof ArchiveIdMap>) {
        Object.assign(idMap[key], idMapResult.data[key]);
      }
    }

    if (input.mode === "replace") {
      for (const key of Object.keys(idMap) as Array<keyof ArchiveIdMap>) {
        for (const sourceId of Object.keys(idMap[key])) {
          idMap[key][sourceId] = sourceId;
        }
      }
    }

    for (const conflict of analysis.conflicts) {
      const action = this.getConflictAction(
        conflict.mapKey,
        conflict.importedId,
        analysis,
        decisions,
        input.mode,
        input.restorePreferences === true
      );
      if (action === "create" && input.mode === "merge") {
        idMap[conflict.mapKey][conflict.importedId] = randomUUID();
      } else {
        idMap[conflict.mapKey][conflict.importedId] = conflict.localId;
      }
    }

    return { analysis, decisions, idMap };
  }

  private async stagePhotos(parsed: ParsedDataArchive) {
    const directory = await mkdtemp(join(tmpdir(), "local-recipe-book-import-"));
    const staged = new Map<string, string>();
    try {
      for (const asset of parsed.manifest.assets) {
        const data = parsed.entries.get(asset.path);
        if (!data) {
          throw new DataManagementApplyError(
            "DATA_ARCHIVE_ASSET_MISSING",
            `Photo asset is missing: ${asset.path}.`
          );
        }
        const path = join(directory, basename(asset.path));
        await writeFile(path, data);
        staged.set(asset.id, path);
      }
      return { directory, staged };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async writeAcceptedPhotos(input: {
    parsed: ParsedDataArchive;
    staged: Map<string, string>;
    idMap: ArchiveIdMap;
    analysis: ImportAnalysis;
    decisions: Map<string, ConflictDecision["decision"]>;
    mode: ImportMode;
    restorePreferences: boolean;
    counts: MutationCounts;
  }) {
    const written = new Map<string, { photoPath: string; photoMimeType: string; photoFileName: string }>();
    const oldPaths: string[] = [];
    const replacedMeals = new Set<string>();
    const mealPlan = input.parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "meal-plan" }> =>
        payload.domain === "meal-plan"
    );
    if (!mealPlan) {
      return { written, oldPaths };
    }

    for (const asset of input.parsed.manifest.assets) {
      const meal = mealPlan.meals.find((record) => record.id === asset.mealId);
      if (!meal) {
        input.counts.unresolved += 1;
        continue;
      }
      const action = this.getConflictAction(
        "meals",
        meal.id,
        input.analysis,
        input.decisions,
        input.mode,
        input.restorePreferences
      );
      if (action === "skip") {
        input.counts.assets.skipped += 1;
        continue;
      }

      const stagedPath = input.staged.get(asset.id);
      if (!stagedPath) {
        input.counts.assets.failed += 1;
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_ASSET_MISSING",
          `Photo asset was not staged: ${asset.path}.`
        );
      }

      const targetMealId = input.idMap.meals[meal.id] ?? meal.id;
      const data = await readFile(stagedPath);
      let saved;
      try {
        saved = await this.dependencies.writePhoto({
          mealId: targetMealId,
          photoDataUrl: `data:${asset.mimeType};base64,${data.toString("base64")}`,
          photoFileName: `meal-${targetMealId}-${asset.originalFileName}`,
        });
      } catch (error) {
        input.counts.assets.failed += 1;
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_ASSET_WRITE_FAILED",
          error instanceof Error ? error.message : `Unable to write photo asset ${asset.path}.`
        );
      }

      written.set(meal.id, {
        photoPath: saved.photoPath,
        photoMimeType: saved.photoMimeType,
        photoFileName: saved.photoFileName,
      });
      input.counts.assets.imported += 1;
      if (action === "replace") {
        replacedMeals.add(targetMealId);
      }
    }

    for (const mealId of replacedMeals) {
      const localMeal = input.analysis.local.meals.find(
        (meal) => meal.id === mealId
      );
      if (typeof localMeal?.photoPath === "string") {
        oldPaths.push(localMeal.photoPath);
      }
    }

    return { written, oldPaths };
  }

  private async clearContentForReplace(tx: ImportTransaction) {
    const pantryTx = tx as ImportTransaction & {
      pantryInventoryEvent?: ImportTransaction["pantryInventoryEvent"];
      pantryItem?: ImportTransaction["pantryItem"];
    };
    await pantryTx.pantryInventoryEvent?.deleteMany();
    await pantryTx.pantryItem?.deleteMany();
    await tx.recipeLink.deleteMany();
    await tx.meal.deleteMany();
    await tx.mealTypeDefinition.deleteMany();
    await tx.mealSubTypeDefinition.deleteMany();
    await tx.mealTypeProfile.deleteMany();
    await tx.groceryItem.deleteMany();
    await tx.groceryList.deleteMany();
    await tx.prepItem.deleteMany();
    await tx.prepList.deleteMany();
    await tx.recipeIngredient.deleteMany();
    await tx.recipeTag.deleteMany();
    await tx.recipe.deleteMany();
  }

  private async writeImportPayloads(input: {
    tx: ImportTransaction;
    parsed: ParsedDataArchive;
    idMap: ArchiveIdMap;
    analysis: ImportAnalysis;
    decisions: Map<string, ConflictDecision["decision"]>;
    mode: ImportMode;
    restorePreferences: boolean;
    photos: Map<string, { photoPath: string; photoMimeType: string; photoFileName: string }>;
    counts: MutationCounts;
  }) {
    const { tx, parsed, idMap, analysis, decisions, mode, restorePreferences, photos, counts } = input;
    const action = (mapKey: keyof ArchiveIdMap, id: string) =>
      this.getConflictAction(mapKey, id, analysis, decisions, mode, restorePreferences);
    const mapped = (mapKey: keyof ArchiveIdMap, id: string | null) => {
      if (!id) {
        return null;
      }
      const target = idMap[mapKey][id];
      if (!target) {
        counts.unresolved += 1;
        return null;
      }
      return target;
    };
    const countRecord = (recordAction: "create" | "replace" | "skip") => {
      if (recordAction === "create") counts.imported += 1;
      if (recordAction === "replace") counts.replaced += 1;
      if (recordAction === "skip") counts.skipped += 1;
    };

    const recipes = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "recipes" }> =>
        payload.domain === "recipes"
    );
    if (recipes) {
      for (const recipe of recipes.recipes) {
        const recordAction = action("recipes", recipe.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.recipes[recipe.id] ?? recipe.id;
        const data = {
          title: recipe.title,
          description: recipe.description,
          servings: recipe.servings,
          prepTime: recipe.prepTime,
          cookTime: recipe.cookTime,
          difficulty: recipe.difficulty,
          cuisine: recipe.cuisine,
          instructions: JSON.stringify(recipe.instructions),
          sourceUrl: recipe.sourceUrl,
          sourceLabel: recipe.sourceLabel,
          origin: recipe.origin,
          favourite: recipe.favourite,
          rating: recipe.rating,
          cookNotes: recipe.cookNotes,
          lastMadeAt: recipe.lastMadeAt ? new Date(recipe.lastMadeAt) : null,
          sourceRecipeId: mapped("recipes", recipe.sourceRecipeId),
        };
        if (recordAction === "replace") {
          await tx.recipe.update({ where: { id }, data });
          await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
          await tx.recipeTag.deleteMany({ where: { recipeId: id } });
        } else {
          await tx.recipe.create({
            data: {
              id,
              ...data,
              createdAt: new Date(recipe.createdAt),
              updatedAt: new Date(recipe.updatedAt),
            },
          });
        }
        if (recipe.ingredients.length > 0) {
          await tx.recipeIngredient.createMany({
            data: recipe.ingredients.map((ingredient) => ({
              recipeId: id,
              name: ingredient.name,
              quantity: ingredient.quantity,
              quantityNumerator: ingredient.quantityNumerator,
              quantityDenominator: ingredient.quantityDenominator,
              unit: ingredient.unit,
              group: ingredient.group,
              notes: ingredient.notes,
              parseConfidence: ingredient.parseConfidence,
              parseRaw: ingredient.parseRaw,
              order: ingredient.order,
            })),
          });
        }
        if (recipe.tags.length > 0) {
          await tx.recipeTag.createMany({
            data: recipe.tags.map((tag) => ({ recipeId: id, tag })),
          });
        }
      }

      if (recipes.links.length > 0) {
        await tx.recipeLink.createMany({
          data: recipes.links.map((link) => ({
            id: mode === "replace" ? link.id : randomUUID(),
            parentId: mapped("recipes", link.parentId),
            subRecipeId: mapped("recipes", link.subRecipeId),
          })).filter((link): link is { id: string; parentId: string; subRecipeId: string } => Boolean(link.parentId && link.subRecipeId)),
        });
      }
    }

    const mealPlan = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "meal-plan" }> =>
        payload.domain === "meal-plan"
    );
    if (mealPlan) {
      for (const profile of mealPlan.mealTypeProfiles) {
        const recordAction = action("mealTypeProfiles", profile.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.mealTypeProfiles[profile.id] ?? profile.id;
        const data = {
          name: profile.name,
          color: profile.color,
          description: profile.description,
          isDefault: profile.isDefault,
          priority: profile.priority,
          startDate: profile.startDate ? new Date(profile.startDate) : null,
          endDate: profile.endDate ? new Date(profile.endDate) : null,
        };
        if (recordAction === "replace") {
          await tx.mealTypeProfile.update({ where: { id }, data });
        } else {
          await tx.mealTypeProfile.create({
            data: {
              id,
              ...data,
              createdAt: new Date(profile.createdAt),
              updatedAt: new Date(profile.updatedAt),
            },
          });
        }
      }

      for (const definition of mealPlan.mealTypeDefinitions) {
        const recordAction = action("mealTypeDefinitions", definition.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.mealTypeDefinitions[definition.id] ?? definition.id;
        const profileId = mapped("mealTypeProfiles", definition.profileId);
        if (!profileId) continue;
        const data = {
          profileId,
          name: definition.name,
          slug: definition.slug,
          color: definition.color,
          enabled: definition.enabled,
          sortOrder: definition.sortOrder,
          cutoffTime: definition.cutoffTime ?? "23:59",
        };
        if (recordAction === "replace") {
          await tx.mealTypeDefinition.update({ where: { id }, data });
        } else {
          await tx.mealTypeDefinition.create({
            data: {
              id,
              ...data,
              createdAt: new Date(definition.createdAt),
              updatedAt: new Date(definition.updatedAt),
            },
          });
        }
      }

      for (const definition of mealPlan.mealSubTypeDefinitions) {
        const recordAction = action("mealSubTypeDefinitions", definition.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.mealSubTypeDefinitions[definition.id] ?? definition.id;
        const data = {
          name: definition.name,
          slug: definition.slug,
          color: definition.color,
          enabled: definition.enabled,
          sortOrder: definition.sortOrder,
        };
        if (recordAction === "replace") {
          await tx.mealSubTypeDefinition.update({ where: { id }, data });
        } else {
          await tx.mealSubTypeDefinition.create({
            data: {
              id,
              ...data,
              createdAt: new Date(definition.createdAt),
              updatedAt: new Date(definition.updatedAt),
            },
          });
        }
      }

      for (const meal of mealPlan.meals) {
        const recordAction = action("meals", meal.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.meals[meal.id] ?? meal.id;
        const recipeId = mapped("recipes", meal.recipeId);
        const mealTypeDefinitionId = mapped("mealTypeDefinitions", meal.mealTypeDefinitionId);
        const mealSubTypeDefinitionId = mapped("mealSubTypeDefinitions", meal.mealSubTypeDefinitionId);
        const photo = photos.get(meal.id);
        const data = {
          name: meal.name,
          date: meal.date ? new Date(meal.date) : null,
          mealType: meal.mealType,
          mealTypeDefinitionId,
          mealSubTypeDefinitionId,
          notes: meal.notes,
          ingredientsJson: JSON.stringify(meal.ingredients),
          description: meal.description,
          instructionsJson: JSON.stringify(meal.instructions),
          sortOrder: meal.sortOrder,
          servings: meal.servings,
          prepTime: meal.prepTime,
          cookTime: meal.cookTime,
          cuisine: meal.cuisine,
          servingsOverride: meal.servingsOverride,
          recipeId,
          photoDataUrl: null,
          photoPath: photo?.photoPath ?? null,
          photoMimeType: photo?.photoMimeType ?? null,
          photoFileName: photo?.photoFileName ?? null,
        };
        if (recordAction === "replace") {
          await tx.meal.update({ where: { id }, data });
        } else {
          await tx.meal.create({
            data: {
              id,
              ...data,
              createdAt: new Date(meal.createdAt),
            },
          });
        }
      }
    }

    const grocery = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "grocery" }> =>
        payload.domain === "grocery"
    );
    if (grocery) {
      for (const list of grocery.lists) {
        const recordAction = action("groceryLists", list.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.groceryLists[list.id] ?? list.id;
        const data = {
          name: list.name,
          date: list.date ? new Date(list.date) : null,
          favourite: list.favourite,
        };
        if (recordAction === "replace") {
          await tx.groceryList.update({ where: { id }, data });
          await tx.groceryItem.deleteMany({ where: { groceryListId: id } });
        } else {
          await tx.groceryList.create({
            data: {
              id,
              ...data,
              createdAt: new Date(list.createdAt),
              updatedAt: new Date(list.updatedAt),
            },
          });
        }
        for (const item of list.items) {
          const itemAction = action("groceryItems", item.id);
          countRecord(itemAction);
          if (itemAction === "skip") continue;
          const itemId = idMap.groceryItems[item.id] ?? item.id;
          const itemData = {
            groceryListId: id,
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            category: item.category,
            notes: item.notes,
            meal: item.meal,
            checked: item.checked,
            sortOrder: item.sortOrder,
          };
          if (itemAction === "replace") {
            await tx.groceryItem.update({ where: { id: itemId }, data: itemData });
          } else {
            await tx.groceryItem.create({ data: { id: itemId, ...itemData } });
          }
        }
      }
    }

    const prepLists = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "prep-lists" }> =>
        payload.domain === "prep-lists"
    );
    if (prepLists) {
      for (const list of prepLists.lists) {
        const recordAction = action("prepLists", list.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.prepLists[list.id] ?? list.id;
        const sourceMealIds = list.sourceMealIds.map((value) => mapped("meals", value)).filter((value): value is string => Boolean(value));
        const sourceRecipeIds = list.sourceRecipeIds.map((value) => mapped("recipes", value)).filter((value): value is string => Boolean(value));
        const data = {
          name: list.name,
          notes: list.notes,
          date: list.date ? new Date(list.date) : null,
          fromDate: list.fromDate ? new Date(list.fromDate) : null,
          toDate: list.toDate ? new Date(list.toDate) : null,
          sourceMode: list.sourceMode,
          sourceLabel: list.sourceLabel,
          sourceMealIdsJson: JSON.stringify(sourceMealIds),
          sourceRecipeIdsJson: JSON.stringify(sourceRecipeIds),
          favourite: list.favourite,
          sortMode: list.sortMode,
          groupBy: list.groupBy,
          includeIngredients: list.includeIngredients,
          includeTasks: list.includeTasks,
          includeQuantities: list.includeQuantities,
          includeIngredientTypes: list.includeIngredientTypes,
          includeSourceLabels: list.includeSourceLabels,
          excludePantryStaples: list.excludePantryStaples,
        };
        if (recordAction === "replace") {
          await tx.prepList.update({ where: { id }, data });
          await tx.prepItem.deleteMany({ where: { prepListId: id } });
        } else {
          await tx.prepList.create({
            data: {
              id,
              ...data,
              createdAt: new Date(list.createdAt),
              updatedAt: new Date(list.updatedAt),
            },
          });
        }
        for (const item of list.items) {
          const itemAction = action("prepItems", item.id);
          countRecord(itemAction);
          if (itemAction === "skip") continue;
          const itemId = idMap.prepItems[item.id] ?? item.id;
          const itemData = {
            prepListId: id,
            kind: item.kind,
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            ingredientType: item.ingredientType,
            prepGroup: item.prepGroup,
            dish: item.dish,
            notes: item.notes,
            checked: item.checked,
            sortOrder: item.sortOrder,
            sourceMealIdsJson: JSON.stringify(item.sourceMealIds.map((value) => mapped("meals", value)).filter((value): value is string => Boolean(value))),
            sourceRecipeIdsJson: JSON.stringify(item.sourceRecipeIds.map((value) => mapped("recipes", value)).filter((value): value is string => Boolean(value))),
            sourceLabelsJson: JSON.stringify(item.sourceLabels),
          };
          if (itemAction === "replace") {
            await tx.prepItem.update({ where: { id: itemId }, data: itemData });
          } else {
            await tx.prepItem.create({ data: { id: itemId, ...itemData } });
          }
        }
      }
    }

    const preferences = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "preferences" }> =>
        payload.domain === "preferences"
    )?.preferences[0];
    if (preferences && restorePreferences) {
      const preferenceAction = action("preferences", preferences.id);
      if (preferenceAction === "skip") {
        counts.skipped += 1;
      } else {
        const data = safePreferenceDatabaseData(preferences as Record<string, unknown>);
        await tx.userPreference.upsert({
          where: { id: "default" },
          update: data,
          create: { id: "default", ...data },
        });
        counts.preferencesRestored = true;
        countRecord(preferenceAction);
      }
    }

    const pantry = parsed.payloads.find(
      (payload): payload is Extract<DataArchivePayload, { domain: "pantry" }> =>
        payload.domain === "pantry"
    );
    if (pantry) {
      const pantryItemDelegate = (tx as unknown as { pantryItem?: typeof tx.pantryItem }).pantryItem;
      if (!pantryItemDelegate) return;
      for (const item of pantry.items) {
        const recordAction = action("pantryItems", item.id);
        countRecord(recordAction);
        if (recordAction === "skip") continue;
        const id = idMap.pantryItems[item.id] ?? item.id;
        const itemData = {
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
        };
        if (recordAction === "replace") {
          await tx.pantryItem.update({ where: { id }, data: itemData });
          await tx.pantryInventoryEvent.deleteMany({ where: { itemId: id } });
          await tx.pantryAlias.deleteMany({ where: { itemId: id } });
          await tx.pantryLocationStock.deleteMany({ where: { itemId: id } });
          await tx.pantryPackage.deleteMany({ where: { itemId: id } });
          await tx.pantryWarningRule.deleteMany({ where: { itemId: id } });
        } else {
          await tx.pantryItem.create({ data: { id, ...itemData, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) } });
        }

        await tx.pantryAlias.createMany({ data: item.aliases.map((alias) => ({
          id: input.mode === "replace" ? alias.id : randomUUID(),
          itemId: id,
          label: alias.label,
          normalizedAlias: alias.normalizedAlias,
          createdAt: new Date(alias.createdAt),
        })) });
        const locationIds = new Map<string, string>();
        const lotIds = new Map<string, string>();
        for (const location of item.locations) {
          const locationId = input.mode === "replace" ? location.id : randomUUID();
          locationIds.set(location.id, locationId);
          await tx.pantryLocationStock.create({ data: {
            id: locationId,
            itemId: id,
            location: location.location,
            normalizedLocation: location.normalizedLocation,
            quantity: location.quantity,
            unit: location.unit,
            approximate: location.approximate,
            createdAt: new Date(location.createdAt),
            updatedAt: new Date(location.updatedAt),
          } });
          for (const lot of location.lots) {
            const lotId = input.mode === "replace" ? lot.id : randomUUID();
            lotIds.set(lot.id, lotId);
            await tx.pantryLot.create({ data: {
              id: lotId,
              locationStockId: locationId,
              quantity: lot.quantity,
              unit: lot.unit,
              approximate: lot.approximate,
              bestBeforeAt: lot.bestBeforeAt ? new Date(lot.bestBeforeAt) : null,
              expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
              createdAt: new Date(lot.createdAt),
              updatedAt: new Date(lot.updatedAt),
            } });
          }
        }
        await tx.pantryPackage.createMany({ data: item.packages.map((pack) => ({
          id: input.mode === "replace" ? pack.id : randomUUID(), itemId: id, label: pack.label,
          quantity: pack.quantity, unit: pack.unit, dimension: pack.dimension,
          confirmed: pack.confirmed, enabled: pack.enabled,
          createdAt: new Date(pack.createdAt), updatedAt: new Date(pack.updatedAt),
        })) });
        await tx.pantryWarningRule.createMany({ data: item.warningRules.map((rule) => ({
          id: input.mode === "replace" ? rule.id : randomUUID(), itemId: id, threshold: rule.threshold,
          unit: rule.unit, severity: rule.severity, message: rule.message, enabled: rule.enabled,
          createdAt: new Date(rule.createdAt), updatedAt: new Date(rule.updatedAt),
        })) });

        if (pantry.historyIncluded) {
          for (const event of pantry.events.filter((candidate) => candidate.itemId === item.id)) {
            const sourceIdentity = event.sourceIdentity ?? `archive:${item.id}:event:${event.id}`;
            const existing = await tx.pantryInventoryEvent.findUnique({ where: { sourceIdentity } });
            if (existing) continue;
            await tx.pantryInventoryEvent.create({ data: {
              id: input.mode === "replace" ? event.id : randomUUID(), itemId: id,
              locationStockId: event.locationStockId ? locationIds.get(event.locationStockId) ?? null : null,
              lotId: event.lotId ? lotIds.get(event.lotId) ?? null : null,
              type: event.type, quantityDelta: event.quantityDelta, quantity: event.quantity,
              unit: event.unit, approximate: event.approximate, sourceType: event.sourceType,
              sourceId: event.sourceId, sourceIdentity, metadataJson: event.metadataJson,
              occurredAt: new Date(event.occurredAt), importedAt: event.importedAt ? new Date(event.importedAt) : new Date(),
            } });
          }
        } else {
          for (const location of item.locations) {
            const sourceIdentity = `archive:${item.id}:baseline:${location.normalizedLocation}`;
            const existing = await tx.pantryInventoryEvent.findUnique({ where: { sourceIdentity } });
            if (existing) continue;
            await tx.pantryInventoryEvent.create({ data: {
              id: randomUUID(), itemId: id, locationStockId: locationIds.get(location.id) ?? null,
              type: "imported-baseline", quantity: location.quantity, unit: location.unit,
              approximate: location.approximate, sourceType: "archive", sourceId: item.id,
              sourceIdentity,
              metadataJson: JSON.stringify({ sourceArchive: parsed.manifest.format, sourceVersion: parsed.manifest.schemaVersion }),
              occurredAt: new Date(), importedAt: new Date(),
            } });
          }
        }
      }
    }
  }

  private async cleanupWrittenPhotos(
    photos: Map<string, { photoPath: string; photoMimeType: string; photoFileName: string }>
  ) {
    await Promise.all(
      [...photos.values()].map((photo) => this.dependencies.deletePhoto(photo.photoPath))
    );
  }

  async applyImport(
    archive: Uint8Array,
    input: DataManagementApplyInput
  ): Promise<DataManagementApplyResult> {
    const parsed = this.parseArchive(archive);
    if (input.mode === "replace") {
      if (!this.dependencies.replaceEnabled) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_REPLACE_DISABLED",
          "Replace restore is disabled until its recovery capability is enabled."
        );
      }
      if (parsed.manifest.scope !== "all") {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_REPLACE_REQUIRES_FULL_ARCHIVE",
          "Replace restore requires an all-data archive."
        );
      }
    }

    await bootstrapDatabase();
    const local = await this.loadLocalSnapshot();
    const planned = this.buildApplyAnalysis(parsed, local, input);
    const backup =
      input.mode === "replace"
        ? await this.exportArchive("all")
        : undefined;
    const backupPath = backup
      ? await this.dependencies.writeBackup(
          backup.archive,
          `local-recipe-book-recovery-${new Date().toISOString().slice(0, 10)}.lrb`
        )
      : undefined;
    const staged = await this.stagePhotos(parsed);
    const counts: MutationCounts = {
      imported: 0,
      skipped: 0,
      replaced: 0,
      unresolved: 0,
      assets: { imported: 0, skipped: 0, failed: 0 },
      preferencesRestored: false,
    };
    let writtenPhotos = new Map<
      string,
      { photoPath: string; photoMimeType: string; photoFileName: string }
    >();

    try {
      const acceptedPhotos = await this.writeAcceptedPhotos({
        parsed,
        staged: staged.staged,
        idMap: planned.idMap,
        analysis: planned.analysis,
        decisions: planned.decisions,
        mode: input.mode,
        restorePreferences: input.restorePreferences === true,
        counts,
      });
      writtenPhotos = acceptedPhotos.written;
      if (input.mode === "replace") {
        for (const meal of local.meals) {
          if (typeof meal.photoPath === "string") {
            acceptedPhotos.oldPaths.push(meal.photoPath);
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        if (input.mode === "replace") {
          await this.clearContentForReplace(tx);
        }
        await this.writeImportPayloads({
          tx,
          parsed,
          idMap: planned.idMap,
          analysis: planned.analysis,
          decisions: planned.decisions,
          mode: input.mode,
          restorePreferences: input.restorePreferences === true,
          photos: writtenPhotos,
          counts,
        });
      });

      await Promise.allSettled(
        [...new Set(acceptedPhotos.oldPaths)].map((path) =>
          this.dependencies.deletePhoto(path)
        )
      );
      for (const entity of [
        "meal",
        "recipe",
        "groceryList",
        "prepList",
        "mealType",
        "preference",
      ] as const) {
        await publishCommittedChange(entity, "bulk");
      }
      return {
        summary: {
          mode: input.mode,
          imported: counts.imported,
          skipped: counts.skipped,
          replaced: counts.replaced,
          unresolved: counts.unresolved,
          conflicts: planned.analysis.conflicts.length,
          assets: counts.assets,
          preferencesRestored: counts.preferencesRestored,
        },
        ...(backupPath ? { backupPath } : {}),
      };
    } catch (error) {
      await this.cleanupWrittenPhotos(writtenPhotos);
      if (error instanceof DataManagementApplyError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new DataManagementApplyError(
          "DATA_ARCHIVE_APPLY_FAILED",
          "The data archive could not be applied; no database changes were retained."
        );
      }
      throw new DataManagementApplyError(
        "DATA_ARCHIVE_APPLY_FAILED",
        error instanceof Error ? error.message : "The data archive could not be applied."
      );
    } finally {
      await rm(staged.directory, { recursive: true, force: true });
    }
  }

  async exportData(scope: ExportScope) {
    return this.exportArchive(scope);
  }
}
