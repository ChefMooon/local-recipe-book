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

### Attention and grocery links

Pantry keeps inventory status and presentation attention separate. An item can remain `low` or `empty` while its stock or numeric forecast attention is muted. Expiring-soon, expired, and unavailable or data-quality forecast attention remains visible and cannot be hidden by these controls.

- **Snooze 7 days** hides eligible stock and numeric forecast attention for exactly seven days, then restores it automatically.
- **Until restocked** remains active until usable quantity increases by a positive amount. A reduction or unchanged quantity does not clear it; partial additions clear it even when the item remains below its warning threshold.
- **Add to grocery list** creates or links one exact grocery item on the deterministic current list. If no ongoing list exists, the action creates an ongoing `Pantry Restock` list. Names are not used to match Pantry items to grocery items.

An active linked grocery item represents shopping intent, not purchased stock. Checking, removing, deleting, skipping, or failing a grocery review restores eligible Pantry attention without changing quantity. Only the existing Pantry completion review applies purchased stock; after that review, the link is closed and attention is recalculated from the resulting inventory.

The editor always exposes the raw status and provides **Restore attention** for a muted item. Attention state survives reloads and is removed or re-evaluated when the Pantry item, warning rules, stock mode, or stock data changes. Recreated records do not inherit state from a deleted record because associations use stable IDs.

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
