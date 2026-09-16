import { Hono } from "hono";
import { z } from "zod";

import { ApiPaths } from "@shared/api/types";
import {
  ArchiveImportRequestSchema,
  ExportScopeSchema,
} from "@shared/schemas/data-management-schemas";

import { DEFAULT_DATA_ARCHIVE_LIMITS } from "../lib/data-archive.js";
import {
  DataManagementApplyError,
  DataManagementValidationError,
} from "../services/data-management-service.js";
import { dataManagementService } from "../services.js";

export const dataManagementRoutes = new Hono();

const MAX_BASE64_ARCHIVE_LENGTH = Math.ceil(
  DEFAULT_DATA_ARCHIVE_LIMITS.maxArchiveBytes * 4 / 3
) + 16;

const archiveBodySchema = z.object({
  archive: z
    .string()
    .trim()
    .min(1, "Archive payload is required")
    .max(MAX_BASE64_ARCHIVE_LENGTH, "Archive payload is too large"),
});

function decodeArchive(value: string) {
  if (
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new DataManagementValidationError([
      {
        code: "INVALID_ARCHIVE",
        message: "Archive payload must be valid base64.",
        path: ["archive"],
      },
    ]);
  }

  const archive = Buffer.from(value, "base64");
  if (archive.byteLength > DEFAULT_DATA_ARCHIVE_LIMITS.maxArchiveBytes) {
    throw new DataManagementValidationError([
      {
        code: "ARCHIVE_TOO_LARGE",
        message: "Archive exceeds the supported size limit.",
        path: ["archive"],
      },
    ]);
  }
  return archive;
}

function structuredError(error: unknown) {
  if (error instanceof z.ZodError) {
    return {
      status: 400 as const,
      body: {
        error: "Invalid data archive request.",
        code: "DATA_ARCHIVE_INVALID_REQUEST",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
    };
  }

  if (error instanceof DataManagementValidationError) {
    return {
      status: 422 as const,
      body: {
        error: error.message,
        code: error.code,
        details: error.errors,
      },
    };
  }

  if (error instanceof DataManagementApplyError) {
    return {
      status: error.code === "DATA_ARCHIVE_CONFLICT_DECISIONS_REQUIRED" ? 409 as const : 400 as const,
      body: { error: error.message, code: error.code },
    };
  }

  return {
    status: 400 as const,
    body: {
      error: error instanceof Error ? error.message : "Unable to process data archive",
      code: "DATA_ARCHIVE_IMPORT_FAILED",
    },
  };
}

dataManagementRoutes.get(
  ApiPaths.dataManagementExport.replace("/api", ""),
  async (c) => {
    const scopeResult = ExportScopeSchema.safeParse(c.req.query("scope"));
    if (!scopeResult.success) {
      return c.json(
        {
          error: "Export scope must be one of meal-plan, recipes, or all",
          code: "DATA_ARCHIVE_INVALID_SCOPE",
        },
        400
      );
    }

    const history = c.req.query("history");
    if (history !== undefined && history !== "state" && history !== "full") {
      return c.json(
        { error: "History must be state or full", code: "DATA_ARCHIVE_INVALID_HISTORY" },
        400
      );
    }

    try {
      const result = history === "full"
        ? await dataManagementService.exportArchive(scopeResult.data, true)
        : await dataManagementService.exportArchive(scopeResult.data);
      return c.body(result.archive, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to export data",
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "DATA_ARCHIVE_EXPORT_FAILED",
        },
        500
      );
    }
  }
);

dataManagementRoutes.post(
  ApiPaths.dataManagementValidate.replace("/api", ""),
  async (c) => {
    try {
      const body = archiveBodySchema.parse(await c.req.json());
      const data = await dataManagementService.validateArchive(
        decodeArchive(body.archive)
      );
      return c.json({ data });
    } catch (error) {
      const result = structuredError(error);
      return c.json(result.body, result.status);
    }
  }
);

dataManagementRoutes.post(
  ApiPaths.dataManagementPreview.replace("/api", ""),
  async (c) => {
    try {
      const body = archiveBodySchema.parse(await c.req.json());
      const data = await dataManagementService.previewImport(
        decodeArchive(body.archive)
      );
      return c.json({ data });
    } catch (error) {
      const result = structuredError(error);
      return c.json(result.body, result.status);
    }
  }
);

dataManagementRoutes.post(
  ApiPaths.dataManagementApply.replace("/api", ""),
  async (c) => {
    try {
      const body = await c.req.json();
      const archiveBody = archiveBodySchema.parse(body);
      const { archive: _archive, ...requestBody } = body as Record<string, unknown>;
      const parsed = ArchiveImportRequestSchema.parse(requestBody);
      const data = await dataManagementService.applyImport(
        decodeArchive(archiveBody.archive),
        parsed
      );
      return c.json({ data });
    } catch (error) {
      const result = structuredError(error);
      return c.json(result.body, result.status);
    }
  }
);
