# Pantry

Pantry is the inventory workspace for ingredients and household supplies kept on hand. It supports items such as flour, olive oil, coffee filters, and other recurring supplies that should be available when planning meals or shopping.

## Where to find it

Open **Pantry** from the application navigation. The page provides:

- A summary of tracked, low-stock, empty, expiring-soon, and expired items.
- Search across item names, aliases, categories, and storage locations.
- Filters for inventory status, stock mode, recent updates, and forecast attention.
- Sorting by recent updates, name, category, or status.
- A collection of items and a selected-item editor on desktop, with a single-column flow on narrow screens.

Existing pantry staples from Settings are migrated into Pantry as `Always available` items. Migrated items retain their grocery-list exclusion behavior and are labeled so they can be reviewed.

## Stock modes

Each item uses one of these modes:

- **Always available** — the item is kept on hand and is skipped when grocery requirements are generated.
- **Track quantity** — the available quantity is recorded and compared with recipe requirements.
- **Replenish to target** — the available quantity is compared with a target level and the missing amount can be suggested for purchase.

Stock can be maintained separately by storage location. The editor supports direct stock actions, package purchases, exact quantity corrections, marking an item empty, and dated lots with optional best-before and expiration dates.

## Units and packages

Pantry uses the application's canonical recipe units and exact compatible conversions. Compatible mass and volume units can be compared safely; custom units remain labels unless an explicit item-specific package relationship is configured.

Package equivalences can describe purchases such as one box, bag, or bottle. A package relationship must be confirmed before it affects stock entry or grocery suggestions. Package edits apply to future actions and do not rewrite existing stock or history.

Approximate or incompatible quantities are preserved for review rather than silently converted or subtracted.

## Grocery lists

Grocery generation is calculation-only: it does not reserve, consume, or otherwise change Pantry quantities.

- Always-available matches are skipped.
- Safely comparable tracked stock is subtracted from recipe requirements.
- If stock covers the requirement, no grocery item is added.
- If stock is insufficient, the missing amount is added and a whole-package suggestion may be shown.
- Approximate, incompatible, ambiguous, or unmatched items keep the full requirement and include an explanation for review.

After completing a grocery list, the Pantry review flow can propose stock additions from purchased quantities. Reviewers can correct the quantity, match an existing item, create a new item, or skip the update before anything is written to inventory.

## Daily usage forecasts

An item can optionally define an expected daily usage quantity, its unit, and a warning lead time in days. Pantry calculates an estimated number of days remaining from compatible, non-approximate stock across locations and can show an estimated run-out date.

Forecasts are estimates, not historical consumption measurements. A forecast is unavailable when daily usage is not configured, stock is missing, stock is approximate, units are incompatible, or all usable stock is expired. Forecast attention appears in Pantry and Home; the Stats page remains focused on historical inventory events rather than configured forecasts.

## Warnings and history

Pantry can surface low stock, empty stock, expiring lots, expired lots, and daily-usage forecast attention. Inventory actions are retained as events, including additions, consumption, discards, empty marks, corrections, and imported baselines.

Use the Pantry editor to configure warning thresholds, expiration warning windows, replenishment targets, aliases, locations, package equivalences, and dated lots. Statuses are shown with text as well as color so attention states remain understandable when color is unavailable.

## Data management

Pantry data is included in `all` `.lrb` archives. State-only exports preserve current items, locations, lots, packages, aliases, thresholds, and daily-usage settings while omitting event history. Full-history exports also include inventory events.

Imports support validation, merge, and replace workflows. Same-location quantity conflicts require review; separate locations remain separate. Imports without history create an imported-baseline event so the missing history is explicit. See [Data Management](data-management.md) for archive limits, conflict decisions, recovery behavior, and browser limitations.

## Implementation boundary

Pantry follows the normal renderer-to-server flow:

```text
React page and query
  -> typed HTTP API
  -> Hono Pantry routes
  -> PantryService and domain calculations
  -> Prisma and SQLite
```

The service owns matching, compatible-unit comparison, stock mutation, event history, status evaluation, and forecast calculation. The renderer formats typed results and does not access SQLite or implement inventory business rules. Use the existing shared unit contracts and conversion primitives when changing Pantry behavior.
