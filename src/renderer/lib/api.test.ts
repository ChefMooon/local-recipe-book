// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { setCachedConfigForTests } from "./config";
import {
  applyDataArchive,
  exportDataArchive,
  ingestRecipe,
  previewDataArchive,
  validateDataArchive,
} from "./api";

describe("ingestRecipe SSE client", () => {
  beforeEach(() => {
    setCachedConfigForTests({
      mode: "remote",
      token: "test-token",
      url: "http://localhost:4173",
    });
  });

  it("processes a terminal result when EOF omits the final blank-line delimiter", async () => {
    const result = {
      duplicate: true as const,
      existing: {
        id: "recipe-1",
        title: "Macaroni Salad",
        description: null,
        servings: 4,
        prepTime: null,
        cookTime: null,
        difficulty: null,
        cuisine: null,
        instructions: ["Mix ingredients."],
        sourceUrl: "https://example.com/macaroni-salad/",
        sourceLabel: null,
        origin: "imported" as const,
        favourite: false,
        rating: null,
        cookNotes: null,
        lastMadeAt: null,
        tags: [],
        ingredients: [],
      },
    };
    const frame = `data: ${JSON.stringify({ type: "result", data: result })}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );

    await expect(ingestRecipe("https://example.com/recipe")).resolves.toEqual(result);
  });

  it("accepts the legacy JSON envelope while an older server is still running", async () => {
    const result = {
      duplicate: false as const,
      recipe: {
        title: "Macaroni Salad",
        instructions: ["Mix ingredients."],
        ingredients: [],
        sourceUrl: "https://example.com/macaroni-salad/",
        sourceLabel: "example.com",
        origin: "imported" as const,
        linkedSubRecipes: [],
        tags: [],
      },
      flaggedIngredients: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(ingestRecipe("https://example.com/recipe")).resolves.toEqual(result);
  });
});

describe("data management archive API", () => {
  beforeEach(() => {
    setCachedConfigForTests({
      mode: "remote",
      token: "test-token",
      url: "http://localhost:4173",
    });
  });

  it("returns archive bytes with stable filename and content metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition":
            'attachment; filename="local-recipe-book-recipes-2026-08-19.lrb"',
          "Content-Length": "4",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exportDataArchive("recipes");

    expect(result.fileName).toBe(
      "local-recipe-book-recipes-2026-08-19.lrb"
    );
    expect(result.contentType).toBe("application/zip");
    expect(result.contentLength).toBe(4);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 3, 4])
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4173/api/data-management/export?scope=recipes&history=state",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
  });

  it("encodes archive bytes for validation and preserves structured API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { valid: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: "Archive is invalid.",
            code: "DATA_ARCHIVE_VALIDATION_FAILED",
            details: [{ path: "manifest.json", message: "Invalid manifest" }],
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateDataArchive(new Uint8Array([0, 255, 1]))).resolves.toEqual({
      valid: true,
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ archive: "AP8B" });

    await expect(previewDataArchive(new Blob(["archive"]))).rejects.toMatchObject({
      status: 422,
      code: "DATA_ARCHIVE_VALIDATION_FAILED",
      data: expect.objectContaining({ ok: false }),
    });
  });

  it("sends explicit apply decisions and returns the import summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            summary: {
              mode: "merge",
              imported: 1,
              skipped: 2,
              replaced: 0,
              unresolved: 0,
              conflicts: 1,
              assets: { imported: 0, skipped: 0, failed: 0 },
              preferencesRestored: false,
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      applyDataArchive(new Uint8Array([1, 2]), {
        mode: "merge",
        bulkDecision: "keep-local",
        decisions: [
          { conflictId: "recipe:recipe-1", decision: "import" },
        ],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ imported: 1 }),
      })
    );

    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(request).toEqual(
      expect.objectContaining({
        archive: "AQI=",
        mode: "merge",
        bulkDecision: "keep-local",
      })
    );
  });
});
