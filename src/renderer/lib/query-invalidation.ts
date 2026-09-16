import type { QueryClient } from "@tanstack/react-query";

const DATA_MANAGEMENT_QUERY_KEY_PREFIXES = [
  ["preferences"],
  ["meals"],
  ["meal-types"],
  ["meal-sub-types"],
  ["recipes"],
  ["recipe"],
  ["grocery-lists"],
  ["grocery-list"],
  ["prep-lists"],
  ["prep-list"],
  ["prep-generator-meals"],
  ["stats"],
  ["pantry"],
] as const;

export async function invalidateDataManagementQueries(
  queryClient: QueryClient
): Promise<void> {
  await Promise.all(
    DATA_MANAGEMENT_QUERY_KEY_PREFIXES.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, exact: false })
    )
  );
}

/**
 * Server change-event entity names mapped onto React Query key prefixes.
 * This is the single invalidation authority: both bulk sweeps and
 * event-driven invalidations resolve keys through this map.
 */
export const ENTITY_TO_QUERY_KEYS: Record<string, readonly string[]> = {
  meal: ["meals", "stats", "prep-generator-meals"],
  mealType: ["meal-types", "meals"],
  mealSubType: ["meal-sub-types"],
  recipe: ["recipes", "recipe", "stats"],
  groceryList: ["grocery-lists", "grocery-list"],
  prepList: ["prep-lists", "prep-list"],
  preference: ["preferences"],
  pantry: ["pantry", "grocery-list", "stats"],
};

/** Invalidate the query families affected by one server change event. */
export async function invalidateQueriesForEntity(
  queryClient: QueryClient,
  entity: string
): Promise<void> {
  const prefixes = ENTITY_TO_QUERY_KEYS[entity];
  if (!prefixes) return;

  await Promise.all(
    prefixes.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [queryKey], exact: false })
    )
  );
}