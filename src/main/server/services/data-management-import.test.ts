import { zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  meal: { findMany: vi.fn() },
  recipe: { findMany: vi.fn() },
  recipeLink: { findMany: vi.fn() },
  groceryList: { findMany: vi.fn() },
  prepList: { findMany: vi.fn() },
  mealTypeProfile: { findMany: vi.fn() },
  mealSubTypeDefinition: { findMany: vi.fn() },
  userPreference: { findUnique: vi.fn() },
  syncState: {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockImplementation(async ({ update }: { update: { value: string } }) => update),
  },
  $transaction: vi.fn(),
}));

const readPhotoMock = vi.hoisted(() => vi.fn());
const writePhotoMock = vi.hoisted(() => vi.fn());
const deletePhotoMock = vi.hoisted(() => vi.fn());
const writeBackupMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/bootstrap", () => ({
  bootstrapDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/meal-photo-storage", () => ({
  readMealPhotoFile: readPhotoMock,
  saveMealPhotoDataUrl: writePhotoMock,
  deleteMealPhotoFile: deletePhotoMock,
}));

import {
  DATA_ARCHIVE_DOMAIN_VERSION,
  DATA_ARCHIVE_FORMAT,
  DATA_ARCHIVE_FORMAT_VERSION,
  DATA_ARCHIVE_LAYOUT,
  DATA_ARCHIVE_SCHEMA_VERSION,
  DATA_ARCHIVE_SCOPE_DOMAINS,
  type ArchiveManifest,
  type DataArchivePayload,
} from "@shared/schemas/data-management-schemas";
import { createDataArchive, sha256Hex } from "../lib/data-archive";
import {
  DataManagementService,
} from "./data-management-service";

const dates = {
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

function recipe(id: string, title: string, sourceRecipeId: string | null = null) {
  return {
    id,
    title,
    description: null,
    servings: 2,
    prepTime: null,
    cookTime: null,
    difficulty: null,
    cuisine: null,
    instructions: ["Cook"],
    sourceUrl: null,
    sourceLabel: null,
    origin: "manual" as const,
    favourite: false,
    rating: null,
    cookNotes: null,
    lastMadeAt: null,
    ...dates,
    sourceRecipeId,
    sourceRecipe: null,
    ingredients: [],
    tags: [],
    linkedSubRecipes: [],
  };
}

function emptyPayload(domain: DataArchivePayload["domain"]): DataArchivePayload {
  switch (domain) {
    case "meal-plan":
      return {
        domain,
        version: DATA_ARCHIVE_DOMAIN_VERSION,
        meals: [],
        mealTypeProfiles: [],
        mealTypeDefinitions: [],
        mealSubTypeDefinitions: [],
      };
    case "recipes":
      return { domain, version: DATA_ARCHIVE_DOMAIN_VERSION, recipes: [], links: [] };
    case "grocery":
      return { domain, version: DATA_ARCHIVE_DOMAIN_VERSION, lists: [] };
    case "prep-lists":
      return { domain, version: DATA_ARCHIVE_DOMAIN_VERSION, lists: [] };
    case "preferences":
      return { domain, version: DATA_ARCHIVE_DOMAIN_VERSION, preferences: [] };
    case "pantry":
      return { domain, version: DATA_ARCHIVE_DOMAIN_VERSION, historyIncluded: false, items: [], events: [] };
  }
}

function archive(
  scope: "meal-plan" | "recipes" | "all",
  payloadOverrides: Partial<Record<DataArchivePayload["domain"], DataArchivePayload>> = {},
  assets: Array<{
    id: string;
    mealId: string;
    path: string;
    mimeType: "image/png";
    originalFileName: string;
    data: Buffer;
  }> = [],
  checksumOverrides: Record<string, string> = {}
) {
  const payloads = DATA_ARCHIVE_SCOPE_DOMAINS[scope].map(
    (domain) => payloadOverrides[domain] ?? emptyPayload(domain)
  );
  const manifest: ArchiveManifest = {
    format: DATA_ARCHIVE_FORMAT,
    formatVersion: DATA_ARCHIVE_FORMAT_VERSION,
    schemaVersion: DATA_ARCHIVE_SCHEMA_VERSION,
    appVersion: "1.1.1",
    exportedAt: dates.updatedAt,
    scope,
    domains: DATA_ARCHIVE_SCOPE_DOMAINS[scope].map((domain) => ({
      domain,
      version: DATA_ARCHIVE_DOMAIN_VERSION,
      path: DATA_ARCHIVE_LAYOUT.domains[domain],
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: "meal-photo" as const,
      path: asset.path,
      mealId: asset.mealId,
      mimeType: asset.mimeType,
      originalFileName: asset.originalFileName,
      size: asset.data.byteLength,
      sha256: checksumOverrides[asset.id] ?? sha256Hex(asset.data),
    })),
    idPolicy: { sourceIds: "preserved", importIdMap: "required" },
  };

  return createDataArchive([
    { path: DATA_ARCHIVE_LAYOUT.manifest, data: Buffer.from(JSON.stringify(manifest)) },
    ...payloads.map((payload) => ({
      path: DATA_ARCHIVE_LAYOUT.domains[payload.domain],
      data: Buffer.from(JSON.stringify(payload)),
    })),
    ...assets.map((asset) => ({ path: asset.path, data: asset.data })),
  ]);
}

function createTransaction() {
  const tx = {
    recipeLink: { deleteMany: vi.fn(), createMany: vi.fn() },
    meal: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    mealTypeDefinition: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    mealSubTypeDefinition: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    mealTypeProfile: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    groceryItem: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    groceryList: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    prepItem: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    prepList: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    recipeTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    recipe: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    userPreference: { upsert: vi.fn() },
  };
  return tx;
}

function configureSnapshot() {
  prismaMock.meal.findMany.mockResolvedValue([]);
  prismaMock.recipe.findMany.mockResolvedValue([]);
  prismaMock.recipeLink.findMany.mockResolvedValue([]);
  prismaMock.groceryList.findMany.mockResolvedValue([]);
  prismaMock.prepList.findMany.mockResolvedValue([]);
  prismaMock.mealTypeProfile.findMany.mockResolvedValue([]);
  prismaMock.mealSubTypeDefinition.findMany.mockResolvedValue([]);
  prismaMock.userPreference.findUnique.mockResolvedValue(null);
}

function createService() {
  return new DataManagementService({
    mealService: { listAllMeals: vi.fn() },
    recipeService: { exportRecipes: vi.fn() },
    groceryService: { listGroceryLists: vi.fn() },
    prepListService: { listPrepLists: vi.fn() },
    mealTypeService: { listProfiles: vi.fn() },
    mealSubTypeService: { listDefinitions: vi.fn() },
    preferenceService: { getPreferences: vi.fn() },
    readPhoto: readPhotoMock,
    writePhoto: writePhotoMock,
    deletePhoto: deletePhotoMock,
    writeBackup: writeBackupMock,
    replaceEnabled: true,
    appVersion: "1.1.1",
  });
}

describe("DataManagementService import validation and restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureSnapshot();
    writePhotoMock.mockResolvedValue({
      photoPath: "meal-photos/imported.png",
      photoMimeType: "image/png",
      photoFileName: "imported.png",
    });
    deletePhotoMock.mockResolvedValue(undefined);
    writeBackupMock.mockResolvedValue("C:/backup/recovery.lrb");
  });

  it("rejects unsupported, malformed, checksum-invalid, traversal, and oversized archives without DB reads or writes", async () => {
    const service = createService();
    const unsupported = createDataArchive([
      {
        path: DATA_ARCHIVE_LAYOUT.manifest,
        data: Buffer.from(JSON.stringify({ format: DATA_ARCHIVE_FORMAT, formatVersion: 2 })),
      },
    ]);
    const malformed = createDataArchive([
      { path: DATA_ARCHIVE_LAYOUT.manifest, data: Buffer.from("{") },
    ]);
    const invalidChecksum = archive("meal-plan", {}, [
      {
        id: "asset-1",
        mealId: "meal-1",
        path: "assets/meal-photos/meal-meal-1.png",
        mimeType: "image/png",
        originalFileName: "meal.png",
        data: Buffer.from("photo"),
      },
    ], { "asset-1": "0".repeat(64) });
    const traversal = Buffer.from(zipSync({ "../outside.json": Buffer.from("x") }));
    const oversized = Buffer.from(zipSync({
      [DATA_ARCHIVE_LAYOUT.manifest]: Buffer.from("{}"),
      "assets/meal-photos/meal-large.png": Buffer.alloc(8 * 1024 * 1024 + 1),
    }));

    const results = await Promise.all([
      service.validateArchive(unsupported),
      service.validateArchive(malformed),
      service.validateArchive(invalidChecksum),
      service.validateArchive(traversal),
      service.validateArchive(oversized),
    ]);

    expect(results.map((result) => result.valid)).toEqual([false, false, false, false, false]);
    expect(results.flatMap((result) => result.errors.map((error) => error.code))).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_FORMAT_VERSION",
        "INVALID_MANIFEST",
        "CHECKSUM_MISMATCH",
        "PATH_TRAVERSAL",
        "ASSET_TOO_LARGE",
      ])
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(writePhotoMock).not.toHaveBeenCalled();

    const secretPayload = {
      domain: "preferences",
      version: 1,
      preferences: [{
        id: "default",
        ...dates,
        householdSize: 2,
        cookingLength: "weeknight",
        dietaryTags: [],
        favoriteCuisines: [],
        avoidCuisines: [],
        avoidIngredients: [],
        pantryStaples: [],
        planningNotes: "",
        nutritionTags: [],
        skillLevel: "home-cook",
        budgetRange: "moderate",
        autoGenerateGrocery: true,
        consolidateIngredients: true,
        defaultPlanLength: "7",
        groceryGrouping: "category",
        defaultRecipeView: "basic",
        defaultUnitMode: "cup",
        reasoningEffort: "secret",
      }],
    } as never;
    const secretResult = await service.validateArchive(
      archive("all", { preferences: secretPayload })
    );
    expect(secretResult.valid).toBe(false);
    expect(secretResult.errors.map((error) => error.code)).toContain(
      "INVALID_DOMAIN_PAYLOAD"
    );
  });

  it("previews recipe conflicts without mutation and requires explicit decisions", async () => {
    prismaMock.recipe.findMany.mockResolvedValue([
      { id: "local-sub", title: "Sub Recipe", sourceUrl: null },
    ]);
    const payload: DataArchivePayload = {
      domain: "recipes",
      version: 1,
      recipes: [recipe("import-sub", "Sub Recipe"), recipe("import-parent", "Parent Recipe", "import-sub")],
      links: [],
    };
    const service = createService();
    const input = archive("recipes", { recipes: payload });

    const preview = await service.previewImport(input);
    expect(preview.conflicts).toEqual([
      expect.objectContaining({
        id: "recipe:import-sub",
        domain: "recipe",
        reason: "same-identity",
      }),
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await expect(service.applyImport(input, { mode: "merge" })).rejects.toEqual(
      expect.objectContaining({ code: "DATA_ARCHIVE_CONFLICT_DECISIONS_REQUIRED" })
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("maps imported recipe references when a conflict is explicitly imported", async () => {
    prismaMock.recipe.findMany.mockResolvedValue([
      { id: "local-sub", title: "Sub Recipe", sourceUrl: null },
    ]);
    const tx = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
    const payload: DataArchivePayload = {
      domain: "recipes",
      version: 1,
      recipes: [recipe("import-sub", "Sub Recipe"), recipe("import-parent", "Parent Recipe", "import-sub")],
      links: [],
    };
    const service = createService();
    const input = archive("recipes", { recipes: payload });

    const result = await service.applyImport(input, {
      mode: "merge",
      bulkDecision: "import",
    });

    const subCreate = tx.recipe.create.mock.calls.find(([call]) => call.data.title === "Sub Recipe")?.[0].data;
    const parentCreate = tx.recipe.create.mock.calls.find(([call]) => call.data.title === "Parent Recipe")?.[0].data;
    expect(subCreate.id).not.toBe("import-sub");
    expect(parentCreate.sourceRecipeId).toBe(subCreate.id);
    expect(result.summary.replaced).toBe(0);
    expect(result.summary.imported).toBe(2);
  });

  it("creates a recovery backup and keeps replace content-only unless preferences are opted in", async () => {
    const preferences = {
      domain: "preferences" as const,
      version: 1 as const,
      preferences: [{
        id: "default",
        ...dates,
        householdSize: 4,
        cookingLength: "long",
        dietaryTags: ["vegetarian"],
        favoriteCuisines: [],
        avoidCuisines: [],
        avoidIngredients: [],
        pantryStaples: [],
        planningNotes: "Imported",
        nutritionTags: [],
        skillLevel: "home-cook",
        budgetRange: "moderate",
        autoGenerateGrocery: false,
        consolidateIngredients: true,
        defaultPlanLength: "5",
        groceryGrouping: "category",
        defaultRecipeView: "basic",
        defaultUnitMode: "cup",
      }],
    } satisfies DataArchivePayload;
    const service = createService();
    prismaMock.userPreference.findUnique.mockResolvedValue({
      id: "default",
      householdSize: 2,
    });
    vi.spyOn(service, "exportArchive").mockResolvedValue({
      archive: Buffer.from("recovery"),
      fileName: "recovery.lrb",
      manifest: {} as ArchiveManifest,
      missingPhotos: [],
    });
    const input = archive("all", { preferences });
    const tx = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

    const contentOnly = await service.applyImport(input, { mode: "replace" });
    expect(writeBackupMock).toHaveBeenCalledWith(expect.any(Buffer), expect.stringContaining("recovery-"));
    expect(contentOnly.summary.preferencesRestored).toBe(false);
    expect(tx.userPreference.upsert).not.toHaveBeenCalled();

    vi.clearAllMocks();
    configureSnapshot();
    prismaMock.$transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
    writeBackupMock.mockResolvedValue("C:/backup/recovery-2.lrb");
    const restored = await service.applyImport(input, {
      mode: "replace",
      restorePreferences: true,
      decisions: [{ conflictId: "preferences:default", decision: "replace" }],
    });
    expect(restored.summary.preferencesRestored).toBe(true);
    expect(tx.userPreference.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      update: expect.objectContaining({ householdSize: 4 }),
      create: expect.objectContaining({ householdSize: 4 }),
    });
    expect(tx.userPreference.upsert.mock.calls[0][0].update).not.toHaveProperty("reasoningEffort");
  });

  it("cleans up staged photo writes when the database transaction fails", async () => {
    const mealPlan: DataArchivePayload = {
      domain: "meal-plan",
      version: 1,
      meals: [{
        id: "meal-1",
        name: "Dinner",
        date: null,
        mealType: "DINNER",
        mealTypeDefinitionId: null,
        mealSubTypeDefinitionId: null,
        notes: null,
        ingredients: [],
        description: null,
        instructions: [],
        sortOrder: 0,
        servings: 2,
        prepTime: null,
        cookTime: null,
        cuisine: null,
        servingsOverride: null,
        recipeId: null,
        photoAssetId: "asset-1",
        createdAt: dates.createdAt,
      }],
      mealTypeProfiles: [],
      mealTypeDefinitions: [],
      mealSubTypeDefinitions: [],
    };
    const service = createService();
    const input = archive("meal-plan", { "meal-plan": mealPlan }, [{
      id: "asset-1",
      mealId: "meal-1",
      path: "assets/meal-photos/meal-meal-1.png",
      mimeType: "image/png",
      originalFileName: "meal.png",
      data: Buffer.from("photo"),
    }]);
    prismaMock.$transaction.mockRejectedValue(new Error("injected failure"));

    await expect(service.applyImport(input, { mode: "merge" })).rejects.toEqual(
      expect.objectContaining({ code: "DATA_ARCHIVE_APPLY_FAILED" })
    );
    expect(writePhotoMock).toHaveBeenCalled();
    expect(deletePhotoMock).toHaveBeenCalledWith("meal-photos/imported.png");
  });
});
