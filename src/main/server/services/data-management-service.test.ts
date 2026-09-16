import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  meal: { findMany: vi.fn() },
  recipe: { findMany: vi.fn() },
  recipeLink: { findMany: vi.fn() },
}));

const readPhotoMock = vi.hoisted(() => vi.fn());
const writePhotoMock = vi.hoisted(() => vi.fn());
const deletePhotoMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/bootstrap", () => ({
  bootstrapDatabase: vi.fn(),
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/meal-photo-storage", () => ({
  readMealPhotoFile: readPhotoMock,
  saveMealPhotoDataUrl: writePhotoMock,
  deleteMealPhotoFile: deletePhotoMock,
}));

import {
  ArchiveManifestSchema,
  DATA_ARCHIVE_LAYOUT,
  DataArchivePayloadSchema,
} from "@shared/schemas/data-management-schemas";
import { extractDataArchive } from "../lib/data-archive";
import { DataManagementService } from "./data-management-service";

const scheduledMeal = {
  id: "meal-scheduled",
  name: "Linked Dinner",
  date: "2026-08-19T12:00:00.000Z",
  mealType: "DINNER",
  sortOrder: 0,
  mealTypeDefinitionId: "meal-type-dinner",
  mealSubTypeDefinitionId: "meal-subtype-main",
  notes: "Use the fresh herbs",
  ingredients: [
    {
      name: "Basil",
      quantity: "2",
      unit: "tbsp",
      group: null,
      notes: null,
      order: 0,
    },
  ],
  description: "A linked meal",
  cuisine: "italian",
  instructions: ["Boil water", "Finish the sauce"],
  servings: 2,
  prepTime: 10,
  cookTime: 20,
  servingsOverride: null,
  recipeId: "recipe-parent",
  photoMimeType: "image/png",
  photoFileName: "dinner.png",
  linkedRecipe: null,
};

const unscheduledMeal = {
  ...scheduledMeal,
  id: "meal-unscheduled",
  name: "Meal Bank Entry",
  date: null,
  recipeId: null,
  mealTypeDefinitionId: null,
  mealSubTypeDefinitionId: null,
};

const recipeRows = [
  {
    id: "recipe-parent",
    title: "Parent Recipe",
    description: "A parent",
    servings: 4,
    prepTime: 10,
    cookTime: 20,
    difficulty: "easy",
    cuisine: "italian",
    instructions: JSON.stringify(["Cook it"]),
    sourceUrl: "https://example.com/parent",
    sourceLabel: "Example",
    origin: "manual",
    favourite: true,
    rating: 5,
    cookNotes: "Rest before serving",
    lastMadeAt: new Date("2026-08-18T12:00:00.000Z"),
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-18T12:00:00.000Z"),
    sourceRecipeId: "recipe-source",
    sourceRecipe: { id: "recipe-source", title: "Source Recipe" },
    ingredients: [
      {
        id: "ingredient-parent",
        name: "Tomato",
        quantity: 2,
        quantityNumerator: null,
        quantityDenominator: null,
        unit: "piece",
        group: null,
        notes: null,
        parseConfidence: "high",
        parseRaw: null,
        order: 0,
      },
    ],
    tags: [{ tag: "weeknight" }],
    linkedFrom: [{ subRecipe: { id: "recipe-sub", title: "Sub Recipe" } }],
  },
  {
    id: "recipe-source",
    title: "Source Recipe",
    description: null,
    servings: 2,
    prepTime: null,
    cookTime: null,
    difficulty: null,
    cuisine: null,
    instructions: JSON.stringify(["Start here"]),
    sourceUrl: null,
    sourceLabel: null,
    origin: "imported",
    favourite: false,
    rating: null,
    cookNotes: null,
    lastMadeAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    sourceRecipeId: null,
    sourceRecipe: null,
    ingredients: [],
    tags: [],
    linkedFrom: [],
  },
  {
    id: "recipe-sub",
    title: "Sub Recipe",
    description: null,
    servings: 2,
    prepTime: null,
    cookTime: null,
    difficulty: null,
    cuisine: null,
    instructions: JSON.stringify(["Mix"]),
    sourceUrl: null,
    sourceLabel: null,
    origin: "manual",
    favourite: false,
    rating: null,
    cookNotes: null,
    lastMadeAt: null,
    createdAt: new Date("2026-07-02T12:00:00.000Z"),
    updatedAt: new Date("2026-07-02T12:00:00.000Z"),
    sourceRecipeId: null,
    sourceRecipe: null,
    ingredients: [],
    tags: [],
    linkedFrom: [],
  },
];

const dependencies = {
  mealService: { listAllMeals: vi.fn() },
  recipeService: { exportRecipes: vi.fn() },
  groceryService: { listGroceryLists: vi.fn() },
  prepListService: { listPrepLists: vi.fn() },
  mealTypeService: { listProfiles: vi.fn() },
  mealSubTypeService: { listDefinitions: vi.fn() },
  preferenceService: { getPreferences: vi.fn() },
  readPhoto: readPhotoMock,
  appVersion: "1.1.1",
};

function readJson<T>(entries: Map<string, Buffer>, path: string) {
  const entry = entries.get(path);
  if (!entry) {
    throw new Error(`Missing archive entry ${path}`);
  }
  return JSON.parse(entry.toString("utf8")) as T;
}

function configureFixtures() {
  vi.mocked(dependencies.mealService.listAllMeals).mockResolvedValue([
    scheduledMeal,
    unscheduledMeal,
  ] as never);
  vi.mocked(dependencies.recipeService.exportRecipes).mockResolvedValue({
    version: "2",
    exportedAt: "2026-08-19T12:00:00.000Z",
    recipes: recipeRows.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      difficulty: recipe.difficulty,
      cuisine: recipe.cuisine,
      instructions: JSON.parse(recipe.instructions),
      sourceUrl: recipe.sourceUrl,
      sourceLabel: recipe.sourceLabel,
      origin: recipe.origin,
      favourite: recipe.favourite,
      rating: recipe.rating,
      cookNotes: recipe.cookNotes,
      lastMadeAt: recipe.lastMadeAt?.toISOString() ?? null,
      tags: recipe.tags.map((tag) => tag.tag),
      ingredients: recipe.ingredients,
    })),
  } as never);
  vi.mocked(dependencies.mealTypeService.listProfiles).mockResolvedValue([
    {
      id: "profile-default",
      name: "Default",
      color: "#3B5E45",
      description: null,
      isDefault: true,
      priority: 0,
      startDate: null,
      endDate: null,
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      mealTypes: [
        {
          id: "meal-type-dinner",
          profileId: "profile-default",
          name: "Dinner",
          slug: "DINNER",
          color: "#3B5E45",
          enabled: true,
          sortOrder: 0,
          createdAt: "2026-07-01T12:00:00.000Z",
          updatedAt: "2026-07-01T12:00:00.000Z",
        },
      ],
    },
  ] as never);
  vi.mocked(dependencies.mealSubTypeService.listDefinitions).mockResolvedValue([
    {
      id: "meal-subtype-main",
      name: "Main",
      slug: "MAIN",
      color: "#3B5E45",
      enabled: true,
      sortOrder: 0,
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
    },
  ] as never);
  vi.mocked(dependencies.groceryService.listGroceryLists).mockResolvedValue([
    {
      id: "grocery-1",
      name: "Weekly",
      date: null,
      favourite: false,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z",
      checkedCount: 1,
      totalItems: 2,
      completionPercentage: 50,
      items: [
        {
          id: "grocery-item-1",
          name: "Tomato",
          qty: "2",
          unit: "piece",
          category: "Produce",
          notes: null,
          meal: "Linked Dinner",
          checked: true,
          sortOrder: 0,
        },
        {
          id: "grocery-item-2",
          name: "Basil",
          qty: null,
          unit: null,
          category: "Produce",
          notes: null,
          meal: null,
          checked: false,
          sortOrder: 1,
        },
      ],
    },
  ] as never);
  vi.mocked(dependencies.prepListService.listPrepLists).mockResolvedValue([
    {
      id: "prep-1",
      name: "Sunday Prep",
      notes: null,
      date: null,
      fromDate: null,
      toDate: null,
      sourceMode: "manual",
      sourceLabel: null,
      sourceMealIds: ["meal-scheduled"],
      sourceRecipeIds: ["recipe-parent"],
      favourite: false,
      sortMode: "manual",
      groupBy: "dish",
      includeIngredients: true,
      includeTasks: true,
      includeQuantities: true,
      includeIngredientTypes: true,
      includeSourceLabels: true,
      excludePantryStaples: false,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z",
      checkedCount: 1,
      totalItems: 1,
      completionPercentage: 100,
      items: [
        {
          id: "prep-item-1",
          kind: "task",
          name: "Chop herbs",
          qty: null,
          unit: null,
          ingredientType: null,
          prepGroup: null,
          dish: "Linked Dinner",
          notes: null,
          checked: true,
          sortOrder: 0,
          sourceMealIds: ["meal-scheduled"],
          sourceRecipeIds: ["recipe-parent"],
          sourceLabels: ["Linked Dinner"],
        },
      ],
    },
  ] as never);
  vi.mocked(dependencies.preferenceService.getPreferences).mockResolvedValue({
    id: "default",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    householdSize: 2,
    cookingLength: "weeknight",
    dietaryTags: ["vegetarian"],
    favoriteCuisines: ["italian"],
    avoidCuisines: [],
    avoidIngredients: [],
    pantryStaples: ["salt"],
    planningNotes: "Keep it simple",
    nutritionTags: [],
    skillLevel: "home-cook",
    budgetRange: "moderate",
    autoGenerateGrocery: true,
    consolidateIngredients: true,
    defaultPlanLength: "7",
    groceryGrouping: "category",
    defaultRecipeView: "basic",
    defaultUnitMode: "cup",
    reasoningEffort: "secret-value",
  } as never);

  prismaMock.meal.findMany.mockResolvedValue([
    {
      id: "meal-scheduled",
      createdAt: new Date("2026-08-19T10:00:00.000Z"),
      photoPath: "meal-photos/dinner.png",
      photoMimeType: "image/png",
      photoFileName: "dinner.png",
    },
    {
      id: "meal-unscheduled",
      createdAt: new Date("2026-08-19T11:00:00.000Z"),
      photoPath: null,
      photoMimeType: null,
      photoFileName: null,
    },
  ]);
  prismaMock.recipe.findMany.mockResolvedValue(recipeRows);
  prismaMock.recipeLink.findMany.mockResolvedValue([
    { id: "link-1", parentId: "recipe-parent", subRecipeId: "recipe-sub" },
  ]);
  readPhotoMock.mockResolvedValue({
    data: Buffer.from("photo-bytes"),
    updatedAt: new Date("2026-08-19T12:00:00.000Z"),
  });
}

describe("DataManagementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureFixtures();
    writePhotoMock.mockResolvedValue({
      photoPath: "meal-photos/imported.png",
      photoMimeType: "image/png",
      photoFileName: "imported.png",
    });
    deletePhotoMock.mockResolvedValue(undefined);
  });

  it("exports a self-contained meal-plan with scheduled and unscheduled meals, links, lineage, and photos", async () => {
    const service = new DataManagementService(dependencies);
    const result = await service.exportArchive("meal-plan");
    const entries = extractDataArchive(result.archive);
    const manifest = ArchiveManifestSchema.parse(result.manifest);
    const mealPlan = DataArchivePayloadSchema.parse(
      readJson(entries, DATA_ARCHIVE_LAYOUT.domains["meal-plan"])
    );
    const recipes = DataArchivePayloadSchema.parse(
      readJson(entries, DATA_ARCHIVE_LAYOUT.domains.recipes)
    );

    expect(result.fileName).toMatch(
      /^local-recipe-book-meal-plan-\d{4}-\d{2}-\d{2}\.lrb$/
    );
    expect(manifest.assets).toHaveLength(1);
    expect(mealPlan).toMatchObject({
      domain: "meal-plan",
      meals: expect.arrayContaining([
        expect.objectContaining({
          id: "meal-scheduled",
          date: expect.any(String),
        }),
        expect.objectContaining({ id: "meal-unscheduled", date: null }),
      ]),
    });
    expect(recipes).toMatchObject({
      domain: "recipes",
      recipes: expect.arrayContaining([
        expect.objectContaining({
          id: "recipe-parent",
          sourceRecipeId: "recipe-source",
        }),
        expect.objectContaining({ id: "recipe-source" }),
        expect.objectContaining({ id: "recipe-sub" }),
      ]),
      links: [
        { id: "link-1", parentId: "recipe-parent", subRecipeId: "recipe-sub" },
      ],
    });
    expect(entries.has(manifest.assets[0].path)).toBe(true);
    expect(result.missingPhotos).toEqual([]);
  });

  it("exports all domains with typed JSON and checked grocery/prep state while excluding secrets", async () => {
    const service = new DataManagementService(dependencies);
    const result = await service.exportArchive("all");
    const entries = extractDataArchive(result.archive);
    const preferences = readJson<{
      preferences: Array<Record<string, unknown>>;
    }>(entries, DATA_ARCHIVE_LAYOUT.domains.preferences);
    const grocery = readJson<{
      lists: Array<{ items: Array<{ checked: boolean }> }>;
    }>(entries, DATA_ARCHIVE_LAYOUT.domains.grocery);
    const prep = readJson<{
      lists: Array<{ items: Array<{ checked: boolean }> }>;
    }>(entries, DATA_ARCHIVE_LAYOUT.domains["prep-lists"]);
    const mealPlan = readJson<{
      meals: Array<{ ingredients: unknown[]; instructions: string[] }>;
    }>(entries, DATA_ARCHIVE_LAYOUT.domains["meal-plan"]);

    expect(grocery.lists[0].items.map((item) => item.checked)).toEqual([
      true,
      false,
    ]);
    expect(prep.lists[0].items[0].checked).toBe(true);
    expect(mealPlan.meals[0].ingredients).toEqual([
      expect.objectContaining({ name: "Basil", quantity: "2" }),
    ]);
    expect(mealPlan.meals[0].instructions).toEqual([
      "Boil water",
      "Finish the sauce",
    ]);
    expect(preferences.preferences[0]).not.toHaveProperty("reasoningEffort");
    expect(result.manifest.domains.map((domain) => domain.domain)).toEqual([
      "meal-plan",
      "recipes",
      "grocery",
      "prep-lists",
      "preferences",
      "pantry",
    ]);
  });

  it("keeps recipe-only exports free of meal-plan domains and assets", async () => {
    const service = new DataManagementService(dependencies);
    const result = await service.exportArchive("recipes");
    const entries = extractDataArchive(result.archive);

    expect(result.manifest.domains).toEqual([
      {
        domain: "recipes",
        version: 1,
        path: DATA_ARCHIVE_LAYOUT.domains.recipes,
      },
    ]);
    expect(result.manifest.assets).toEqual([]);
    expect([...entries.keys()]).not.toContain(
      DATA_ARCHIVE_LAYOUT.domains["meal-plan"]
    );
    expect(dependencies.mealService.listAllMeals).not.toHaveBeenCalled();
  });

  it("omits a missing photo without failing the archive", async () => {
    readPhotoMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );
    const service = new DataManagementService(dependencies);
    const result = await service.exportArchive("meal-plan");
    const mealPlan = readJson<{
      meals: Array<{ id: string; photoAssetId: string | null }>;
    }>(
      extractDataArchive(result.archive),
      DATA_ARCHIVE_LAYOUT.domains["meal-plan"]
    );

    expect(result.missingPhotos).toEqual([
      { mealId: "meal-scheduled", reason: "missing-file" },
    ]);
    expect(result.manifest.assets).toEqual([]);
    expect(
      mealPlan.meals.find((meal) => meal.id === "meal-scheduled")?.photoAssetId
    ).toBeNull();
  });
});
