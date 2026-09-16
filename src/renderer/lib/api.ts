import {
  type CreateMealTypeDefinitionInput,
  type CreateMealTypeProfileInput,
  type CreateRecipeInput,
  type IngestResult,
  type IngestProgressEvent,
  type MealIngredient,
  type MealPayload,
  type MealTypeDefinitionPayload,
  type MealSubTypeDefinitionPayload,
  type MealTypeProfilePayload,
  type MenuExportFormat,
  type MenuLayout,
  type RecipeConflict,
  type RecipeExportJson,
  type RecipeMadeHistoryPayload,
  type RecipeIterationPayload,
  type PreferenceUpdateInput,
  type PreferencesPayload,
  type RecipePayload,
  type UpdateMealTypeDefinitionInput,
  type UpdateMealSubTypeDefinitionInput,
  type UpdateMealTypeProfileInput,
  type CreateMealSubTypeDefinitionInput,
} from "@shared/types";
import {
  MEAL_SUB_TYPE_API_PATHS,
  MEAL_TYPE_API_PATHS,
  type RecipeSearchSortModeValue,
  type RecipeSortByValue,
  type RecipeSortOrderValue,
} from "@shared/api/constants";
import { ApiPaths } from "@shared/api/types";
import type {
  ArchiveIdMap,
  ArchivePreviewResult,
  ArchiveValidationResult,
  ConflictBulkDecision,
  ConflictDecision,
  ExportScope,
  ImportMode,
  ImportSummary,
} from "@shared/schemas/data-management-schemas";

import {
  ConfigNotReadyError,
  assertServerConfigReady,
  getCachedConfig,
  resetConfigCache,
} from "./config";
import { getPlatform, markBrowserConnectionStale } from "./platform";

export type SettingsPreferences = PreferencesPayload;
export type { MealTypeDefinitionPayload, MealTypeProfilePayload };
export type { MealSubTypeDefinitionPayload };
export type { RecipeMadeHistoryPayload };
export type { RecipeIterationPayload };
export type { RecipePayload };

export type RecipeListFilters = {
  query?: string;
  origin?: string;
  cuisine?: string;
  favourite?: boolean;
  sortBy?: RecipeSortByValue;
  sortOrder?: RecipeSortOrderValue;
  searchSortMode?: RecipeSearchSortModeValue;
};

export type DetectedRegionPayload = {
  region: string | null;
  label?: string;
  error?: string;
};

type ApiErrorBody = {
  ok?: false;
  error?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  reason?: string;
  existing?: unknown;
};

export class ApiError<T = unknown> extends Error {
  status: number;
  code?: string;
  data?: T;

  constructor(message: string, status: number, code?: string, data?: T) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function isApiError<T = unknown>(error: unknown): error is ApiError<T> {
  return error instanceof ApiError;
}

export function isRateLimitedApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429;
}

export function isRecipeConflictError(
  error: unknown
): error is ApiError<RecipeConflict> {
  return (
    error instanceof ApiError &&
    (error.code === "RECIPE_DUPLICATE_TITLE" ||
      error.code === "RECIPE_DUPLICATE_SOURCE_URL")
  );
}
function getApiBase(): string {
  const config = getCachedConfig();
  assertServerConfigReady(config, "Cannot call API before server configuration is ready.");
  const baseUrl = config.url.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ConfigNotReadyError("API base URL is missing.");
  }
  return baseUrl;
}

function getAuthHeaders(): Record<string, string> {
  const config = getCachedConfig();
  const token = config?.token?.trim() ?? "";
  if (!token) return {};
  return { "Authorization": `Bearer ${token}` };
}

function handleRejectedBrowserToken(): void {
  if (getPlatform().runtime !== "browser") return;

  markBrowserConnectionStale(
    "The saved token was rejected. Scan the current QR code or paste a new connection link from the desktop app."
  );
  resetConfigCache();

  if (!window.location.pathname.startsWith("/connect")) {
    window.location.replace("/connect");
  }
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let payload: ApiErrorBody | undefined;

    if (response.status === 401) {
      handleRejectedBrowserToken();
    }

    try {
      payload = (await response.json()) as ApiErrorBody;
    } catch {
      payload = undefined;
    }

    throw new ApiError(
      payload?.error ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.code,
      payload as T
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchBlob(pathOrUrl: string): Promise<Blob> {
  return (await fetchBinary(pathOrUrl)).blob;
}

type BinaryResponse = {
  blob: Blob;
  fileName: string | null;
  contentType: string | null;
  contentLength: number | null;
};

function getFileNameFromDisposition(value: string | null): string | null {
  if (!value) return null;

  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim());
    } catch {
      return encodedMatch[1].trim();
    }
  }

  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || null;
}

async function fetchBinary(pathOrUrl: string): Promise<BinaryResponse> {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${getApiBase()}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...getAuthHeaders(),
    },
  });

  if (!response.ok) {
    let payload: ApiErrorBody | undefined;

    if (response.status === 401) {
      handleRejectedBrowserToken();
    }

    try {
      payload = (await response.json()) as ApiErrorBody;
    } catch {
      payload = undefined;
    }

    throw new ApiError(
      payload?.error ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.code,
      payload
    );
  }

  const blob = await response.blob();
  const contentLength = response.headers.get("content-length");
  return {
    blob,
    fileName: getFileNameFromDisposition(
      response.headers.get("content-disposition")
    ),
    contentType: response.headers.get("content-type"),
    contentLength: contentLength ? Number(contentLength) || null : null,
  };
}

export type DataArchiveBinary = Blob | ArrayBuffer | Uint8Array;

export type DataArchiveDownload = {
  blob: Blob;
  fileName: string;
  contentType: string;
  contentLength: number | null;
};

export type DataArchiveApplyInput = {
  mode: ImportMode;
  idMap?: ArchiveIdMap;
  restorePreferences?: boolean;
  decisions?: ConflictDecision[];
  bulkDecision?: ConflictBulkDecision;
};

export type DataArchiveApplyResult = {
  summary: ImportSummary;
  backupPath?: string;
};

async function archiveToBase64(archive: DataArchiveBinary): Promise<string> {
  const bytes =
    archive instanceof Blob
      ? new Uint8Array(await archive.arrayBuffer())
      : archive instanceof ArrayBuffer
        ? new Uint8Array(archive)
        : archive;
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    );
  }
  return btoa(binary);
}

export async function exportDataArchive(
  scope: ExportScope,
  history: "state" | "full" = "state"
): Promise<DataArchiveDownload> {
  const response = await fetchBinary(
    `${ApiPaths.dataManagementExport}?scope=${encodeURIComponent(scope)}&history=${history}`
  );
  return {
    blob: response.blob,
    fileName: response.fileName ?? `local-recipe-book-${scope}.lrb`,
    contentType: response.contentType ?? "application/zip",
    contentLength: response.contentLength ?? response.blob.size,
  };
}

export async function validateDataArchive(archive: DataArchiveBinary) {
  const response = await fetchJson<{ data: ArchiveValidationResult }>(
    ApiPaths.dataManagementValidate,
    {
      method: "POST",
      body: JSON.stringify({ archive: await archiveToBase64(archive) }),
    }
  );
  return response.data;
}

export async function previewDataArchive(archive: DataArchiveBinary) {
  const response = await fetchJson<{ data: ArchivePreviewResult }>(
    ApiPaths.dataManagementPreview,
    {
      method: "POST",
      body: JSON.stringify({ archive: await archiveToBase64(archive) }),
    }
  );
  return response.data;
}

export async function applyDataArchive(
  archive: DataArchiveBinary,
  input: DataArchiveApplyInput
) {
  const response = await fetchJson<{ data: DataArchiveApplyResult }>(
    ApiPaths.dataManagementApply,
    {
      method: "POST",
      body: JSON.stringify({
        archive: await archiveToBase64(archive),
        ...input,
      }),
    }
  );
  return response.data;
}

export type CreateMealInput = {
  name: string;
  date?: string | null;
  mealType: string;
  sortOrder?: number;
  mealTypeDefinitionId?: string | null;
  mealSubTypeDefinitionId?: string | null;
  notes?: string | null;
  ingredients?: MealIngredient[];
  description?: string | null;
  cuisine?: string | null;
  instructions?: string[];
  servings?: number;
  prepTime?: number | null;
  cookTime?: number | null;
  servingsOverride?: number | null;
  recipeId?: string | null;
  photoDataUrl?: string | null;
  photoFileName?: string | null;
};

export async function createMeal(input: CreateMealInput) {
  const response = await fetchJson<{ data: { id: string } & Record<string, unknown> }>(
    "/api/meals",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );

  return response.data;
}

export async function listUnscheduledMeals() {
  const response = await fetchJson<{ data: MealPayload[] }>(
    "/api/meals/unscheduled"
  );

  return response.data;
}

export async function reorderUnscheduledMeals(orderedIds: string[]) {
  const response = await fetchJson<{
    data: { updated: number; meals: MealPayload[] };
  }>("/api/meals/unscheduled/reorder", {
    method: "PATCH",
    body: JSON.stringify({ orderedIds }),
  });

  return response.data;
}

export async function reorderSlotMeals(
  date: string,
  mealType: string,
  orderedIds: string[]
) {
  const response = await fetchJson<{
    data: { updated: number; meals: Array<{ id: string }> };
  }>("/api/meals/reorder", {
    method: "PATCH",
    body: JSON.stringify({ date, mealType, orderedIds }),
  });

  return response.data;
}

export type SlotBatchActionInput = {
  action: "move" | "swap";
  source: {
    date: string;
    mealType: string;
    mealTypeDefinitionId?: string | null;
  };
  target: {
    date: string;
    mealType: string;
    mealTypeDefinitionId?: string | null;
  };
};

export async function applySlotBatchAction(input: SlotBatchActionInput) {
  const response = await fetchJson<{
    data: {
      action: "move" | "swap";
      sourceCount: number;
      targetCount: number;
      movedCount: number;
    };
  }>("/api/meals/slot-batch", {
    method: "PATCH",
    body: JSON.stringify(input),
  });

  return response.data;
}

export async function getPreferences() {
  const response = await fetchJson<{ data: SettingsPreferences }>(
    "/api/preferences"
  );
  return response.data;
}

export async function patchPreferences(patch: PreferenceUpdateInput) {
  const response = await fetchJson<{ data: SettingsPreferences }>(
    "/api/preferences",
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
  return response.data;
}

export async function resetPreferences() {
  const response = await fetchJson<{ data: SettingsPreferences }>(
    "/api/preferences/reset",
    {
      method: "POST",
    }
  );
  return response.data;
}

export async function exportUserData() {
  const response = await fetchBinary("/api/preferences/export");

  return {
    blob: response.blob,
    fileName: response.fileName ?? "local-recipe-book-export.json",
  };
}

export type MenuExportOptions = {
  from: string;
  to: string;
  layout: MenuLayout;
  format: MenuExportFormat;
  includeEmptyDays?: boolean;
  title?: string;
};

export async function exportMenu(options: MenuExportOptions) {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
    layout: options.layout,
    format: options.format,
  });

  if (options.includeEmptyDays === false) {
    params.set("includeEmptyDays", "false");
  }

  if (options.title?.trim()) {
    params.set("title", options.title.trim());
  }

  const response = await fetchBinary(`/api/menu-export?${params.toString()}`);

  return {
    blob: response.blob,
    fileName:
      response.fileName ??
      `meal-plan-menu.${options.format === "markdown" ? "md" : options.format}`,
  };
}

export async function listRecipes(filters?: string | RecipeListFilters) {
  const params = new URLSearchParams();
  if (typeof filters === "string") {
    if (filters.trim()) {
      params.set("query", filters.trim());
    }
  } else if (filters) {
    if (filters.query?.trim()) {
      params.set("query", filters.query.trim());
    }
    if (filters.origin?.trim()) {
      params.set("origin", filters.origin.trim());
    }
    if (filters.cuisine?.trim()) {
      params.set("cuisine", filters.cuisine.trim());
    }
    if (filters.favourite !== undefined) {
      params.set("favourite", String(filters.favourite));
    }
    if (filters.sortBy) {
      params.set("sortBy", filters.sortBy);
    }
    if (filters.sortOrder) {
      params.set("sortOrder", filters.sortOrder);
    }
    if (filters.searchSortMode) {
      params.set("searchSortMode", filters.searchSortMode);
    }
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/api/recipes?${queryString}` : "/api/recipes";
  const response = await fetchJson<{ data: RecipePayload[] }>(endpoint);
  return response.data;
}

export async function getRecipe(id: string) {
  const response = await fetchJson<{ data: RecipePayload }>(
    `/api/recipes/${id}`
  );
  return response.data;
}

export async function getRecipeMadeHistory(id: string) {
  const response = await fetchJson<{ data: RecipeMadeHistoryPayload }>(
    `/api/recipes/${id}/made-history`
  );
  return response.data;
}

export async function createRecipe(input: CreateRecipeInput) {
  const response = await fetchJson<{ data: RecipePayload }>("/api/recipes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateRecipe(
  id: string,
  input: Partial<CreateRecipeInput>
) {
  const response = await fetchJson<{ data: RecipePayload }>(
    `/api/recipes/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function deleteRecipe(id: string) {
  return fetchJson<{ data: { id: string } }>(`/api/recipes/${id}`, {
    method: "DELETE",
  });
}

export async function duplicateRecipe(id: string) {
  const response = await fetchJson<{ data: RecipePayload }>(
    `/api/recipes/${id}/duplicate`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return response.data;
}

export async function getRecipeIterations(id: string) {
  const response = await fetchJson<{ data: RecipeIterationPayload[] }>(
    `/api/recipes/${id}/iterations`
  );
  return response.data;
}

export async function ingestRecipe(
  url: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Extract<IngestProgressEvent, { type: "progress" }>) => void;
  } = {}
): Promise<IngestResult> {
  const response = await fetch(`${getApiBase()}/api/recipes/ingest`, {
    method: "POST",
    body: JSON.stringify({ url }),
    cache: "no-store",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      handleRejectedBrowserToken();
    }

    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as ApiErrorBody;
      message = payload.error ?? message;
    } catch {
      // Keep the status-based fallback when the server did not return JSON.
    }
    throw new ApiError(message, response.status);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { data?: IngestResult; error?: string };
    if (!payload.data) {
      throw new ApiError(
        payload.error ?? "Recipe import did not return a result.",
        response.status
      );
    }
    return payload.data;
  }

  if (!response.body) {
    throw new ApiError("Recipe import did not return a progress stream.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processFrame = (frame: string): IngestResult | null => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (!data) {
      return null;
    }

    const event = JSON.parse(data) as IngestProgressEvent;
    if (event.type === "progress") {
      options.onProgress?.(event);
      return null;
    }
    if (event.type === "error") {
      throw new ApiError(event.message, response.status);
    }
    return event.data;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const frames = buffer.replaceAll("\r\n", "\n").split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const result = processFrame(frame);
        if (result) {
          return result;
        }
      }

      if (done) {
        const result = processFrame(buffer);
        if (result) {
          return result;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new ApiError("Recipe import ended before returning a result.", response.status);
}

export async function confirmIngestRecipe(
  draft: CreateRecipeInput
): Promise<RecipePayload> {
  const response = await fetchJson<{ data: RecipePayload }>(
    "/api/recipes/ingest/confirm",
    {
      method: "POST",
      body: JSON.stringify(draft),
    }
  );
  return response.data;
}

export async function exportRecipes(ids?: string[]) {
  const endpoint =
    ids && ids.length > 0
      ? `/api/recipes/export?ids=${encodeURIComponent(ids.join(","))}`
      : "/api/recipes/export";
  const response = await fetchJson<{ data: RecipeExportJson }>(endpoint);
  return response.data;
}

export async function importRecipes(payload: RecipeExportJson) {
  const response = await fetchJson<{ data: unknown }>("/api/recipes/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function getActiveMealTypeProfile(date: string) {
  const response = await fetchJson<{ data: MealTypeProfilePayload | null }>(
    `${MEAL_TYPE_API_PATHS.active}?date=${encodeURIComponent(date)}`
  );
  return response.data;
}

export async function listMealTypeProfiles() {
  const response = await fetchJson<{ data: MealTypeProfilePayload[] }>(
    MEAL_TYPE_API_PATHS.profiles
  );
  return response.data;
}

export async function createMealTypeProfile(input: CreateMealTypeProfileInput) {
  const response = await fetchJson<{ data: MealTypeProfilePayload }>(
    MEAL_TYPE_API_PATHS.profiles,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function updateMealTypeProfile(
  id: string,
  input: UpdateMealTypeProfileInput
) {
  const response = await fetchJson<{ data: MealTypeProfilePayload }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function deleteMealTypeProfile(id: string) {
  const response = await fetchJson<{ data: { id: string } }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${id}`,
    {
      method: "DELETE",
    }
  );
  return response.data;
}

export async function duplicateMealTypeProfile(id: string) {
  const response = await fetchJson<{ data: MealTypeProfilePayload }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${id}/duplicate`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
  return response.data;
}

export async function createMealTypeDefinition(
  profileId: string,
  input: CreateMealTypeDefinitionInput
) {
  const response = await fetchJson<{ data: MealTypeDefinitionPayload }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${profileId}/definitions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function updateMealTypeDefinition(
  profileId: string,
  definitionId: string,
  input: UpdateMealTypeDefinitionInput
) {
  const response = await fetchJson<{ data: MealTypeDefinitionPayload }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${profileId}/definitions/${definitionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function deleteMealTypeDefinition(
  profileId: string,
  definitionId: string
) {
  const response = await fetchJson<{ data: { id: string } }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${profileId}/definitions/${definitionId}`,
    {
      method: "DELETE",
    }
  );
  return response.data;
}

export async function reorderMealTypeDefinitions(
  profileId: string,
  orderedIds: string[]
) {
  const response = await fetchJson<{ data: MealTypeDefinitionPayload[] }>(
    `${MEAL_TYPE_API_PATHS.profiles}/${profileId}/definitions/order`,
    {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }
  );
  return response.data;
}

export async function listMealSubTypeDefinitions() {
  const response = await fetchJson<{ data: MealSubTypeDefinitionPayload[] }>(
    MEAL_SUB_TYPE_API_PATHS.list
  );
  return response.data;
}

export async function createMealSubTypeDefinition(
  input: CreateMealSubTypeDefinitionInput
) {
  const response = await fetchJson<{ data: MealSubTypeDefinitionPayload }>(
    MEAL_SUB_TYPE_API_PATHS.list,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function updateMealSubTypeDefinition(
  id: string,
  input: UpdateMealSubTypeDefinitionInput
) {
  const response = await fetchJson<{ data: MealSubTypeDefinitionPayload }>(
    `${MEAL_SUB_TYPE_API_PATHS.list}/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
  return response.data;
}

export async function deleteMealSubTypeDefinition(id: string) {
  const response = await fetchJson<{ data: { id: string } }>(
    `${MEAL_SUB_TYPE_API_PATHS.list}/${id}`,
    {
      method: "DELETE",
    }
  );
  return response.data;
}

export async function reorderMealSubTypeDefinitions(orderedIds: string[]) {
  const response = await fetchJson<{ data: MealSubTypeDefinitionPayload[] }>(
    `${MEAL_SUB_TYPE_API_PATHS.list}/order`,
    {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }
  );
  return response.data;
}
