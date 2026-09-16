/**
 * Shared API payload types used by both the server and the renderer.
 * These are the shapes returned by / sent to the HTTP API.
 */

// ── Preferences ──────────────────────────────────────────────
export type PreferencesPayload = {
  id: string;
  createdAt: string;
  updatedAt: string;
  householdSize: number;
  cookingLength: string;
  dietaryTags: string[];
  favoriteCuisines: string[];
  avoidCuisines: string[];
  avoidIngredients: string[];
  pantryStaples: string[];
  planningNotes: string;
  nutritionTags: string[];
  skillLevel: string;
  budgetRange: string;
  autoGenerateGrocery: boolean;
  consolidateIngredients: boolean;
  autoReviewPantry: boolean;
  defaultPlanLength: string;
  groceryGrouping: string;
  defaultRecipeView: string;
  defaultUnitMode: string;
};

export type PreferenceUpdateInput = Partial<
  Omit<PreferencesPayload, "id" | "createdAt" | "updatedAt">
>;

export type MealTypeDefinitionPayload = {
  id: string;
  profileId: string;
  name: string;
  slug: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  cutoffTime?: string;
  createdAt: string;
  updatedAt: string;
};

export type MealSubTypeDefinitionPayload = {
  id: string;
  name: string;
  slug: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type MealTypeProfilePayload = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isDefault: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  mealTypes: MealTypeDefinitionPayload[];
};

export type CreateMealTypeProfileInput = {
  name: string;
  color: string;
  description?: string | null;
  priority?: number;
  startDate?: string | null;
  endDate?: string | null;
};

export type UpdateMealTypeProfileInput = Partial<CreateMealTypeProfileInput>;

export type CreateMealTypeDefinitionInput = {
  name: string;
  color: string;
  enabled?: boolean;
  cutoffTime?: string;
};

export type UpdateMealTypeDefinitionInput = Partial<CreateMealTypeDefinitionInput>;

export type CreateMealSubTypeDefinitionInput = {
  name: string;
  color: string;
  enabled?: boolean;
};

export type UpdateMealSubTypeDefinitionInput =
  Partial<CreateMealSubTypeDefinitionInput>;

export type MealIngredient = {
  name: string;
  quantity: string | null;
  unit: string | null;
  group: string | null;
  notes: string | null;
  order: number;
};

export type MealPayload = {
  id: string;
  name: string;
  date: string | null;
  mealType: string;
  sortOrder: number;
  mealTypeDefinitionId: string | null;
  mealTypeDefinition: MealTypeDefinitionPayload | null;
  mealSubTypeDefinitionId?: string | null;
  mealSubTypeDefinition?: MealSubTypeDefinitionPayload | null;
  notes: string | null;
  ingredients: MealIngredient[];
  description: string | null;
  cuisine: string | null;
  instructions: string[];
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  servingsOverride: number | null;
  recipeId: string | null;
  photoUrl?: string | null;
  photoDataUrl?: string | null;
  photoMimeType?: string | null;
  photoFileName?: string | null;
  linkedRecipe: {
    id: string;
    title: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    cuisine: string | null;
    instructions: string[];
    cookNotes: string | null;
    ingredients: MealIngredient[];
  } | null;
  passedCutoff?: boolean;
};

export type PrepListSourceMode =
  | "manual"
  | "single-meal"
  | "meal-slot"
  | "day"
  | "week"
  | "month"
  | "date-range"
  | "historical";

export type PrepItemKind = "ingredient" | "task";
export type PrepListSortMode =
  | "manual"
  | "name"
  | "dish"
  | "type"
  | "kind"
  | "checked";
export type PrepListGroupBy = "dish" | "type" | "prepGroup" | "kind" | "none";

export type PrepItemPayload = {
  id: string;
  kind: PrepItemKind;
  name: string;
  qty: string | null;
  unit: string | null;
  ingredientType: string | null;
  prepGroup: string | null;
  dish: string | null;
  notes: string | null;
  checked: boolean;
  sortOrder: number;
  sourceMealIds: string[];
  sourceRecipeIds: string[];
  sourceLabels: string[];
};

export type PrepListPayload = {
  id: string;
  name: string;
  notes: string | null;
  date: string | null;
  fromDate: string | null;
  toDate: string | null;
  sourceMode: PrepListSourceMode;
  sourceLabel: string | null;
  sourceMealIds: string[];
  sourceRecipeIds: string[];
  favourite: boolean;
  sortMode: PrepListSortMode;
  groupBy: PrepListGroupBy;
  includeIngredients: boolean;
  includeTasks: boolean;
  includeQuantities: boolean;
  includeIngredientTypes: boolean;
  includeSourceLabels: boolean;
  excludePantryStaples: boolean;
  createdAt: string;
  updatedAt: string;
  checkedCount: number;
  totalItems: number;
  completionPercentage: number;
  items: PrepItemPayload[];
};

export type PrepListGenerateInput = {
  name?: string;
  notes?: string | null;
  sourceMode: Exclude<PrepListSourceMode, "manual">;
  mealIds?: string[];
  mealType?: string;
  fromDate?: string | null;
  toDate?: string | null;
  date?: string | null;
  favourite?: boolean;
  sortMode?: PrepListSortMode;
  groupBy?: PrepListGroupBy;
  includeIngredients?: boolean;
  includeTasks?: boolean;
  includeQuantities?: boolean;
  includeIngredientTypes?: boolean;
  includeSourceLabels?: boolean;
  excludePantryStaples?: boolean;
};

export type RecipeMadeEntryPayload = {
  mealId: string;
  mealName: string;
  date: string;
  mealType: string;
  notes: string | null;
  photoUrl: string | null;
  photoDataUrl: string | null;
  photoMimeType: string | null;
  photoFileName: string | null;
};

export type RecipeMadeHistoryPayload = {
  recipeId: string;
  madeCount: number;
  lastMadeAt: string | null;
  entries: RecipeMadeEntryPayload[];
};

// -- Pantry --------------------------------------------------
export type PantryAliasPayload = {
  id: string;
  label: string;
  normalizedAlias: string;
};

export type PantryLotPayload = {
  id: string;
  quantity: number;
  unit: string | null;
  approximate: boolean;
  bestBeforeAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PantryLocationPayload = {
  id: string;
  location: string;
  normalizedLocation: string;
  quantity: number | null;
  unit: string | null;
  approximate: boolean;
  createdAt: string;
  updatedAt: string;
  lots: PantryLotPayload[];
};

export type PantryPackagePayload = {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  dimension: string;
  confirmed: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PantryWarningRulePayload = {
  id: string;
  threshold: number;
  unit: string | null;
  severity: "info" | "warning" | "critical";
  message: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PantryInventoryEventPayload = {
  id: string;
  type: string;
  quantityDelta: number | null;
  quantity: number | null;
  unit: string | null;
  approximate: boolean;
  sourceType: string | null;
  sourceId: string | null;
  sourceIdentity: string | null;
  occurredAt: string;
  importedAt: string | null;
};

export type PantryForecastPayload = {
  state: "disabled" | "available" | "unavailable";
  reason: "missing-daily-usage" | "missing-stock" | "approximate-stock" | "incompatible-unit" | "expired-stock" | null;
  severity: "info" | "warning" | "critical";
  attention: boolean;
  remainingQuantity: number | null;
  remainingUnit: string | null;
  remainingDays: number | null;
  projectedRunOutAt: string | null;
  estimate: { isEstimate: true; source: "location-quantity"; evaluatedAt: string };
};

export type PantryItemPayload = {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  stockMode: string;
  warningThreshold: number | null;
  warningUnit: string | null;
  expirationWarningDays: number | null;
  replenishmentTarget: number | null;
  replenishmentUnit: string | null;
  replenishmentQuantity: number | null;
  dailyUsageQuantity: number | null;
  dailyUsageUnit: string | null;
  dailyUsageWarningDays: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: PantryAliasPayload[];
  locations: PantryLocationPayload[];
  packages: PantryPackagePayload[];
  warningRules: PantryWarningRulePayload[];
  events?: PantryInventoryEventPayload[];
  status: "ok" | "low" | "empty" | "expiring-soon" | "expired";
  usableQuantity: number | null;
  forecast: PantryForecastPayload;
};

export type PantrySummaryPayload = {
  trackedItems: number;
  lowStock: number;
  empty: number;
  expiringSoon: number;
  expired: number;
  forecastAttention: number;
};

// ── Recipes ──────────────────────────────────────────────────
export type RecipeIngredientPayload = {
  id: string;
  name: string;
  quantity: number | null;
  quantityNumerator: number | null;
  quantityDenominator: number | null;
  unit: string | null;
  group: string | null;
  notes: string | null;
  parseConfidence: string | null;
  parseRaw: string | null;
  order: number;
};

export type RecipeLinkSummary = {
  id: string;
  title: string;
};

export type RecipeIterationPayload = {
  id: string;
  title: string;
  parentId: string;
  depth: number;
};

export type RecipePayload = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  difficulty: string | null;
  cuisine: string | null;
  instructions: string[];
  sourceUrl: string | null;
  sourceLabel: string | null;
  origin: string;
  favourite: boolean;
  rating: number | null;
  cookNotes: string | null;
  lastMadeAt: string | null;
  sourceRecipeId?: string | null;
  sourceRecipe?: RecipeLinkSummary | null;
  ingredients: RecipeIngredientPayload[];
  tags: string[];
  linkedSubRecipes: RecipeLinkSummary[];
};

export type {
  CreateRecipeInput,
  IngestResult,
  IngestProgressEvent,
  RecipeConflict,
  RecipeExportJson,
} from "./schemas/recipe-schemas";

export type {
  MenuExportFormat,
  MenuExportRequest,
  MenuLayout,
} from "./schemas/menu-export-schemas";
