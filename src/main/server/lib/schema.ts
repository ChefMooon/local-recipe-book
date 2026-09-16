import { prisma } from "./prisma";
import {
  buildDuplicateRecipeTitle,
  cleanRecipeSourceUrl,
  normalizeRecipeSourceUrl,
  normalizeRecipeTitle,
  sanitizeRecipeTitle,
} from "./recipe-identity";

type TableInfoRow = {
  name: string;
};

type RecipeIdentityRow = {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  normalizedTitle: string | null;
  normalizedSourceUrl: string | null;
};

type IntegrityCheckRow = {
  integrity_check?: string;
  quick_check?: string;
};

const SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS "Meal" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "date" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "mealType" TEXT NOT NULL,
      "mealTypeDefinitionId" TEXT,
      "mealSubTypeDefinitionId" TEXT,
      "notes" TEXT,
      "ingredientsJson" TEXT NOT NULL DEFAULT '[]',
      "description" TEXT,
      "instructionsJson" TEXT NOT NULL DEFAULT '[]',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "servings" INTEGER NOT NULL DEFAULT 2,
      "prepTime" INTEGER,
      "cookTime" INTEGER,
      "cuisine" TEXT,
      "servingsOverride" INTEGER,
      "recipeId" TEXT,
      "photoDataUrl" TEXT,
      "photoPath" TEXT,
      "photoMimeType" TEXT,
      "photoFileName" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS "Meal_date_idx" ON "Meal"("date")`,
  `CREATE INDEX IF NOT EXISTS "Meal_date_mealType_sortOrder_idx" ON "Meal"("date", "mealType", "sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "Meal_mealTypeDefinitionId_idx" ON "Meal"("mealTypeDefinitionId")`,
  `CREATE INDEX IF NOT EXISTS "Meal_mealSubTypeDefinitionId_idx" ON "Meal"("mealSubTypeDefinitionId")`,
  `CREATE INDEX IF NOT EXISTS "Meal_cuisine_idx" ON "Meal"("cuisine")`,
  `CREATE INDEX IF NOT EXISTS "Meal_recipeId_idx" ON "Meal"("recipeId")`,
  `
    CREATE TABLE IF NOT EXISTS "MealSubTypeDefinition" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "color" TEXT NOT NULL,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "cutoffTime" TEXT DEFAULT '23:59',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MealSubTypeDefinition_slug_key" ON "MealSubTypeDefinition"("slug")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MealSubTypeDefinition_sortOrder_key" ON "MealSubTypeDefinition"("sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "MealSubTypeDefinition_sortOrder_idx" ON "MealSubTypeDefinition"("sortOrder")`,
  `
    CREATE TABLE IF NOT EXISTS "MealTypeProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#3B5E45',
      "description" TEXT,
      "isDefault" INTEGER NOT NULL DEFAULT 0,
      "priority" INTEGER NOT NULL DEFAULT 0,
      "startDate" DATETIME,
      "endDate" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS "MealTypeProfile_isDefault_priority_idx" ON "MealTypeProfile"("isDefault", "priority")`,
  `CREATE INDEX IF NOT EXISTS "MealTypeProfile_startDate_endDate_priority_idx" ON "MealTypeProfile"("startDate", "endDate", "priority")`,
  `
    CREATE TABLE IF NOT EXISTS "MealTypeDefinition" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "profileId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "color" TEXT NOT NULL,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MealTypeDefinition_profileId_fkey"
        FOREIGN KEY ("profileId") REFERENCES "MealTypeProfile" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MealTypeDefinition_profileId_slug_key" ON "MealTypeDefinition"("profileId", "slug")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MealTypeDefinition_profileId_sortOrder_key" ON "MealTypeDefinition"("profileId", "sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "MealTypeDefinition_profileId_sortOrder_idx" ON "MealTypeDefinition"("profileId", "sortOrder")`,
  `
    CREATE TABLE IF NOT EXISTS "GroceryList" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "date" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "favourite" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS "GroceryList_date_idx" ON "GroceryList"("date")`,
  `
    CREATE TABLE IF NOT EXISTS "GroceryItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "groceryListId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "qty" TEXT,
      "unit" TEXT,
      "category" TEXT NOT NULL DEFAULT 'Other',
      "notes" TEXT,
      "meal" TEXT,
      "checked" INTEGER NOT NULL DEFAULT 0,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "GroceryItem_groceryListId_fkey"
        FOREIGN KEY ("groceryListId") REFERENCES "GroceryList" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "GroceryItem_groceryListId_sortOrder_idx" ON "GroceryItem"("groceryListId", "sortOrder")`,
  `
    CREATE TABLE IF NOT EXISTS "PrepList" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "notes" TEXT,
      "date" DATETIME,
      "fromDate" DATETIME,
      "toDate" DATETIME,
      "sourceMode" TEXT NOT NULL DEFAULT 'manual',
      "sourceLabel" TEXT,
      "sourceMealIdsJson" TEXT NOT NULL DEFAULT '[]',
      "sourceRecipeIdsJson" TEXT NOT NULL DEFAULT '[]',
      "favourite" INTEGER NOT NULL DEFAULT 0,
      "sortMode" TEXT NOT NULL DEFAULT 'manual',
      "groupBy" TEXT NOT NULL DEFAULT 'dish',
      "includeIngredients" INTEGER NOT NULL DEFAULT 1,
      "includeTasks" INTEGER NOT NULL DEFAULT 1,
      "includeQuantities" INTEGER NOT NULL DEFAULT 1,
      "includeIngredientTypes" INTEGER NOT NULL DEFAULT 1,
      "includeSourceLabels" INTEGER NOT NULL DEFAULT 1,
      "excludePantryStaples" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PrepList_date_idx" ON "PrepList"("date")`,
  `CREATE INDEX IF NOT EXISTS "PrepList_fromDate_toDate_idx" ON "PrepList"("fromDate", "toDate")`,
  `CREATE INDEX IF NOT EXISTS "PrepList_sourceMode_idx" ON "PrepList"("sourceMode")`,
  `
    CREATE TABLE IF NOT EXISTS "PrepItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "prepListId" TEXT NOT NULL,
      "kind" TEXT NOT NULL DEFAULT 'ingredient',
      "name" TEXT NOT NULL,
      "qty" TEXT,
      "unit" TEXT,
      "ingredientType" TEXT,
      "prepGroup" TEXT,
      "dish" TEXT,
      "notes" TEXT,
      "checked" INTEGER NOT NULL DEFAULT 0,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "sourceMealIdsJson" TEXT NOT NULL DEFAULT '[]',
      "sourceRecipeIdsJson" TEXT NOT NULL DEFAULT '[]',
      "sourceLabelsJson" TEXT NOT NULL DEFAULT '[]',
      CONSTRAINT "PrepItem_prepListId_fkey"
        FOREIGN KEY ("prepListId") REFERENCES "PrepList" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PrepItem_prepListId_sortOrder_idx" ON "PrepItem"("prepListId", "sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "PrepItem_prepListId_kind_idx" ON "PrepItem"("prepListId", "kind")`,
  `
    CREATE TABLE IF NOT EXISTS "UserPreference" (
      "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "householdSize" INTEGER NOT NULL DEFAULT 2,
      "cookingLength" TEXT NOT NULL DEFAULT 'weeknight',
      "dietaryTags" TEXT NOT NULL DEFAULT '',
      "favoriteCuisines" TEXT NOT NULL DEFAULT '',
      "avoidCuisines" TEXT NOT NULL DEFAULT '',
      "avoidIngredients" TEXT NOT NULL DEFAULT '[]',
      "pantryStaples" TEXT NOT NULL DEFAULT '[]',
      "planningNotes" TEXT NOT NULL DEFAULT '',
      "nutritionTags" TEXT NOT NULL DEFAULT '',
      "skillLevel" TEXT NOT NULL DEFAULT 'home-cook',
      "budgetRange" TEXT NOT NULL DEFAULT 'moderate',
      "autoGenerateGrocery" INTEGER NOT NULL DEFAULT 1,
      "consolidateIngredients" INTEGER NOT NULL DEFAULT 1,
      "autoReviewPantry" INTEGER NOT NULL DEFAULT 1,
      "defaultPlanLength" TEXT NOT NULL DEFAULT '7',
      "groceryGrouping" TEXT NOT NULL DEFAULT 'category',
      "defaultRecipeView" TEXT NOT NULL DEFAULT 'basic',
      "defaultUnitMode" TEXT NOT NULL DEFAULT 'cup',
      "reasoningEffort" TEXT NOT NULL DEFAULT ''
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "Recipe" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "normalizedTitle" TEXT,
      "description" TEXT,
      "servings" INTEGER NOT NULL DEFAULT 2,
      "prepTime" INTEGER,
      "cookTime" INTEGER,
      "difficulty" TEXT,
      "cuisine" TEXT,
      "instructions" TEXT NOT NULL,
      "sourceUrl" TEXT,
      "normalizedSourceUrl" TEXT,
      "sourceLabel" TEXT,
      "origin" TEXT NOT NULL DEFAULT 'manual',
      "favourite" INTEGER NOT NULL DEFAULT 0,
      "rating" INTEGER,
      "cookNotes" TEXT,
      "lastMadeAt" DATETIME,
      "sourceRecipeId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Recipe_sourceRecipeId_fkey"
        FOREIGN KEY ("sourceRecipeId") REFERENCES "Recipe" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "Recipe_title_idx" ON "Recipe"("title")`,
  `CREATE INDEX IF NOT EXISTS "Recipe_origin_idx" ON "Recipe"("origin")`,
  `CREATE INDEX IF NOT EXISTS "Recipe_cuisine_idx" ON "Recipe"("cuisine")`,
  `CREATE INDEX IF NOT EXISTS "Recipe_sourceUrl_idx" ON "Recipe"("sourceUrl")`,
  `CREATE INDEX IF NOT EXISTS "Recipe_sourceRecipeId_idx" ON "Recipe"("sourceRecipeId")`,
  `
    CREATE TABLE IF NOT EXISTS "RecipeIngredient" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "recipeId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "quantity" REAL,
      "quantityNumerator" INTEGER,
      "quantityDenominator" INTEGER,
      "unit" TEXT,
      "group" TEXT,
      "notes" TEXT,
      "parseConfidence" TEXT,
      "parseRaw" TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "RecipeIngredient_recipeId_fkey"
        FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "RecipeIngredient_recipeId_order_idx" ON "RecipeIngredient"("recipeId", "order")`,
  `CREATE INDEX IF NOT EXISTS "RecipeIngredient_recipeId_unit_idx" ON "RecipeIngredient"("recipeId", "unit")`,
  `CREATE INDEX IF NOT EXISTS "RecipeIngredient_name_idx" ON "RecipeIngredient"("name")`,
  `
    CREATE TABLE IF NOT EXISTS "RecipeTag" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "recipeId" TEXT NOT NULL,
      "tag" TEXT NOT NULL,
      CONSTRAINT "RecipeTag_recipeId_fkey"
        FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecipeTag_recipeId_tag_key" ON "RecipeTag"("recipeId", "tag")`,
  `CREATE INDEX IF NOT EXISTS "RecipeTag_tag_idx" ON "RecipeTag"("tag")`,
  `
    CREATE TABLE IF NOT EXISTS "RecipeLink" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "parentId" TEXT NOT NULL,
      "subRecipeId" TEXT NOT NULL,
      CONSTRAINT "RecipeLink_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "Recipe" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "RecipeLink_subRecipeId_fkey"
        FOREIGN KEY ("subRecipeId") REFERENCES "Recipe" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecipeLink_parentId_subRecipeId_key" ON "RecipeLink"("parentId", "subRecipeId")`,
  `CREATE INDEX IF NOT EXISTS "RecipeLink_subRecipeId_idx" ON "RecipeLink"("subRecipeId")`,
  `
    CREATE TABLE IF NOT EXISTS "SyncState" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "PantryItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "normalizedName" TEXT NOT NULL UNIQUE,
      "category" TEXT NOT NULL DEFAULT 'Other',
      "stockMode" TEXT NOT NULL DEFAULT 'always-available',
      "warningThreshold" REAL,
      "warningUnit" TEXT,
      "expirationWarningDays" INTEGER,
      "replenishmentTarget" REAL,
      "replenishmentUnit" TEXT,
      "replenishmentQuantity" REAL,
      "dailyUsageQuantity" REAL,
      "dailyUsageUnit" TEXT,
      "dailyUsageWarningDays" INTEGER,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PantryItem_category_idx" ON "PantryItem"("category")`,
  `CREATE INDEX IF NOT EXISTS "PantryItem_stockMode_idx" ON "PantryItem"("stockMode")`,
  `CREATE INDEX IF NOT EXISTS "PantryItem_updatedAt_idx" ON "PantryItem"("updatedAt")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryAlias" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "itemId" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "normalizedAlias" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PantryAlias_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PantryAlias_itemId_normalizedAlias_key" ON "PantryAlias"("itemId", "normalizedAlias")`,
  `CREATE INDEX IF NOT EXISTS "PantryAlias_normalizedAlias_idx" ON "PantryAlias"("normalizedAlias")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryLocationStock" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "itemId" TEXT NOT NULL,
      "location" TEXT NOT NULL DEFAULT 'Unspecified',
      "normalizedLocation" TEXT NOT NULL DEFAULT 'unspecified',
      "quantity" REAL,
      "unit" TEXT,
      "approximate" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PantryLocationStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PantryLocationStock_itemId_normalizedLocation_key" ON "PantryLocationStock"("itemId", "normalizedLocation")`,
  `CREATE INDEX IF NOT EXISTS "PantryLocationStock_normalizedLocation_idx" ON "PantryLocationStock"("normalizedLocation")`,
  `CREATE INDEX IF NOT EXISTS "PantryLocationStock_updatedAt_idx" ON "PantryLocationStock"("updatedAt")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryLot" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "locationStockId" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit" TEXT,
      "approximate" INTEGER NOT NULL DEFAULT 0,
      "bestBeforeAt" DATETIME,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PantryLot_locationStockId_fkey" FOREIGN KEY ("locationStockId") REFERENCES "PantryLocationStock"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PantryLot_locationStockId_expiresAt_idx" ON "PantryLot"("locationStockId", "expiresAt")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryPackage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "itemId" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit" TEXT NOT NULL,
      "dimension" TEXT NOT NULL,
      "confirmed" INTEGER NOT NULL DEFAULT 0,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PantryPackage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PantryPackage_itemId_enabled_idx" ON "PantryPackage"("itemId", "enabled")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryWarningRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "itemId" TEXT NOT NULL,
      "threshold" REAL NOT NULL,
      "unit" TEXT,
      "severity" TEXT NOT NULL DEFAULT 'warning',
      "message" TEXT,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PantryWarningRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PantryWarningRule_itemId_enabled_idx" ON "PantryWarningRule"("itemId", "enabled")`,
  `
    CREATE TABLE IF NOT EXISTS "PantryInventoryEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "itemId" TEXT NOT NULL,
      "locationStockId" TEXT,
      "lotId" TEXT,
      "type" TEXT NOT NULL,
      "quantityDelta" REAL,
      "quantity" REAL,
      "unit" TEXT,
      "approximate" INTEGER NOT NULL DEFAULT 0,
      "sourceType" TEXT,
      "sourceId" TEXT,
      "sourceIdentity" TEXT UNIQUE,
      "metadataJson" TEXT NOT NULL DEFAULT '{}',
      "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "importedAt" DATETIME,
      CONSTRAINT "PantryInventoryEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PantryInventoryEvent_locationStockId_fkey" FOREIGN KEY ("locationStockId") REFERENCES "PantryLocationStock"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "PantryInventoryEvent_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "PantryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS "PantryInventoryEvent_itemId_occurredAt_idx" ON "PantryInventoryEvent"("itemId", "occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "PantryInventoryEvent_locationStockId_occurredAt_idx" ON "PantryInventoryEvent"("locationStockId", "occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "PantryInventoryEvent_type_occurredAt_idx" ON "PantryInventoryEvent"("type", "occurredAt")`,
] as const;

async function ensureMissingColumns(
  tableName: string,
  safeAlterStatements: Record<string, string>
) {
  const rows = await prisma.$queryRawUnsafe<TableInfoRow[]>(
    `PRAGMA table_info("${tableName}")`
  );
  const existingColumns = new Set(rows.map((column) => column.name));

  for (const [columnName, statement] of Object.entries(safeAlterStatements)) {
    if (existingColumns.has(columnName)) {
      continue;
    }

    try {
      await prisma.$executeRawUnsafe(statement);
      existingColumns.add(columnName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate column name/i.test(message)) {
        existingColumns.add(columnName);
        continue;
      }

      throw new Error(
        `Failed to add missing column "${columnName}" on table "${tableName}": ${message}`
      );
    }
  }

  const refreshedRows = await prisma.$queryRawUnsafe<TableInfoRow[]>(
    `PRAGMA table_info("${tableName}")`
  );
  const refreshedColumns = new Set(refreshedRows.map((column) => column.name));

  const stillMissing = Object.keys(safeAlterStatements).filter(
    (columnName) => !refreshedColumns.has(columnName)
  );

  if (stillMissing.length > 0) {
    throw new Error(
      `Schema reconciliation could not add required columns on table "${tableName}": ${stillMissing.join(
        ", "
      )}`
    );
  }
}

async function normalizeMealSortOrderValues() {
  await prisma.$executeRawUnsafe(`
    UPDATE "Meal"
    SET "sortOrder" = 0
    WHERE "sortOrder" IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "Meal"
    SET "sortOrder" = CAST("sortOrder" AS INTEGER)
    WHERE typeof("sortOrder") != 'integer'
  `);
}

async function mealSortOrderColumnNeedsRepair() {
  const rows = await prisma.$queryRawUnsafe<Array<{ sortOrder: unknown }>>(`
    SELECT "sortOrder"
    FROM "Meal"
    LIMIT 1
  `);

  if (rows.length === 0) {
    return false;
  }

  return rows[0]?.sortOrder === "sortOrder";
}

async function rebuildMealTable() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Meal__legacy_sort_order_fix"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Meal__rebuild"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Meal" RENAME TO "Meal__legacy_sort_order_fix"`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Meal__rebuild" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "date" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "mealType" TEXT NOT NULL,
      "mealTypeDefinitionId" TEXT,
      "mealSubTypeDefinitionId" TEXT,
      "notes" TEXT,
      "ingredientsJson" TEXT NOT NULL DEFAULT '[]',
      "description" TEXT,
      "instructionsJson" TEXT NOT NULL DEFAULT '[]',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "servings" INTEGER NOT NULL DEFAULT 2,
      "prepTime" INTEGER,
      "cookTime" INTEGER,
      "cuisine" TEXT,
      "servingsOverride" INTEGER,
      "recipeId" TEXT,
      "photoDataUrl" TEXT,
      "photoPath" TEXT,
      "photoMimeType" TEXT,
      "photoFileName" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Meal_mealTypeDefinitionId_fkey"
        FOREIGN KEY ("mealTypeDefinitionId") REFERENCES "MealTypeDefinition" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "Meal_mealSubTypeDefinitionId_fkey"
        FOREIGN KEY ("mealSubTypeDefinitionId") REFERENCES "MealSubTypeDefinition" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "Meal_recipeId_fkey"
        FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Meal__rebuild" (
      "id",
      "name",
      "date",
      "mealType",
      "mealTypeDefinitionId",
      "mealSubTypeDefinitionId",
      "notes",
      "ingredientsJson",
      "description",
      "instructionsJson",
      "sortOrder",
      "servings",
      "prepTime",
      "cookTime",
      "cuisine",
      "servingsOverride",
      "recipeId",
      "photoDataUrl",
      "photoPath",
      "photoMimeType",
      "photoFileName",
      "createdAt"
    )
    SELECT
      "id",
      "name",
      "date",
      "mealType",
      "mealTypeDefinitionId",
      "mealSubTypeDefinitionId",
      "notes",
      COALESCE("ingredientsJson", '[]'),
      "description",
      COALESCE("instructionsJson", '[]'),
      CASE
        WHEN typeof("sortOrder") = 'integer' THEN "sortOrder"
        WHEN typeof("sortOrder") = 'text' AND trim(CAST("sortOrder" AS TEXT)) GLOB '-?[0-9]*'
          THEN CAST("sortOrder" AS INTEGER)
        ELSE 0
      END,
      COALESCE("servings", 2),
      "prepTime",
      "cookTime",
      "cuisine",
      "servingsOverride",
      "recipeId",
      "photoDataUrl",
      "photoPath",
      "photoMimeType",
      "photoFileName",
      COALESCE("createdAt", CURRENT_TIMESTAMP)
    FROM "Meal__legacy_sort_order_fix"
  `);
  await prisma.$executeRawUnsafe(`DROP TABLE "Meal__legacy_sort_order_fix"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Meal__rebuild" RENAME TO "Meal"`);
}

async function repairBrokenMealSortOrderColumn() {
  if (!(await mealSortOrderColumnNeedsRepair())) {
    return;
  }

  await rebuildMealTable();
}

async function getIntegrityMessages() {
  const rows = await prisma.$queryRawUnsafe<IntegrityCheckRow[]>(
    `PRAGMA integrity_check`
  );

  return rows
    .map((row) => row.integrity_check ?? row.quick_check ?? "")
    .filter((message) => message.length > 0);
}

async function repairMalformedMealSubTypeIndex() {
  const integrityMessages = await getIntegrityMessages();
  const hasMealSubTypeIndexIssue = integrityMessages.some((message) =>
    message.includes("Meal_mealSubTypeDefinitionId_idx")
  );

  if (!hasMealSubTypeIndexIssue) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "Meal_mealSubTypeDefinitionId_idx"`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Meal_mealSubTypeDefinitionId_idx" ON "Meal"("mealSubTypeDefinitionId")`
  );

  const remainingMessages = await getIntegrityMessages();
  const unresolvedIndexIssue = remainingMessages.find((message) =>
    message.includes("Meal_mealSubTypeDefinitionId_idx")
  );

  if (unresolvedIndexIssue) {
    throw new Error(
      `Schema reconciliation could not repair malformed Meal sub-type index: ${unresolvedIndexIssue}`
    );
  }
}

async function reconcileRecipeIdentityColumns() {
  const recipes = await prisma.$queryRawUnsafe<RecipeIdentityRow[]>(
    `SELECT "id", "title", "sourceUrl", "sourceLabel", "normalizedTitle", "normalizedSourceUrl" FROM "Recipe" ORDER BY "createdAt" ASC, "id" ASC`
  );

  const usedTitles = new Set<string>();
  const usedSourceUrls = new Set<string>();

  for (const recipe of recipes) {
    const baseTitle = sanitizeRecipeTitle(recipe.title) || "Untitled Recipe";
    let nextTitle = baseTitle;
    let nextNormalizedTitle = normalizeRecipeTitle(nextTitle);
    let copyNumber = 1;

    while (!nextNormalizedTitle || usedTitles.has(nextNormalizedTitle)) {
      copyNumber += 1;
      nextTitle = buildDuplicateRecipeTitle(baseTitle, copyNumber);
      nextNormalizedTitle = normalizeRecipeTitle(nextTitle);
    }

    usedTitles.add(nextNormalizedTitle);

    let nextSourceUrl = recipe.sourceUrl?.trim() || null;
    let canonicalSourceUrl: string | null = null;

    try {
      nextSourceUrl = cleanRecipeSourceUrl(recipe.sourceUrl);
      canonicalSourceUrl = normalizeRecipeSourceUrl(nextSourceUrl);
    } catch (error) {
      console.warn(
        `[recipe-identity] Unable to normalize legacy source URL for recipe ${recipe.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const nextNormalizedSourceUrl =
      canonicalSourceUrl && !usedSourceUrls.has(canonicalSourceUrl)
        ? canonicalSourceUrl
        : null;

    if (nextNormalizedSourceUrl) {
      usedSourceUrls.add(nextNormalizedSourceUrl);
    } else if (canonicalSourceUrl) {
      console.warn(
        `[recipe-identity] Duplicate canonical source URL for recipe ${recipe.id}; preserving display URL and clearing normalized identity.`
      );
    }

    let nextSourceLabel = recipe.sourceLabel?.trim() || null;
    if (!nextSourceLabel && nextSourceUrl) {
      try {
        nextSourceLabel = new URL(nextSourceUrl).hostname.replace(/^www\./, "");
      } catch {
        nextSourceLabel = null;
      }
    }

    if (
      nextTitle === recipe.title &&
      nextNormalizedTitle === recipe.normalizedTitle &&
      nextSourceUrl === recipe.sourceUrl &&
      nextNormalizedSourceUrl === recipe.normalizedSourceUrl &&
      nextSourceLabel === recipe.sourceLabel
    ) {
      continue;
    }

    await prisma.$executeRaw`
      UPDATE "Recipe"
      SET
        "title" = ${nextTitle},
        "normalizedTitle" = ${nextNormalizedTitle},
        "sourceUrl" = ${nextSourceUrl},
        "normalizedSourceUrl" = ${nextNormalizedSourceUrl},
        "sourceLabel" = ${nextSourceLabel}
      WHERE "id" = ${recipe.id}
    `;
  }
}
async function dropRecipeIdentityIndexes() {
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "Recipe_normalizedTitle_key"`
  );
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "Recipe_normalizedSourceUrl_key"`
  );
}

async function ensureRecipeIdentityIndexes() {
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_normalizedTitle_key" ON "Recipe"("normalizedTitle")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_normalizedSourceUrl_key" ON "Recipe"("normalizedSourceUrl")`
  );
}

export async function ensureDatabaseSchema(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await prisma.$executeRawUnsafe(statement);
  }

  const safeMealAlterStatements = {
    mealTypeDefinitionId: `ALTER TABLE "Meal" ADD COLUMN "mealTypeDefinitionId" TEXT`,
    mealSubTypeDefinitionId: `ALTER TABLE "Meal" ADD COLUMN "mealSubTypeDefinitionId" TEXT`,
    description: `ALTER TABLE "Meal" ADD COLUMN "description" TEXT`,
    instructionsJson: `ALTER TABLE "Meal" ADD COLUMN "instructionsJson" TEXT NOT NULL DEFAULT '[]'`,
    sortOrder: `ALTER TABLE "Meal" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0`,
    servings: `ALTER TABLE "Meal" ADD COLUMN "servings" INTEGER NOT NULL DEFAULT 2`,
    prepTime: `ALTER TABLE "Meal" ADD COLUMN "prepTime" INTEGER`,
    cookTime: `ALTER TABLE "Meal" ADD COLUMN "cookTime" INTEGER`,
    cuisine: `ALTER TABLE "Meal" ADD COLUMN "cuisine" TEXT`,
    servingsOverride: `ALTER TABLE "Meal" ADD COLUMN "servingsOverride" INTEGER`,
    recipeId: `ALTER TABLE "Meal" ADD COLUMN "recipeId" TEXT`,
    photoDataUrl: `ALTER TABLE "Meal" ADD COLUMN "photoDataUrl" TEXT`,
    photoPath: `ALTER TABLE "Meal" ADD COLUMN "photoPath" TEXT`,
    photoMimeType: `ALTER TABLE "Meal" ADD COLUMN "photoMimeType" TEXT`,
    photoFileName: `ALTER TABLE "Meal" ADD COLUMN "photoFileName" TEXT`,
  } as const;

  const safeMealTypeProfileAlterStatements = {
    color: `ALTER TABLE "MealTypeProfile" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#3B5E45'`,
  } as const;

  const safeMealTypeDefinitionAlterStatements = {
    cutoffTime: `ALTER TABLE "MealTypeDefinition" ADD COLUMN "cutoffTime" TEXT`,
  } as const;

  const safeRecipeAlterStatements = {
    normalizedTitle: `ALTER TABLE "Recipe" ADD COLUMN "normalizedTitle" TEXT`,
    normalizedSourceUrl: `ALTER TABLE "Recipe" ADD COLUMN "normalizedSourceUrl" TEXT`,
    favourite: `ALTER TABLE "Recipe" ADD COLUMN "favourite" INTEGER NOT NULL DEFAULT 0`,
    cuisine: `ALTER TABLE "Recipe" ADD COLUMN "cuisine" TEXT`,
    sourceRecipeId: `ALTER TABLE "Recipe" ADD COLUMN "sourceRecipeId" TEXT REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  } as const;

  const safeRecipeIngredientAlterStatements = {
    group: `ALTER TABLE "RecipeIngredient" ADD COLUMN "group" TEXT`,
    quantityNumerator: `ALTER TABLE "RecipeIngredient" ADD COLUMN "quantityNumerator" INTEGER`,
    quantityDenominator: `ALTER TABLE "RecipeIngredient" ADD COLUMN "quantityDenominator" INTEGER`,
    parseConfidence: `ALTER TABLE "RecipeIngredient" ADD COLUMN "parseConfidence" TEXT`,
    parseRaw: `ALTER TABLE "RecipeIngredient" ADD COLUMN "parseRaw" TEXT`,
  } as const;

  const safePrepListAlterStatements = {
    notes: `ALTER TABLE "PrepList" ADD COLUMN "notes" TEXT`,
  } as const;

  const safeUserPreferenceAlterStatements = {
    autoReviewPantry: `ALTER TABLE "UserPreference" ADD COLUMN "autoReviewPantry" INTEGER NOT NULL DEFAULT 1`,
  } as const;

  const safePantryItemAlterStatements = {
    dailyUsageQuantity: `ALTER TABLE "PantryItem" ADD COLUMN "dailyUsageQuantity" REAL`,
    dailyUsageUnit: `ALTER TABLE "PantryItem" ADD COLUMN "dailyUsageUnit" TEXT`,
    dailyUsageWarningDays: `ALTER TABLE "PantryItem" ADD COLUMN "dailyUsageWarningDays" INTEGER`,
  } as const;

  await ensureMissingColumns("Meal", safeMealAlterStatements);
  await ensureMissingColumns("MealTypeProfile", safeMealTypeProfileAlterStatements);
  await ensureMissingColumns("MealTypeDefinition", safeMealTypeDefinitionAlterStatements);
  await prisma.$executeRawUnsafe(`
    UPDATE "MealTypeDefinition"
    SET "cutoffTime" = CASE "slug"
      WHEN 'BREAKFAST' THEN '10:00'
      WHEN 'MORNING_SNACK' THEN '11:30'
      WHEN 'LUNCH' THEN '14:00'
      WHEN 'AFTERNOON_SNACK' THEN '17:00'
      WHEN 'DINNER' THEN '21:00'
      ELSE '23:59'
    END
    WHERE "cutoffTime" IS NULL
  `);
  await ensureMissingColumns("Recipe", safeRecipeAlterStatements);
  await ensureMissingColumns("RecipeIngredient", safeRecipeIngredientAlterStatements);
  await ensureMissingColumns("PrepList", safePrepListAlterStatements);
  await ensureMissingColumns("UserPreference", safeUserPreferenceAlterStatements);
  await ensureMissingColumns("PantryItem", safePantryItemAlterStatements);
  await repairBrokenMealSortOrderColumn();
  await repairMalformedMealSubTypeIndex();
  await normalizeMealSortOrderValues();
  await dropRecipeIdentityIndexes();
  await reconcileRecipeIdentityColumns();
  await ensureRecipeIdentityIndexes();
}