import { Suspense, lazy } from "react";
import { createBrowserRouter, createHashRouter } from "react-router";

import { AuthenticatedAppLayout, PublicBrowserLayout } from "./app";
import { RouteErrorBoundary } from "./components/layout/route-error-boundary";
import { getPlatform } from "./lib/platform";
import { importMealPlanRoute } from "./lib/meal-plan-route";

const HomePage = lazy(() => import("./pages/home"));
const MealPlanPage = lazy(importMealPlanRoute);
const GroceryListPage = lazy(() => import("./pages/grocery-list"));
const ShoppingPage = lazy(() => import("./pages/grocery-list/shop"));
const PrepListsPage = lazy(() => import("./pages/prep-lists"));
const PrepViewPage = lazy(() => import("./pages/prep-lists/prep"));
const RecipesPage = lazy(() => import("./pages/recipes"));
const RecipeDetailPage = lazy(() => import("./pages/recipes/detail"));
const StatsPage = lazy(() => import("./pages/stats"));
const PantryPage = lazy(() => import("./pages/pantry"));
const SettingsPage = lazy(() => import("./pages/settings"));
const ConnectPage = lazy(() => import("./pages/connect"));

function MealPlanRouteFallback() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="space-y-2">
        <div className="h-8 w-48 rounded bg-muted animate-pulse" />
        <div className="h-4 w-64 rounded bg-muted animate-pulse" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-7 gap-2 mb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-muted animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 gap-2 mb-2">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="h-16 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function withRouteFallback(element: React.ReactNode, fallback?: React.ReactNode) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className="p-4 md:p-6">
            <p className="text-sm text-text-muted">Loading page...</p>
          </div>
        )
      }
    >
      {element}
    </Suspense>
  );
}

const authenticatedRoutes = [
  {
    path: "/",
    element: <AuthenticatedAppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: withRouteFallback(<HomePage />) },
      {
        path: "meal-plan",
        element: withRouteFallback(<MealPlanPage />, <MealPlanRouteFallback />),
      },
      {
        path: "grocery-list",
        element: withRouteFallback(<GroceryListPage />),
      },
      {
        path: "grocery-list/shop/:id",
        element: withRouteFallback(<ShoppingPage />),
      },
      {
        path: "prep-lists",
        element: withRouteFallback(<PrepListsPage />),
      },
      {
        path: "prep-lists/prep/:id",
        element: withRouteFallback(<PrepViewPage />),
      },
      { path: "recipes", element: withRouteFallback(<RecipesPage />) },
      {
        path: "recipes/:recipeId",
        element: withRouteFallback(<RecipeDetailPage />),
      },
      { path: "stats", element: withRouteFallback(<StatsPage />) },
      { path: "pantry", element: withRouteFallback(<PantryPage />) },
      { path: "settings", element: withRouteFallback(<SettingsPage />) },
    ],
  },
];

const browserRoutes = [
  {
    path: "/connect",
    element: <PublicBrowserLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [{ index: true, element: withRouteFallback(<ConnectPage />) }],
  },
  ...authenticatedRoutes,
];

export const router =
  getPlatform().runtime === "electron"
    ? createHashRouter(authenticatedRoutes)
    : createBrowserRouter(browserRoutes);
