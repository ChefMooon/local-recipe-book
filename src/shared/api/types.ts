/** Canonical API path constants for all route groups. */
export const ApiPaths = {
  health: "/api/health",

  // Meals
  meals: "/api/meals",
  meal: (id: string) => `/api/meals/${id}`,
  mealsHeatmap: "/api/meals/heatmap",
  menuExport: "/api/menu-export",
  dataManagementExport: "/api/data-management/export",
  dataManagementValidate: "/api/data-management/import/validate",
  dataManagementPreview: "/api/data-management/import/preview",
  dataManagementApply: "/api/data-management/import/apply",

  // Grocery lists
  groceryLists: "/api/grocery-lists",
  groceryList: (id: string) => `/api/grocery-lists/${id}`,
  groceryListItems: (listId: string) => `/api/grocery-lists/${listId}/items`,
  groceryListItem: (listId: string, itemId: string) =>
    `/api/grocery-lists/${listId}/items/${itemId}`,
  groceryListReorder: (listId: string) =>
    `/api/grocery-lists/${listId}/reorder`,
  groceryListPantryReview: (listId: string) =>
    `/api/grocery-lists/${listId}/pantry-review`,

  // Pantry
  pantry: "/api/pantry",
  pantrySummary: "/api/pantry/summary",
  pantryItem: (id: string) => `/api/pantry/${id}`,
  pantryItemStock: (id: string) => `/api/pantry/${id}/stock`,
  pantryItemPackageStock: (id: string) => `/api/pantry/${id}/package-stock`,
  pantryItemLots: (id: string) => `/api/pantry/${id}/lots`,
  pantryItemLot: (id: string, lotId: string) => `/api/pantry/${id}/lots/${lotId}`,
  pantryItemPackages: (id: string) => `/api/pantry/${id}/packages`,
  pantryItemWarnings: (id: string) => `/api/pantry/${id}/warnings`,
  pantryItemEvents: (id: string) => `/api/pantry/${id}/events`,
  pantryItemAttention: (id: string) => `/api/pantry/${id}/attention`,
  pantryItemAttentionInspection: (id: string) => `/api/pantry/${id}/attention/inspection`,
  pantryItemGroceryLink: (id: string) => `/api/pantry/${id}/grocery-link`,
  pantryItemGroceryLinkLifecycle: (id: string) => `/api/pantry/${id}/grocery-link/lifecycle`,

  // Prep lists
  prepLists: "/api/prep-lists",
  prepListGenerate: "/api/prep-lists/generate",
  prepList: (id: string) => `/api/prep-lists/${id}`,
  prepListItems: (listId: string) => `/api/prep-lists/${listId}/items`,
  prepListItem: (listId: string, itemId: string) =>
    `/api/prep-lists/${listId}/items/${itemId}`,
  prepListReorder: (listId: string) => `/api/prep-lists/${listId}/reorder`,

  // Recipes
  recipes: "/api/recipes",
  recipe: (id: string) => `/api/recipes/${id}`,
  recipeMadeHistory: (id: string) => `/api/recipes/${id}/made-history`,
  recipeDuplicate: (id: string) => `/api/recipes/${id}/duplicate`,
  recipeRating: (id: string) => `/api/recipes/${id}/rating`,
  recipeIngest: "/api/recipes/ingest",
  recipeIngestConfirm: "/api/recipes/ingest/confirm",
  recipeExport: "/api/recipes/export",
  recipeImport: "/api/recipes/import",

  // Preferences
  preferences: "/api/preferences",
  preferencesReset: "/api/preferences/reset",
  preferencesDetectRegion: "/api/preferences/detect-region",
  preferencesExport: "/api/preferences/export",

  // Stats
  stats: "/api/stats",
  statsMealSummary: "/api/stats/meal-summary",
} as const;
