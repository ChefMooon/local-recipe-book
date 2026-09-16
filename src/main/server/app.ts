import { Hono, type Context } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { z } from "zod";
import type { ServerConfig } from "@shared/config/server-config";
import { createApiErrorEnvelope, formatZodIssues } from "@shared/api/errors";

import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { mealsRoutes } from "./routes/meals.js";
import { menuExportRoutes } from "./routes/menu-export.js";
import { mealTypesRoutes } from "./routes/meal-types.js";
import { mealSubTypesRoutes } from "./routes/meal-sub-types.js";
import { groceryListsRoutes } from "./routes/grocery-lists.js";
import { prepListsRoutes } from "./routes/prep-lists.js";
import { recipesRoutes } from "./routes/recipes.js";
import { preferencesRoutes } from "./routes/preferences.js";
import { statsRoutes } from "./routes/stats.js";
import { dataManagementRoutes } from "./routes/data-management.js";
import { pairingRoutes } from "./routes/pairing.js";
import { syncRoutes } from "./routes/sync.js";
import { pantryRoutes } from "./routes/pantry.js";

function getRequestId(c: Context): string | undefined {
  return (
    c.req.header("x-request-id") ?? c.req.header("request-id") ?? undefined
  );
}

function sendApiError(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: { path?: string; message: string; code?: string }[]
) {
  return c.json(
    createApiErrorEnvelope({
      code,
      message,
      requestId: getRequestId(c),
      details,
    }),
    status
  );
}

function logRequest(message: string, ...details: string[]): void {
  if (message.includes("/api/health")) return;
  console.log(message, ...details);
}

export function createApp(config: ServerConfig) {
  const app = new Hono();

  // Request logger
  // Default Hono logger emits method/path/status/duration only — no Authorization headers logged.
  app.use("*", logger(logRequest));

  // CORS
  app.use(
    "*",
    cors({
      origin: config.cors.origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "x-request-id",
        "x-machine-caller-id",
        "x-machine-source",
      ],
      exposeHeaders: ["x-request-id"],
      maxAge: 86400,
    })
  );

  // Auth middleware (health endpoint bypassed inside the middleware)
  app.use("/api/*", createAuthMiddleware(config));

  // Rate limiter — active in LAN mode (host bound to 0.0.0.0) to protect against untrusted clients
  if (config.server.host !== "127.0.0.1") {
    app.use("/api/*", createRateLimitMiddleware());
  }

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return sendApiError(
        c,
        400,
        "VALIDATION_ERROR",
        "Request validation failed",
        formatZodIssues(err)
      );
    }

    const status =
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      typeof err.status === "number"
        ? err.status
        : 500;

    const code =
      status === 401
        ? "UNAUTHORIZED"
        : status === 404
          ? "NOT_FOUND"
          : status === 409
            ? "CONFLICT"
            : status === 429
              ? "RATE_LIMITED"
              : "INTERNAL_ERROR";

    const message =
      status === 500 || !err || !(err instanceof Error)
        ? "Internal server error"
        : err.message;

    console.error("[server] unhandled error", err);
    return sendApiError(c, status, code, message);
  });

  app.notFound((c) => sendApiError(c, 404, "NOT_FOUND", "Endpoint not found"));

  // Routes
  app.route("/api", healthRoutes);
  app.route("/api", mealsRoutes);
  app.route("/api", menuExportRoutes);
  app.route("/api", mealTypesRoutes);
  app.route("/api", mealSubTypesRoutes);
  app.route("/api", groceryListsRoutes);
  app.route("/api", prepListsRoutes);
  app.route("/api", recipesRoutes);
  app.route("/api", preferencesRoutes);
  app.route("/api", statsRoutes);
  app.route("/api", dataManagementRoutes);
  app.route("/api", pairingRoutes);
  app.route("/api", syncRoutes);
  app.route("/api", pantryRoutes);

  return app;
}
