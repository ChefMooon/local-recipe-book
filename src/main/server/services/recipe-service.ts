import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load, type Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { Prisma } from "@prisma/client";
import type {
  RecipeSearchSortModeValue,
  RecipeSortByValue,
  RecipeSortOrderValue,
} from "@shared/api/constants";

import { prisma } from "../lib/prisma";
import { bootstrapDatabase } from "../lib/bootstrap";
import {
  convertIngredient,
  fromGrams,
  fromMl,
  getUnitCategory,
  toBaseUnit,
  type UnitMode,
} from "../lib/unit-converter";
import {
  normalizeIngredient,
  normalizeIngredients,
  type NormalizedIngredient,
} from "../lib/ingredient-normalizer";
import {
  buildDuplicateRecipeTitle,
  cleanRecipeSourceUrl,
  normalizeRecipeSourceUrl,
  normalizeRecipeTitle,
  sanitizeRecipeTitle,
} from "../lib/recipe-identity";
import {
  emitCommittedChange,
  publishCommittedChange,
  reserveCommittedChange,
} from "./change-event-bus";
import { calculatePantryRequirement } from "./pantry-calculation";
import {
  CreateRecipeInputSchema,
  UpdateRecipeInputSchema,
  type CreateRecipeInput,
  type IngestResult,
  type IngestProgressEvent,
  type RecipeCanonicalUnit,
  type RecipeExportJson,
  type UpdateRecipeInput,
} from "../schemas/recipe-schemas";

const execFileAsync = promisify(execFile);

function buildDefuddleCommand(url: string) {
  const defuddleArgs = ["defuddle", "parse", url, "--json", "--markdown"];
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", ...defuddleArgs],
    };
  }

  return {
    command: "npx",
    args: defuddleArgs,
  };
}

type SerializedRecipeIngredient = {
  id: string;
  name: string;
  quantity: number | null;
  quantityNumerator?: number | null;
  quantityDenominator?: number | null;
  unit: string | null;
  group: string | null;
  notes: string | null;
  parseConfidence?: "high" | "low" | null;
  parseRaw?: string | null;
  order: number;
};

type SerializedRecipe = {
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
  createdAt: string;
  updatedAt: string;
  sourceRecipeId: string | null;
  sourceRecipe: { id: string; title: string } | null;
  ingredients: SerializedRecipeIngredient[];
  tags: string[];
  linkedSubRecipes: Array<{ id: string; title: string }>;
};

type SerializedRecipeIteration = {
  id: string;
  title: string;
  parentId: string;
  depth: number;
};

export interface RecipeFilters {
  origin?: "manual" | "imported";
  cuisine?: string;
  tags?: string[];
  difficulty?: string;
  maxCookTime?: number;
  favourite?: boolean;
  rating?: number;
  sortBy?: RecipeSortByValue;
  sortOrder?: RecipeSortOrderValue;
  searchSortMode?: RecipeSearchSortModeValue;
}

const DEFAULT_RECIPE_SORT_BY: RecipeSortByValue = "updated";
const DEFAULT_RECIPE_SORT_ORDER: RecipeSortOrderValue = "desc";

function normalizeRecipeSort(filters?: Pick<RecipeFilters, "sortBy" | "sortOrder">) {
  return {
    sortBy: filters?.sortBy ?? DEFAULT_RECIPE_SORT_BY,
    sortOrder: filters?.sortOrder ?? DEFAULT_RECIPE_SORT_ORDER,
  };
}

function compareNullableValues(
  left: string | number | boolean | null,
  right: string | number | boolean | null,
  order: RecipeSortOrderValue
) {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  let comparison = 0;
  if (typeof left === "string" && typeof right === "string") {
    comparison = left.localeCompare(right);
  } else if (left > right) {
    comparison = 1;
  } else if (left < right) {
    comparison = -1;
  }

  return order === "desc" ? comparison * -1 : comparison;
}

export interface RolledUpIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  approximate: boolean;
  conversionConflict: boolean;
}

export type ImportResult = {
  imported: SerializedRecipe[];
  skipped: Array<{ title: string; reason: string }>;
};

type RecipeConflictReason = "duplicate_title" | "duplicate_source_url";

class RecipeConflictError extends Error {
  code: "RECIPE_DUPLICATE_TITLE" | "RECIPE_DUPLICATE_SOURCE_URL";
  reason: RecipeConflictReason;
  existing: ReturnType<typeof toIngestExistingRecipe>;

  constructor(reason: RecipeConflictReason, recipe: SerializedRecipe) {
    const duplicateLabel =
      reason === "duplicate_source_url"
        ? "A recipe from this URL already exists."
        : `A recipe named "${recipe.title}" already exists.`;

    super(duplicateLabel);
    this.name = "RecipeConflictError";
    this.code =
      reason === "duplicate_source_url"
        ? "RECIPE_DUPLICATE_SOURCE_URL"
        : "RECIPE_DUPLICATE_TITLE";
    this.reason = reason;
    this.existing = toIngestExistingRecipe(recipe);
  }
}

function isUniqueConstraintError(error: unknown, fieldName: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes(fieldName)
  );
}

function parseInstructions(instructions: string) {
  try {
    const parsed = JSON.parse(instructions) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function compactString(value: string | null | undefined) {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactMultilineString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function uniqueCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function sanitizeRequiredRecipeTitle(title: string) {
  const sanitizedTitle = sanitizeRecipeTitle(title);
  if (!sanitizedTitle) {
    throw new Error("Recipe title is required");
  }

  return sanitizedTitle;
}

function serializeRecipe(recipe: {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  difficulty: string | null;
  cuisine: string | null;
  instructions: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  origin: string;
  favourite: boolean;
  rating: number | null;
  cookNotes: string | null;
  lastMadeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sourceRecipeId?: string | null;
  sourceRecipe?: { id: string; title: string } | null;
  ingredients?: Array<{
    id: string;
    name: string;
    quantity: number | null;
    quantityNumerator?: number | null;
    quantityDenominator?: number | null;
    unit: string | null;
    group: string | null;
    notes: string | null;
    parseConfidence?: string | null;
    parseRaw?: string | null;
    order: number;
  }>;
  tags?: Array<{ tag: string }>;
  linkedFrom?: Array<{ subRecipe: { id: string; title: string } }>;
}): SerializedRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    difficulty: recipe.difficulty,
    cuisine: recipe.cuisine,
    instructions: parseInstructions(recipe.instructions),
    sourceUrl: recipe.sourceUrl,
    sourceLabel: recipe.sourceLabel,
    origin: recipe.origin,
    favourite: recipe.favourite,
    rating: recipe.rating,
    cookNotes: recipe.cookNotes,
    lastMadeAt: recipe.lastMadeAt?.toISOString() ?? null,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
    sourceRecipeId: recipe.sourceRecipeId ?? null,
    sourceRecipe: recipe.sourceRecipe
      ? {
          id: recipe.sourceRecipe.id,
          title: recipe.sourceRecipe.title,
        }
      : null,
    ingredients: (recipe.ingredients ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((ingredient) => {
        const derivedQuantity =
          ingredient.quantity != null
            ? ingredient.quantity
            : fractionToDecimal(
                ingredient.quantityNumerator ?? null,
                ingredient.quantityDenominator ?? null
              );

        return {
          id: ingredient.id,
          name: ingredient.name,
          quantity: derivedQuantity,
          quantityNumerator: ingredient.quantityNumerator ?? null,
          quantityDenominator: ingredient.quantityDenominator ?? null,
          unit: ingredient.unit,
          group: ingredient.group,
          notes: ingredient.notes,
          parseConfidence:
            ingredient.parseConfidence === "high" || ingredient.parseConfidence === "low"
              ? ingredient.parseConfidence
              : null,
          parseRaw: ingredient.parseRaw ?? null,
          order: ingredient.order,
        };
      }),
    tags: (recipe.tags ?? []).map((entry) => entry.tag),
    linkedSubRecipes: (recipe.linkedFrom ?? []).map((entry) => ({
      id: entry.subRecipe.id,
      title: entry.subRecipe.title,
    })),
  };
}

function includeRecipeRelations() {
  return {
    ingredients: true,
    tags: true,
    sourceRecipe: {
      select: {
        id: true,
        title: true,
      },
    },
    linkedFrom: { include: { subRecipe: true } },
  } as const;
}

function normalizedRowsFromInput(input: CreateRecipeInput | UpdateRecipeInput) {
  if (input.ingredientLines && input.ingredientLines.length > 0) {
    return normalizeIngredients(input.ingredientLines).map((ingredient, index) => {
      const quantityInfo = normalizeQuantityFields(
        ingredient.quantity,
        null,
        null
      );

      return {
        name: ingredient.name,
        quantity: quantityInfo.quantity,
        quantityNumerator: quantityInfo.quantityNumerator,
        quantityDenominator: quantityInfo.quantityDenominator,
        unit: ingredient.unit,
        group: null,
        notes: ingredient.notes,
        parseConfidence: ingredient.confidence,
        parseRaw: input.ingredientLines?.[index] ?? null,
        order: index,
      };
    });
  }

  return (input.ingredients ?? []).map((ingredient, index) => {
    const normalized = normalizeIngredient(
      [
        ingredient.quantity ?? "",
        ingredient.unit ?? "",
        ingredient.name,
        ingredient.notes ?? "",
      ]
        .join(" ")
        .trim()
    );

    const quantityInfo = normalizeQuantityFields(
      ingredient.quantity ?? normalized.quantity,
      ingredient.quantityNumerator ?? null,
      ingredient.quantityDenominator ?? null
    );

    return {
      name: normalized.name,
      quantity: quantityInfo.quantity,
      quantityNumerator: quantityInfo.quantityNumerator,
      quantityDenominator: quantityInfo.quantityDenominator,
      unit: ingredient.unit ?? normalized.unit,
      group: compactString(ingredient.group),
      notes: ingredient.notes ?? normalized.notes,
      parseConfidence: ingredient.parseConfidence ?? normalized.confidence,
      parseRaw: ingredient.parseRaw ?? null,
      order: ingredient.order ?? index,
    };
  });
}

function fractionToDecimal(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function decimalToFraction(value: number): { numerator: number; denominator: number } {
  const rounded = Math.round(value * 1000) / 1000;
  const sign = rounded < 0 ? -1 : 1;
  const absValue = Math.abs(rounded);
  const denominator = 1000;
  const numerator = Math.round(absValue * denominator);
  const divisor = greatestCommonDivisor(numerator, denominator);

  return {
    numerator: sign * (numerator / divisor),
    denominator: denominator / divisor,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }

  return a || 1;
}

function normalizeQuantityFields(
  quantity: number | null | undefined,
  quantityNumerator: number | null,
  quantityDenominator: number | null
) {
  const hasFraction = quantityNumerator != null && quantityDenominator != null;
  if (hasFraction) {
    return {
      quantity: fractionToDecimal(quantityNumerator, quantityDenominator),
      quantityNumerator,
      quantityDenominator,
    };
  }

  if (typeof quantity === "number" && Number.isFinite(quantity)) {
    const fraction = decimalToFraction(quantity);
    return {
      quantity,
      quantityNumerator: fraction.numerator,
      quantityDenominator: fraction.denominator,
    };
  }

  return {
    quantity: null,
    quantityNumerator: null,
    quantityDenominator: null,
  };
}

function sectionLines(markdown: string, sectionNames: string[]) {
  const lines = markdown.split(/\r?\n/);
  const headingRegex = /^#{1,6}\s+(.*)$/;
  const startIndex = lines.findIndex((line) => {
    const match = line.match(headingRegex);
    if (!match) {
      return false;
    }
    const heading = match[1].trim().toLowerCase();
    return sectionNames.some((name) => heading.includes(name));
  });

  if (startIndex < 0) {
    return [];
  }

  const output: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (headingRegex.test(line)) {
      break;
    }

    if (!line) {
      continue;
    }

    output.push(line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""));
  }

  return output;
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripWrappingParentheses(value: string) {
  return value.replace(/^\(/, "").replace(/\)$/, "").trim();
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const normalized = collapseWhitespace(line);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function uniqueBlocks(blocks: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    const key = collapseWhitespace(trimmed).toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function splitBulletLikeText(value: string) {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return [];
  }

  const hasInlineBulletDelimiter =
    /[•●▪◦]/.test(normalized) || /(?:^|\s)[-–—]\s*(?=[A-Z(0-9])/.test(normalized);

  const normalizedBullets = normalized
    .replace(/\s*[•●▪◦]\s*/g, "\n")
    .replace(/(?:^|\s)[-–—]\s*(?=[A-Z(0-9])/g, "\n");

  const bulletSegments = normalizedBullets
    .split("\n")
    .map((segment) => collapseWhitespace(segment))
    .filter((segment) => segment.length > 0);

  if (!hasInlineBulletDelimiter || bulletSegments.length <= 1) {
    return [normalized];
  }

  return bulletSegments.map((segment) => {
    const withoutMarker = segment.replace(/^[-*]\s+/, "").trim();
    const deglued = collapseWhitespace(
      withoutMarker
        .replace(/^Notes(?=[A-Z])/i, "")
        .replace(/^(Add-ins|Pan note|Storing)(?=[A-Z])/i, "$1 ")
    );
    return deglued.length > 0 ? `- ${deglued}` : "";
  }).filter((segment) => segment.length > 0);
}

function selectRecipeNoteContainers(
  allContainers: unknown[],
  isContainedBy: (outer: unknown, inner: unknown) => boolean,
  getTextLength: (element: unknown) => number
) {
  const nonNested = allContainers.filter(
    (candidate) =>
      !allContainers.some(
        (other) => other !== candidate && isContainedBy(other, candidate)
      )
  );

  if (nonNested.length > 0) {
    return nonNested;
  }

  const sortedByText = [...allContainers].sort(
    (a, b) => getTextLength(b) - getTextLength(a)
  );
  return sortedByText.slice(0, 1);
}

function formatCookNotesFromContainer(
  getText: (element: unknown) => string,
  getTagName: (element: unknown) => string,
  elements: unknown[]
) {
  const sections: string[] = [];
  let activeHeading = "";
  let activeLines: string[] = [];

  const flushSection = () => {
    const body = uniqueLines(activeLines).join("\n");
    if (!body) {
      activeHeading = "";
      activeLines = [];
      return;
    }

    if (activeHeading) {
      sections.push(`${activeHeading}\n${body}`);
    } else {
      sections.push(body);
    }

    activeHeading = "";
    activeLines = [];
  };

  for (const element of elements) {
    const tag = getTagName(element);
    const text = collapseWhitespace(getText(element));
    if (!text) {
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      flushSection();
      activeHeading = text;
      continue;
    }

    if (tag === "li") {
      const bulletLines = splitBulletLikeText(text)
        .map((line) =>
          collapseWhitespace(
            line
              .replace(/^[-*]\s+/, "")
              .replace(/^Notes(?=[A-Z])/i, "")
              .replace(/^(Add-ins|Pan note|Storing)(?=[A-Z])/i, "$1 ")
          )
        )
        .filter((line) => line.length > 0)
        .map((line) => `- ${line}`);

      activeLines.push(...bulletLines);
      continue;
    }

    const bulletLines = splitBulletLikeText(text);
    activeLines.push(...bulletLines);
  }

  flushSection();
  return uniqueBlocks(sections).join("\n\n");
}

function formatCookNotesText(value: string) {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return "";
  }

  const explicitLines = value
    .split(/\r?\n+/)
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0)
    .flatMap((line) => splitBulletLikeText(line));
  const dedupedExplicitLines = uniqueLines(explicitLines);

  if (dedupedExplicitLines.some((line) => line.startsWith("- "))) {
    return dedupedExplicitLines.join("\n");
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const normalizedSentences = sentences
    .map((line) =>
      collapseWhitespace(
        line
          .replace(/^Notes(?=[A-Z])/i, "")
          .replace(/^(Add-ins|Pan note|Storing)(?=[A-Z])/i, "$1 ")
      )
    )
    .filter((line) => line.length > 0);

  if (normalizedSentences.length >= 3) {
    return normalizedSentences.map((line) => `- ${line}`).join("\n");
  }

  return normalizedSentences.join(" ") || normalized;
}

export function parseIngredientLinesFromHtml(html: string) {
  const $ = load(html);
  const ingredientHeadings = $("h1,h2,h3,h4,h5,h6")
    .filter((_, element) => {
      const heading = collapseWhitespace($(element).text()).toLowerCase();
      return heading === "ingredients" || heading.includes("ingredients");
    });

  if (!ingredientHeadings.length) {
    return [];
  }

  const scoreList = (lines: string[]) => {
    let score = 0;
    for (const line of lines) {
      if (/[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(line)) {
        score += 2;
      }
      if (/\b(cup|cups|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|g|gram|grams|kg|ml|l)\b/i.test(line)) {
        score += 1;
      }
      if (line.length <= 100) {
        score += 1;
      }
    }
    return score;
  };

  const parseList = (listElement: Cheerio<Element>) => {
    const ingredientLines: string[] = [];

    listElement.children("li").each((_: number, liElement: Element) => {
      const directSpans = $(liElement).children("span");
      const fallbackContentSpans = directSpans.slice(1);
      const firstSpanText = collapseWhitespace(directSpans.eq(0).text());
      const hasLeadingAmount = /[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(firstSpanText);

      const contentSpans = hasLeadingAmount ? directSpans : fallbackContentSpans;

      if (!contentSpans.length) {
        const fallback = collapseWhitespace($(liElement).text());
        if (fallback) {
          ingredientLines.push(fallback);
        }
        return;
      }

      const amountUnitSpan = contentSpans.eq(0);
      const amountUnitParts = amountUnitSpan.children("span");

      let amount = "";
      let unit = "";
      if (amountUnitParts.length >= 2) {
        amount = collapseWhitespace(amountUnitParts.eq(0).text());
        unit = collapseWhitespace(amountUnitParts.eq(1).text());
      } else {
        const fallbackAmountUnit = collapseWhitespace(amountUnitSpan.text());
        const [firstToken, ...rest] = fallbackAmountUnit.split(" ");
        amount = firstToken ?? "";
        unit = rest.join(" ").trim();
      }

      const metricCandidate = stripWrappingParentheses(
        collapseWhitespace(contentSpans.eq(1).text())
      );
      const hasMetricCandidate =
        Boolean(metricCandidate) &&
        /[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(metricCandidate) &&
        /\b(g|gram|grams|kg|ml|l)\b/i.test(metricCandidate);

      const nameIndex = hasMetricCandidate ? 2 : 1;
      const name = collapseWhitespace(contentSpans.eq(nameIndex).text());
      const notes = collapseWhitespace(contentSpans.eq(nameIndex + 1).text());

      const ingredientLine = [amount, unit, name, notes]
        .filter((part) => part.length > 0)
        .join(" ")
        .trim();

      if (ingredientLine) {
        ingredientLines.push(ingredientLine);
      }
    });

    return ingredientLines;
  };

  const candidates: Array<{ lines: string[]; score: number }> = [];
  ingredientHeadings.each((_, heading) => {
    const headingNode = $(heading);
    const nextLists = headingNode.nextAll("ul").slice(0, 3);
    nextLists.each((__, listNode) => {
      const lines = parseList($(listNode));
      if (lines.length > 0) {
        candidates.push({ lines, score: scoreList(lines) });
      }
    });

    const nearestContainer = headingNode.closest("section, article, div");
    nearestContainer.find("ul").slice(0, 3).each((__, listNode) => {
      const lines = parseList($(listNode));
      if (lines.length > 0) {
        candidates.push({ lines, score: scoreList(lines) });
      }
    });
  });

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => b.score - a.score || b.lines.length - a.lines.length);
  return candidates[0].lines;
}

export function parseCookNotesFromHtml(html: string) {
  const $ = load(html);

  const noteContainers = selectRecipeNoteContainers(
    $(
      ".wprm-recipe-notes-container, .wprm-recipe-notes, [class*='recipe-notes'], [id*='recipe-notes']"
    ).toArray(),
    (outer, inner) => $(outer as never).find(inner as never).length > 0,
    (element) => collapseWhitespace($(element as never).text()).length
  );

  const byRecipeNoteContainer = uniqueBlocks(
    noteContainers
      .map((element) => {
        const container = $(element as never);
        let contentNodes = container
          .find("h1,h2,h3,h4,h5,h6,p,li")
          .toArray();

        if (contentNodes.length === 0) {
          contentNodes = container
            .find("div")
            .toArray()
            .filter(
              (node) =>
                $(node).find("h1,h2,h3,h4,h5,h6,p,li,div").length === 0
            );
        }

        const sectioned = formatCookNotesFromContainer(
          (node) => $(node as never).text(),
          (node) => ((node as { tagName?: string }).tagName ?? "").toLowerCase(),
          contentNodes
        );

        return sectioned || formatCookNotesText(container.text());
      })
      .filter((text) => text.length >= 25)
  );

  if (byRecipeNoteContainer.length > 0) {
    return byRecipeNoteContainer.join("\n\n");
  }

  const notesHeadings = $("h1,h2,h3,h4,h5,h6").filter((_, element) =>
    /\bnotes\b/i.test(collapseWhitespace($(element).text()))
  );

  const candidates: string[] = [];
  notesHeadings.each((_, headingElement) => {
    const heading = $(headingElement);
    const lines: string[] = [];
    let sibling = heading.next();
    let guard = 0;

    while (sibling.length > 0 && guard < 20) {
      const tag = (sibling.get(0)?.tagName ?? "").toLowerCase();
      const text = collapseWhitespace(sibling.text());
      guard += 1;

      if (/^h[12]$/.test(tag) && text) {
        break;
      }

      if (
        text &&
        !/^(nutrition|frequently asked questions|comments?)$/i.test(text)
      ) {
        lines.push(tag === "li" ? `- ${text}` : text);
      }

      sibling = sibling.next();
    }

    const combined = uniqueLines(lines).join("\n\n");
    if (combined.length >= 25) {
      candidates.push(combined);
    }
  });

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

export type RecipeIngestionReport = {
  source: {
    url: string | null;
    sourceLabel: string | null;
    title: string;
    description: string | null;
    markdownLength: number;
    htmlLength: number;
  };
  ingredientExtraction: {
    source: "html" | "markdown" | "fallback";
    rawCandidates: string[];
    normalized: Array<{
      name: string;
      quantity: number | null;
      unit: RecipeCanonicalUnit | null;
      notes: string | null;
      confidence: "high" | "low";
      raw: string;
    }>;
    flaggedLowConfidence: Array<{
      name: string;
      quantity: number | null;
      unit: RecipeCanonicalUnit | null;
      notes: string | null;
      confidence: "low";
      raw: string;
    }>;
  };
  instructions: {
    source: "markdown" | "default";
    raw: string[];
    final: string[];
    fallbackUsed: boolean;
  };
  cookNotes: {
    present: boolean;
    raw: string | null;
    final: string | null;
  };
  finalRecipe: {
    title: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    difficulty: string | null;
    cuisine: null;
    sourceUrl: string | null;
    sourceLabel: string | null;
    origin: "imported";
    ingredients: Array<{
      name: string;
      quantity: number | null;
      unit: RecipeCanonicalUnit | null;
      notes: string | null;
      order: number;
      confidence: "high" | "low";
      raw: string;
    }>;
    instructions: string[];
    cookNotes: string | null;
    tags: string[];
  };
  validation: {
    passed: boolean;
    warnings: string[];
  };
};

export function buildRecipeIngestionReport({
  markdown,
  html,
  title,
  description,
  sourceUrl,
  sourceLabel,
}: {
  markdown: string;
  html: string;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
}): RecipeIngestionReport {
  const trimmedTitle = (title ?? "").trim() || "Imported Recipe";
  const htmlIngredients = html ? parseIngredientLinesFromHtml(html) : [];
  const markdownIngredients = sectionLines(markdown, ["ingredient"]);
  const ingredientCandidates = htmlIngredients.length > 0 ? htmlIngredients : markdownIngredients;
  const ingredientSource: RecipeIngestionReport["ingredientExtraction"]["source"] =
    htmlIngredients.length > 0 ? "html" : markdownIngredients.length > 0 ? "markdown" : "fallback";
  const normalized = normalizeIngredients(ingredientCandidates);
  const normalizedWithRaw = normalized.map((entry, index) => ({
    ...entry,
    order: index,
    raw: ingredientCandidates[index] ?? entry.name,
  }));
  const flaggedLowConfidence = normalizedWithRaw.filter(
    (entry) => entry.confidence === "low"
  );

  const warnings: string[] = [];
  if (ingredientSource === "fallback") {
    warnings.push("No ingredient section found in source content.");
  }
  if (ingredientSource === "markdown" && htmlIngredients.length === 0) {
    warnings.push("No HTML ingredient list found; using markdown section as fallback.");
  }

  const rawInstructions = sectionLines(markdown, ["instruction", "direction", "method"]);
  const instructionsFinal = rawInstructions.length > 0 ? rawInstructions : ["Review and edit steps before saving."];
  const hasSeeNoteReference = normalized.some((ingredient) =>
    /see note/i.test(ingredient.notes ?? "")
  );
  const finalCookNotes =
    hasSeeNoteReference && html
      ? compactMultilineString(parseCookNotesFromHtml(html))
      : null;

  const finalRecipe = {
    title: trimmedTitle,
    description: compactString(description ?? null),
    servings: 2,
    prepTime: null,
    cookTime: null,
    difficulty: null,
    cuisine: null,
    sourceUrl: sourceUrl ?? null,
    sourceLabel: sourceLabel ?? null,
    origin: "imported" as const,
    ingredients: normalizedWithRaw.map((entry, index) => ({
      name: entry.name,
      quantity: entry.quantity,
      unit: entry.unit as RecipeCanonicalUnit | null,
      notes: entry.notes,
      order: index,
      confidence: entry.confidence,
      raw: entry.raw,
    })),
    instructions: instructionsFinal,
    cookNotes: finalCookNotes,
    tags: sourceLabel ? [`source:${sourceLabel}`] : [],
  };

  return {
    source: {
      url: sourceUrl ?? null,
      sourceLabel: sourceLabel ?? null,
      title: trimmedTitle,
      description: compactString(description ?? null),
      markdownLength: markdown.length,
      htmlLength: html.length,
    },
    ingredientExtraction: {
      source: ingredientSource,
      rawCandidates: ingredientCandidates,
      normalized: normalizedWithRaw.map(({ name, quantity, unit, notes, confidence, raw }) => ({
        name,
        quantity,
        unit: unit as RecipeCanonicalUnit | null,
        notes,
        confidence,
        raw,
      })),
      flaggedLowConfidence: flaggedLowConfidence.map(({ name, quantity, unit, notes, raw, order }) => ({
        name,
        order,
        quantity,
        unit: unit as RecipeCanonicalUnit | null,
        notes,
        confidence: "low" as const,
        raw,
      })),
    },
    instructions: {
      source: rawInstructions.length > 0 ? "markdown" : "default",
      raw: rawInstructions,
      final: instructionsFinal,
      fallbackUsed: rawInstructions.length === 0,
    },
    cookNotes: {
      present: Boolean(finalCookNotes),
      raw: finalCookNotes,
      final: finalCookNotes,
    },
    finalRecipe,
    validation: {
      passed: warnings.length === 0,
      warnings,
    },
  };
}

export async function runRecipeIngestionDiagnostic(
  sourceUrl: string
): Promise<RecipeIngestionReport> {
  const cleanedUrl = new URL(sourceUrl).toString();
  const sourceLabel = new URL(cleanedUrl).hostname.replace(/^www\./, "");
  const defuddle = buildDefuddleCommand(cleanedUrl);
  const result = await execFileAsync(defuddle.command, defuddle.args, {
    timeout: 45000,
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true,
  });
  const payload = JSON.parse(result.stdout) as {
    title?: string;
    description?: string;
    content?: string;
  };
  const markdown = payload.content ?? "";
  const html = (await fetchRecipeHtml(cleanedUrl)) ?? "";

  return buildRecipeIngestionReport({
    markdown,
    html,
    title: payload.title ?? "Imported Recipe",
    description: payload.description ?? "",
    sourceUrl: cleanedUrl,
    sourceLabel,
  });
}

async function fetchRecipeHtml(url: string, signal?: AbortSignal) {
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.text();
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
}

function lineToStringQuantity(value: number | null) {
  if (value == null) {
    return null;
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function toOrigin(value: string): "manual" | "imported" {
  if (value === "imported") {
    return value;
  }
  return "manual";
}

function toIngestExistingRecipe(recipe: SerializedRecipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    difficulty: recipe.difficulty,
    instructions: recipe.instructions,
    sourceUrl: recipe.sourceUrl,
    sourceLabel: recipe.sourceLabel,
    origin: toOrigin(recipe.origin),
    favourite: recipe.favourite,
    rating: recipe.rating,
    cookNotes: recipe.cookNotes,
    lastMadeAt: recipe.lastMadeAt,
    tags: recipe.tags,
    ingredients: recipe.ingredients,
  };
}

export class RecipeService {
  private buildRecipeOrderBy(filters?: Pick<RecipeFilters, "sortBy" | "sortOrder">) {
    const { sortBy, sortOrder } = normalizeRecipeSort(filters);
    const primaryOrder: Prisma.RecipeOrderByWithRelationInput =
      sortBy === "created"
        ? { createdAt: sortOrder }
        : sortBy === "title"
          ? { title: sortOrder }
          : sortBy === "cookTime"
            ? { cookTime: sortOrder }
            : sortBy === "rating"
              ? { rating: sortOrder }
              : sortBy === "lastMade"
                ? { lastMadeAt: sortOrder }
                : sortBy === "favourite"
                  ? { favourite: sortOrder }
                  : { updatedAt: sortOrder };

    const orderBy: Prisma.RecipeOrderByWithRelationInput[] = [primaryOrder];
    if (sortBy !== "title") {
      orderBy.push({ title: "asc" });
    }
    orderBy.push({ id: "asc" });

    return orderBy;
  }

  sortRecipes(
    recipes: SerializedRecipe[],
    filters?: Pick<RecipeFilters, "sortBy" | "sortOrder">
  ): SerializedRecipe[] {
    const { sortBy, sortOrder } = normalizeRecipeSort(filters);

    return [...recipes].sort((left, right) => {
      const leftValue: string | number | boolean | null =
        sortBy === "created"
          ? left.createdAt
          : sortBy === "title"
            ? left.title.toLowerCase()
            : sortBy === "cookTime"
              ? left.cookTime
              : sortBy === "rating"
                ? left.rating
                : sortBy === "lastMade"
                  ? left.lastMadeAt
                  : sortBy === "favourite"
                    ? left.favourite
                    : left.updatedAt;

      const rightValue: string | number | boolean | null =
        sortBy === "created"
          ? right.createdAt
          : sortBy === "title"
            ? right.title.toLowerCase()
            : sortBy === "cookTime"
              ? right.cookTime
              : sortBy === "rating"
                ? right.rating
                : sortBy === "lastMade"
                  ? right.lastMadeAt
                  : sortBy === "favourite"
                    ? right.favourite
                    : right.updatedAt;

      const primaryComparison = compareNullableValues(
        leftValue,
        rightValue,
        sortOrder
      );
      if (primaryComparison !== 0) {
        return primaryComparison;
      }

      const titleComparison = left.title.localeCompare(right.title);
      if (titleComparison !== 0) {
        return titleComparison;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private async findRecipeConflict(input: {
    title?: string | null;
    sourceUrl?: string | null;
    excludeRecipeId?: string;
  }): Promise<RecipeConflictError | null> {
    const excludeRecipeId = input.excludeRecipeId;
    const idFilter = excludeRecipeId ? { not: excludeRecipeId } : undefined;

    if (input.sourceUrl) {
      const existingBySourceUrl = await prisma.recipe.findFirst({
        where: {
          normalizedSourceUrl: input.sourceUrl,
          ...(idFilter ? { id: idFilter } : {}),
        },
        include: includeRecipeRelations(),
      });

      if (existingBySourceUrl) {
        return new RecipeConflictError(
          "duplicate_source_url",
          serializeRecipe(existingBySourceUrl)
        );
      }
    }

    if (input.title) {
      const existingByTitle = await prisma.recipe.findFirst({
        where: {
          normalizedTitle: input.title,
          ...(idFilter ? { id: idFilter } : {}),
        },
        include: includeRecipeRelations(),
      });

      if (existingByTitle) {
        return new RecipeConflictError(
          "duplicate_title",
          serializeRecipe(existingByTitle)
        );
      }
    }

    return null;
  }

  private async getNextAvailableDuplicateTitle(baseTitle: string) {
    let copyNumber = 1;

    while (true) {
      const candidate = buildDuplicateRecipeTitle(baseTitle, copyNumber);
      const conflict = await this.findRecipeConflict({
        title: normalizeRecipeTitle(candidate),
      });

      if (!conflict) {
        return candidate;
      }

      copyNumber += 1;
    }
  }

  async createRecipe(data: CreateRecipeInput): Promise<SerializedRecipe> {
    await bootstrapDatabase();
    const input = CreateRecipeInputSchema.parse(data);
    const title = sanitizeRequiredRecipeTitle(input.title);
    const sourceUrl = cleanRecipeSourceUrl(input.sourceUrl);
    const normalizedSourceUrl = normalizeRecipeSourceUrl(sourceUrl);

    const conflict = await this.findRecipeConflict({
      title: normalizeRecipeTitle(title),
      sourceUrl: normalizedSourceUrl,
    });
    if (conflict) {
      throw conflict;
    }

    const ingredients = normalizedRowsFromInput(input);
    const tags = uniqueCaseInsensitive(input.tags ?? []);

    if (input.sourceRecipeId) {
      const sourceExists = await prisma.recipe.findUnique({
        where: { id: input.sourceRecipeId },
        select: { id: true },
      });

      if (!sourceExists) {
        throw new Error("Source recipe not found");
      }
    }

    try {
      const recipe = await prisma.$transaction(async (tx) => {
        const created = await tx.recipe.create({
          data: {
            title,
            normalizedTitle: normalizeRecipeTitle(title),
            description: compactString(input.description),
            servings: input.servings ?? 2,
            prepTime: input.prepTime ?? null,
            cookTime: input.cookTime ?? null,
            difficulty: compactString(input.difficulty),
            cuisine: compactString(input.cuisine),
            instructions: JSON.stringify(input.instructions),
            sourceUrl,
            normalizedSourceUrl,
            sourceLabel: compactString(input.sourceLabel),
            origin: input.origin ?? "manual",
            favourite: input.favourite ?? false,
            rating: input.rating ?? null,
            cookNotes: compactString(input.cookNotes),
            sourceRecipeId: input.sourceRecipeId ?? null,
            ingredients: {
              create: ingredients.map((ingredient) => ({
                name: ingredient.name,
                quantity: ingredient.quantity,
                quantityNumerator: ingredient.quantityNumerator,
                quantityDenominator: ingredient.quantityDenominator,
                unit: ingredient.unit,
                group: ingredient.group,
                notes: ingredient.notes,
                parseConfidence: ingredient.parseConfidence,
                parseRaw: ingredient.parseRaw,
                order: ingredient.order,
              })),
            },
            tags: {
              create: tags.map((tag) => ({ tag })),
            },
          },
        });

        const links = input.linkedSubRecipes ?? [];
        if (links.length > 0) {
          await tx.recipeLink.createMany({
            data: links.map((entry) => ({
              parentId: created.id,
              subRecipeId: entry.subRecipeId,
            })),
          });
        }

        return tx.recipe.findUniqueOrThrow({
          where: { id: created.id },
          include: includeRecipeRelations(),
        });
      });

      await publishCommittedChange("recipe", "create", recipe.id);
      return serializeRecipe(recipe);
    } catch (error) {
      if (error instanceof RecipeConflictError) {
        throw error;
      }

      if (
        isUniqueConstraintError(error, "normalizedTitle") ||
        isUniqueConstraintError(error, "normalizedSourceUrl")
      ) {
        const retryConflict = await this.findRecipeConflict({
          title: normalizeRecipeTitle(title),
          sourceUrl,
        });

        if (retryConflict) {
          throw retryConflict;
        }
      }

      throw error;
    }
  }

  async updateRecipe(id: string, data: UpdateRecipeInput): Promise<SerializedRecipe> {
    await bootstrapDatabase();
    const input = UpdateRecipeInputSchema.parse(data);

    const updateData: Parameters<typeof prisma.recipe.update>[0]["data"] = {};

    const nextTitle =
      input.title !== undefined ? sanitizeRequiredRecipeTitle(input.title) : undefined;
    const nextSourceUrl =
      input.sourceUrl !== undefined ? cleanRecipeSourceUrl(input.sourceUrl) : undefined;
    const nextNormalizedSourceUrl =
      input.sourceUrl !== undefined ? normalizeRecipeSourceUrl(nextSourceUrl) : undefined;

    if (input.title !== undefined || input.sourceUrl !== undefined) {
      const conflict = await this.findRecipeConflict({
        title:
          nextTitle !== undefined ? normalizeRecipeTitle(nextTitle) : undefined,
        sourceUrl: nextNormalizedSourceUrl,
        excludeRecipeId: id,
      });

      if (conflict) {
        throw conflict;
      }
    }

    if (nextTitle !== undefined) {
      updateData.title = nextTitle;
      updateData.normalizedTitle = normalizeRecipeTitle(nextTitle);
    }
    if (input.description !== undefined) {
      updateData.description = compactString(input.description);
    }
    if (input.servings !== undefined) updateData.servings = input.servings;
    if (input.prepTime !== undefined) updateData.prepTime = input.prepTime;
    if (input.cookTime !== undefined) updateData.cookTime = input.cookTime;
    if (input.difficulty !== undefined) {
      updateData.difficulty = compactString(input.difficulty);
    }
    if (input.cuisine !== undefined) {
      updateData.cuisine = compactString(input.cuisine);
    }
    if (input.instructions !== undefined) {
      updateData.instructions = JSON.stringify(input.instructions);
    }
    if (input.sourceUrl !== undefined) {
      updateData.sourceUrl = nextSourceUrl;
      updateData.normalizedSourceUrl = nextNormalizedSourceUrl;
    }
    if (input.sourceLabel !== undefined) {
      updateData.sourceLabel = compactString(input.sourceLabel);
    }
    if (input.origin !== undefined) updateData.origin = input.origin;
    if (input.favourite !== undefined) updateData.favourite = input.favourite;
    if (input.rating !== undefined) updateData.rating = input.rating;
    if (input.cookNotes !== undefined) {
      updateData.cookNotes = compactString(input.cookNotes);
    }
    if (input.sourceRecipeId !== undefined) {
      updateData.sourceRecipeId = input.sourceRecipeId;
    }

    if (input.sourceRecipeId) {
      const sourceExists = await prisma.recipe.findUnique({
        where: { id: input.sourceRecipeId },
        select: { id: true },
      });

      if (!sourceExists) {
        throw new Error("Source recipe not found");
      }
    }

    try {
      const recipe = await prisma.$transaction(async (tx) => {
        await tx.recipe.update({ where: { id }, data: updateData });

        if (input.ingredients !== undefined || input.ingredientLines !== undefined) {
          const ingredients = normalizedRowsFromInput(input);
          await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
          if (ingredients.length > 0) {
            await tx.recipeIngredient.createMany({
              data: ingredients.map((ingredient) => ({
                recipeId: id,
                name: ingredient.name,
                quantity: ingredient.quantity,
                quantityNumerator: ingredient.quantityNumerator,
                quantityDenominator: ingredient.quantityDenominator,
                unit: ingredient.unit,
                group: ingredient.group,
                notes: ingredient.notes,
                parseConfidence: ingredient.parseConfidence,
                parseRaw: ingredient.parseRaw,
                order: ingredient.order,
              })),
            });
          }
        }

        if (input.tags !== undefined) {
          const tags = uniqueCaseInsensitive(input.tags);
          await tx.recipeTag.deleteMany({ where: { recipeId: id } });
          if (tags.length > 0) {
            await tx.recipeTag.createMany({
              data: tags.map((tag) => ({ recipeId: id, tag })),
            });
          }
        }

        if (input.linkedSubRecipes !== undefined) {
          await tx.recipeLink.deleteMany({ where: { parentId: id } });
          if (input.linkedSubRecipes.length > 0) {
            await tx.recipeLink.createMany({
              data: input.linkedSubRecipes.map((entry) => ({
                parentId: id,
                subRecipeId: entry.subRecipeId,
              })),
            });
          }
        }

        return tx.recipe.findUniqueOrThrow({
          where: { id },
          include: {
            ...includeRecipeRelations(),
          },
        });
      });

      await publishCommittedChange("recipe", "update", recipe.id);
      return serializeRecipe(recipe);
    } catch (error) {
      if (error instanceof RecipeConflictError) {
        throw error;
      }

      if (
        isUniqueConstraintError(error, "normalizedTitle") ||
        isUniqueConstraintError(error, "normalizedSourceUrl")
      ) {
        const retryConflict = await this.findRecipeConflict({
          title: nextTitle !== undefined ? normalizeRecipeTitle(nextTitle) : undefined,
          sourceUrl: nextNormalizedSourceUrl,
          excludeRecipeId: id,
        });

        if (retryConflict) {
          throw retryConflict;
        }
      }

      throw error;
    }
  }

  async deleteRecipe(id: string): Promise<void> {
    await bootstrapDatabase();

    const linkedParents = await prisma.recipeLink.findMany({
      where: { subRecipeId: id },
      include: { parent: { select: { title: true } } },
    });

    if (linkedParents.length > 0) {
      const parentTitles = linkedParents.map((entry) => entry.parent.title).join(", ");
      throw new Error(
        `Cannot delete recipe because it is used as a sub-recipe in: ${parentTitles}`
      );
    }

    await prisma.recipe.delete({ where: { id } });
    await publishCommittedChange("recipe", "delete", id);
  }

  async getRecipe(id: string): Promise<SerializedRecipe | null> {
    await bootstrapDatabase();

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      include: {
        ...includeRecipeRelations(),
      },
    });

    return recipe ? serializeRecipe(recipe) : null;
  }

  async listRecipes(filters?: RecipeFilters): Promise<SerializedRecipe[]> {
    await bootstrapDatabase();

    const where: Record<string, unknown> = {};
    if (filters?.origin) where.origin = filters.origin;
    if (filters?.cuisine) where.cuisine = filters.cuisine;
    if (filters?.difficulty) where.difficulty = filters.difficulty;
    if (filters?.maxCookTime !== undefined) {
      where.cookTime = { lte: filters.maxCookTime };
    }
    if (filters?.favourite !== undefined) {
      where.favourite = filters.favourite;
    }
    if (filters?.rating !== undefined) {
      where.rating = { gte: filters.rating };
    }
    if (filters?.tags && filters.tags.length > 0) {
      where.AND = filters.tags.map((tag) => ({
        tags: {
          some: {
            tag: { equals: tag },
          },
        },
      }));
    }

    const recipes = await prisma.recipe.findMany({
      where,
      include: {
        ...includeRecipeRelations(),
      },
      orderBy: this.buildRecipeOrderBy(filters),
    });

    return recipes.map(serializeRecipe);
  }

  async searchRecipes(query: string): Promise<SerializedRecipe[]> {
    await bootstrapDatabase();
    const q = query.trim();
    if (!q) {
      return this.listRecipes();
    }

    const [titleMatches, metaMatches, ingredientMatches, tagMatches] =
      await Promise.all([
        prisma.recipe.findMany({
          where: { title: { contains: q } },
          include: includeRecipeRelations(),
        }),
        prisma.recipe.findMany({
          where: {
            OR: [
              { description: { contains: q } },
              { cuisine: { contains: q } },
              { cookNotes: { contains: q } },
              { instructions: { contains: q } },
            ],
          },
          include: includeRecipeRelations(),
        }),
        prisma.recipe.findMany({
          where: {
            ingredients: {
              some: {
                name: { contains: q },
              },
            },
          },
          include: includeRecipeRelations(),
        }),
        prisma.recipe.findMany({
          where: {
            tags: {
              some: {
                tag: { contains: q },
              },
            },
          },
          include: includeRecipeRelations(),
        }),
      ]);

    const scoreMap = new Map<string, { score: number; recipe: SerializedRecipe }>();
    const addScored = (recipes: typeof titleMatches, score: number) => {
      for (const recipe of recipes) {
        const serialized = serializeRecipe(recipe);
        const existing = scoreMap.get(serialized.id);
        if (!existing || existing.score < score) {
          scoreMap.set(serialized.id, { score, recipe: serialized });
        }
      }
    };

    addScored(titleMatches, 4);
    addScored(ingredientMatches, 3);
    addScored(tagMatches, 2);
    addScored(metaMatches, 1);

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title))
      .map((entry) => entry.recipe);
  }

  async ingestFromUrl(
    url: string,
    options: {
      signal?: AbortSignal;
      onProgress?: (event: Extract<IngestProgressEvent, { type: "progress" }>) => void;
    } = {}
  ): Promise<IngestResult> {
    await bootstrapDatabase();

    const cleanedUrl = cleanRecipeSourceUrl(url);
    if (!cleanedUrl) {
      throw new Error("Recipe URL is required");
    }
    const normalizedSourceUrl = normalizeRecipeSourceUrl(cleanedUrl);
    const sourceLabel = new URL(cleanedUrl).hostname.replace(/^www\./, "");

    const reportProgress = (
      stage: Extract<IngestProgressEvent, { type: "progress" }>["stage"],
      message: string
    ) => options.onProgress?.({ type: "progress", stage, message });

    options.signal?.throwIfAborted();
    reportProgress("checking-duplicates", "Checking your recipe library...");
    const sourceConflict = await this.findRecipeConflict({
      sourceUrl: normalizedSourceUrl,
    });

    if (sourceConflict) {
      return {
        duplicate: true,
        existing: sourceConflict.existing,
      };
    }

    options.signal?.throwIfAborted();
    reportProgress("fetching", "Fetching recipe page...");

    let markdown = "";
    let title = "";
    let description = "";

    try {
      const defuddle = buildDefuddleCommand(cleanedUrl);
      const result = await execFileAsync(
        defuddle.command,
        defuddle.args,
        {
          timeout: 45000,
          maxBuffer: 1024 * 1024 * 8,
          windowsHide: true,
          signal: options.signal,
        }
      );
      const payload = JSON.parse(result.stdout) as {
        title?: string;
        description?: string;
        content?: string;
      };

      markdown = payload.content ?? "";
      title = payload.title ?? "Imported Recipe";
      description = payload.description ?? "";
    } catch {
      throw new Error("Unable to ingest recipe from URL");
    }

    options.signal?.throwIfAborted();
    const conflict = await this.findRecipeConflict({
      title: normalizeRecipeTitle(title.trim() || "Imported Recipe"),
      sourceUrl: normalizedSourceUrl,
    });

    if (conflict) {
      return {
        duplicate: true,
        existing: conflict.existing,
      };
    }

    options.signal?.throwIfAborted();
    reportProgress("extracting", "Extracting recipe details...");
    const report = buildRecipeIngestionReport({
      markdown,
      html: (await fetchRecipeHtml(cleanedUrl, options.signal)) ?? "",
      title: title.trim() || "Imported Recipe",
      description,
      sourceUrl: cleanedUrl,
      sourceLabel,
    });

    reportProgress("preparing", "Preparing recipe draft...");
    return {
      duplicate: false,
      recipe: {
        title: report.finalRecipe.title,
        description: report.finalRecipe.description,
        servings: report.finalRecipe.servings,
        prepTime: report.finalRecipe.prepTime,
        cookTime: report.finalRecipe.cookTime,
        difficulty: report.finalRecipe.difficulty,
        cuisine: report.finalRecipe.cuisine,
        cookNotes: report.finalRecipe.cookNotes,
        instructions: report.finalRecipe.instructions,
        sourceUrl: report.finalRecipe.sourceUrl,
        sourceLabel: report.finalRecipe.sourceLabel,
        origin: report.finalRecipe.origin,
        linkedSubRecipes: [],
        tags: report.finalRecipe.tags,
        ingredients: report.finalRecipe.ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          notes: ingredient.notes,
          order: ingredient.order,
        })),
      },
      flaggedIngredients: report.ingredientExtraction.flaggedLowConfidence,
    };
  }

  async duplicateRecipe(
    id: string,
    overrides?: Partial<CreateRecipeInput>
  ): Promise<SerializedRecipe> {
    const source = await this.getRecipe(id);
    if (!source) {
      throw new Error("Recipe not found");
    }

    const title =
      overrides?.title ?? (await this.getNextAvailableDuplicateTitle(source.title));

    return this.createRecipe({
      title,
      description: source.description,
      servings: source.servings,
      prepTime: source.prepTime,
      cookTime: source.cookTime,
      difficulty: source.difficulty,
      cuisine: source.cuisine,
      instructions: source.instructions,
      origin: "manual",
      sourceUrl: null,
      sourceLabel: null,
      rating: source.rating,
      cookNotes: source.cookNotes,
      ingredients: source.ingredients,
      tags: source.tags,
      linkedSubRecipes: source.linkedSubRecipes.map((entry) => ({
        subRecipeId: entry.id,
      })),
      ...overrides,
      sourceRecipeId: id,
    });
  }

  async getRecipeIterations(id: string): Promise<SerializedRecipeIteration[]> {
    await bootstrapDatabase();

    const root = await prisma.recipe.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!root) {
      throw new Error("Recipe not found");
    }

    const iterations: SerializedRecipeIteration[] = [];
    const visited = new Set<string>([id]);
    let frontier = [id];
    let depth = 1;

    while (frontier.length > 0) {
      const children = await prisma.recipe.findMany({
        where: {
          sourceRecipeId: {
            in: frontier,
          },
        },
        select: {
          id: true,
          title: true,
          sourceRecipeId: true,
        },
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      });

      const nextFrontier: string[] = [];

      for (const child of children) {
        if (!child.sourceRecipeId || visited.has(child.id)) {
          continue;
        }

        visited.add(child.id);
        iterations.push({
          id: child.id,
          title: child.title,
          parentId: child.sourceRecipeId,
          depth,
        });
        nextFrontier.push(child.id);
      }

      frontier = nextFrontier;
      depth += 1;
    }

    return iterations;
  }

  async getRolledUpIngredients(
    recipeId: string,
    unitMode: UnitMode = "cup"
  ): Promise<RolledUpIngredient[]> {
    await bootstrapDatabase();

    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      include: {
        ingredients: true,
        linkedFrom: {
          include: {
            subRecipe: {
              include: {
                ingredients: true,
              },
            },
          },
        },
      },
    });

    if (!recipe) {
      throw new Error("Recipe not found");
    }

    const allIngredients = [
      ...recipe.ingredients,
      ...recipe.linkedFrom.flatMap((entry) => entry.subRecipe.ingredients),
    ];

    const categoryByName = new Map<string, Set<string>>();
    const grouped = new Map<
      string,
      {
        name: string;
        category: ReturnType<typeof getUnitCategory>;
        baseQuantity: number | null;
        baseUnit: string | null;
        notes: string[];
        approximate: boolean;
      }
    >();

    for (const ingredient of allIngredients) {
      const category = getUnitCategory(ingredient.unit);
      const base = toBaseUnit(ingredient.quantity, ingredient.unit, ingredient.name);
      const key = `${ingredient.name.trim().toLowerCase()}::${category}`;

      const categories = categoryByName.get(ingredient.name.trim().toLowerCase()) ?? new Set<string>();
      categories.add(category);
      categoryByName.set(ingredient.name.trim().toLowerCase(), categories);

      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          name: ingredient.name,
          category,
          baseQuantity: base.quantity,
          baseUnit: base.unit,
          notes: ingredient.notes ? [ingredient.notes] : [],
          approximate: base.approximate,
        });
        continue;
      }

      if (base.quantity != null && existing.baseQuantity != null) {
        existing.baseQuantity += base.quantity;
      } else if (base.quantity != null && existing.baseQuantity == null) {
        existing.baseQuantity = base.quantity;
      }

      if (ingredient.notes) {
        existing.notes.push(ingredient.notes);
      }
      existing.approximate = existing.approximate || base.approximate;
      grouped.set(key, existing);
    }

    const result: RolledUpIngredient[] = [];

    for (const entry of grouped.values()) {
      let quantity: number | null = entry.baseQuantity;
      let unit: string | null = entry.baseUnit;

      if (entry.baseQuantity != null && entry.baseUnit === "ml") {
        const converted =
          unitMode === "cup"
            ? fromMl(entry.baseQuantity)
            : convertIngredient(entry.baseQuantity, "ml", entry.name, "grams");
        quantity = converted.quantity;
        unit = converted.unit;
      } else if (entry.baseQuantity != null && entry.baseUnit === "g") {
        const converted = fromGrams(entry.baseQuantity, unitMode);
        quantity = converted.quantity;
        unit = converted.unit;
      }

      const categories = categoryByName.get(entry.name.trim().toLowerCase()) ?? new Set();
      const conversionConflict =
        categories.has("volume") && categories.has("weight");

      result.push({
        name: entry.name,
        quantity,
        unit,
        notes: uniqueCaseInsensitive(entry.notes).join("; ") || null,
        approximate: entry.approximate,
        conversionConflict,
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async addToGroceryList(recipeIds: string[], groceryListId: string): Promise<void> {
    await bootstrapDatabase();

    const pantryStaples = await prisma.userPreference.findUnique({
      where: { id: "default" },
      select: { pantryStaples: true },
    });
    const legacyPantryStaples = new Set<string>();
    if (pantryStaples?.pantryStaples) {
      try {
        const parsed = JSON.parse(pantryStaples.pantryStaples) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string") legacyPantryStaples.add(item.trim().toLowerCase());
          }
        }
      } catch {
        // Preserve the existing malformed-value behavior.
      }
    }

    const rolled = (
      await Promise.all(recipeIds.map((recipeId) => this.getRolledUpIngredients(recipeId)))
    ).flat();

    const deduped = new Map<string, RolledUpIngredient>();
    for (const ingredient of rolled) {
      const key = `${ingredient.name.trim().toLowerCase()}::${ingredient.unit ?? ""}`;
      if (legacyPantryStaples.has(ingredient.name.trim().toLowerCase())) {
        continue;
      }

      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, ingredient);
        continue;
      }

      if (existing.quantity != null && ingredient.quantity != null) {
        existing.quantity += ingredient.quantity;
      }
      existing.approximate = existing.approximate || ingredient.approximate;
      existing.conversionConflict =
        existing.conversionConflict || ingredient.conversionConflict;
      deduped.set(key, existing);
    }

    for (const ingredient of deduped.values()) {
      const pantry = await calculatePantryRequirement(
        ingredient.name,
        ingredient.quantity,
        ingredient.unit
      );
      if (pantry.quantity === null) {
        continue;
      }
      if (pantry.quantity === 0) {
        continue;
      }

      const pantryNotes = [
        ingredient.notes,
        pantry.explanation,
        pantry.packageSuggestion
          ? `Suggested packages: ${pantry.packageSuggestion.count} x ${pantry.packageSuggestion.label}`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      const existing = await prisma.groceryItem.findFirst({
        where: {
          groceryListId,
          name: ingredient.name,
          unit: ingredient.unit,
        },
      });

      if (!existing) {
        await prisma.groceryItem.create({
          data: {
            groceryListId,
            name: ingredient.name,
            qty: lineToStringQuantity(ingredient.quantity),
            unit: ingredient.unit,
            category: "Other",
            notes: pantryNotes || null,
            checked: false,
          },
        });
        continue;
      }

      const existingQty = existing.qty ? Number.parseFloat(existing.qty) : 0;
      const incomingQty = ingredient.quantity ?? 0;
      const nextQty = Number.isFinite(existingQty)
        ? existingQty + incomingQty
        : incomingQty;

      await prisma.groceryItem.update({
        where: { id: existing.id },
        data: {
          qty: lineToStringQuantity(nextQty),
          notes: existing.notes ?? pantryNotes ?? null,
        },
      });
    }
  }

  async generateGroceryList(recipeIds: string[], name: string) {
    await bootstrapDatabase();

    const groceryList = await prisma.groceryList.create({
      data: {
        name,
        date: new Date(),
        favourite: false,
      },
    });

    await this.addToGroceryList(recipeIds, groceryList.id);
    await publishCommittedChange("groceryList", "create", groceryList.id);
    return groceryList;
  }

  async updateRating(id: string, rating: number, cookNotes?: string) {
    await bootstrapDatabase();
    const result = await prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.update({
        where: { id },
        data: {
          rating,
          cookNotes: compactString(cookNotes),
          lastMadeAt: new Date(),
        },
        include: {
          ...includeRecipeRelations(),
        },
      });
      return {
        recipe,
        change: await reserveCommittedChange(tx, "recipe", "update", id),
      };
    });

    emitCommittedChange(result.change);
    return serializeRecipe(result.recipe);
  }

  async importRecipes(json: RecipeExportJson): Promise<ImportResult> {
    await bootstrapDatabase();

    const imported: SerializedRecipe[] = [];
    const skipped: Array<{ title: string; reason: string }> = [];

    for (const recipe of json.recipes) {
      try {
        const created = await this.createRecipe({
          title: recipe.title,
          description: recipe.description,
          servings: recipe.servings,
          prepTime: recipe.prepTime,
          cookTime: recipe.cookTime,
          difficulty: recipe.difficulty,
          cuisine: recipe.cuisine ?? null,
          instructions: recipe.instructions,
          sourceUrl: recipe.sourceUrl,
          sourceLabel: recipe.sourceLabel,
          origin: recipe.origin,
          favourite: recipe.favourite,
          rating: recipe.rating,
          cookNotes: recipe.cookNotes,
          ingredients: recipe.ingredients,
          tags: recipe.tags,
          linkedSubRecipes: [],
        });

        imported.push(created);
      } catch (error) {
        if (error instanceof RecipeConflictError) {
          skipped.push({ title: recipe.title, reason: error.reason });
          continue;
        }

        throw error;
      }
    }

    if (imported.length > 0) {
      await publishCommittedChange("recipe", "bulk");
    }
    return { imported, skipped };
  }

  async exportRecipes(ids?: string[]): Promise<RecipeExportJson> {
    await bootstrapDatabase();

    const recipes = await prisma.recipe.findMany({
      where: ids && ids.length > 0 ? { id: { in: ids } } : undefined,
      include: {
        ingredients: true,
        tags: true,
      },
      orderBy: { title: "asc" },
    });

    return {
      version: "2",
      exportedAt: new Date().toISOString(),
      recipes: recipes.map((recipe) => {
        const serialized = serializeRecipe(recipe);
        return {
          id: serialized.id,
          title: serialized.title,
          description: serialized.description,
          servings: serialized.servings,
          prepTime: serialized.prepTime,
          cookTime: serialized.cookTime,
          difficulty: serialized.difficulty,
          cuisine: serialized.cuisine,
          instructions: serialized.instructions,
          sourceUrl: serialized.sourceUrl,
          sourceLabel: serialized.sourceLabel,
          origin: serialized.origin as "manual" | "imported",
          favourite: serialized.favourite,
          rating: serialized.rating,
          cookNotes: serialized.cookNotes,
          lastMadeAt: serialized.lastMadeAt,
          tags: serialized.tags,
          ingredients: serialized.ingredients,
        };
      }),
    };
  }

  async formatForTelegram(id: string, viewStyle: string, unitMode: UnitMode) {
    const recipe = await this.getRecipe(id);
    if (!recipe) {
      throw new Error("Recipe not found");
    }

    const ingredients = recipe.ingredients
      .map((ingredient) => {
        const converted = convertIngredient(
          ingredient.quantity,
          ingredient.unit,
          ingredient.name,
          unitMode
        );
        const quantityPart =
          converted.quantity != null
            ? `${converted.approximate ? "~" : ""}${converted.quantity}`
            : "";
        const unitPart = converted.unit ?? "";
        const notes = ingredient.notes ? ` (${ingredient.notes})` : "";
        return `- ${[quantityPart, unitPart, ingredient.name].filter(Boolean).join(" ")}${notes}`;
      })
      .join("\n");

    const steps = recipe.instructions
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n");

    const body = `${recipe.title}\nServings: ${recipe.servings}\nView: ${viewStyle}\n\nIngredients\n${ingredients}\n\nSteps\n${steps}`;

    if (body.length <= 4096) {
      return body;
    }

    return `${body.slice(0, 4000)}\n\n[Truncated for Telegram length limit]`;
  }
}

export type { NormalizedIngredient };
