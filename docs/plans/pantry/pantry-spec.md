# Pantry Spec

## Brainstorm

- [ ] Create a new `Pantry` page
	- [ ] Remove pantry staples from the settings page
	- [ ] Make sure data migrates properly
- [ ] New functionality to:
	- [ ] Add items that are always available or more bulk items. these items should be recognized when creating grocery lists. not sure if any other pages would benefit from this information
	- [ ] I want to be able to add things like Coffee filters. I know i use 1 a day. i would like to be able to set the amount and it should surface at the top of the page when the item is getting low. we should be able to set different quantities for things like flour so options are : count, kgs? we should be able to set when a warning will appear, multiple warnings, and the severity.
	- [ ] We will need a new dashboard widget
	- [ ] Can we get new statistics from this data?

## High-Level Pantry Feature Overview

The Pantry feature would give the application a dedicated place to track household items that are kept on hand, including pantry staples, bulk ingredients, and recurring non-recipe supplies such as coffee filters.

At a high level, the feature would include:

- A dedicated Pantry page for viewing and managing items that are regularly available.
- A migration path for existing pantry staples currently stored in Settings.
- Pantry-aware grocery list creation, so items already available can be recognized when determining what needs to be purchased.
- Optional quantity tracking for items that are consumed over time, with support for count-based and measurement-based quantities where appropriate.
- Configurable low-stock warnings that can surface items near or below a user-defined threshold, potentially with multiple warning levels and severities.
- A dashboard widget that summarizes pantry status and highlights items needing attention.
- Pantry-related statistics that help users understand usage and inventory trends over time.

The detailed data model, supported units, warning rules, affected pages, and exact statistics remain open decisions for a later specification and implementation plan.

## First-Release Scope

The first release should extend the existing pantry-staple behavior into a more useful inventory feature while preserving the current grocery-list workflow. The Pantry page layout and visual organization are intentionally left open for a later design decision.

### Pantry management

- Provide a dedicated Pantry page for adding, editing, removing, searching, filtering, and sorting pantry items.
- Support useful item categories such as baking, canned goods, beverages, and household supplies.
- Allow optional storage locations such as pantry, refrigerator, freezer, or cupboard.
- Support both food ingredients and recurring non-food supplies such as coffee filters.
- Provide explicit stock modes named `Always available`, `Track quantity`, and `Replenish to target`.
- Provide quick actions to add stock, use stock, mark an item empty, or set an exact quantity.
- Record when an item's quantity was last updated.
- Allow separate stock records for the same normalized item in different locations.

### Quantities, matching, and grocery lists

- Reuse the current pantry-staple exclusion behavior when generating grocery lists.
- Preserve the ability for an always-available pantry staple to be skipped entirely.
- When a pantry item tracks a quantity, make grocery-list generation aware of the available amount and use it when determining what needs to be purchased.
- Define quantity-aware behavior so a recipe requirement can be compared with available stock and, where appropriate, only the missing amount is added to the grocery list.
- Support count-based and measurement-based quantities with compatible units.
- Support count, mass, volume, and user-defined units. User-defined units should be labels only unless an explicit conversion is configured.
- Expose all existing canonical recipe units in Pantry, including the application's volume, mass, and count units and their supported aliases.
- Allow decimal and approximate quantities, including fractional measurements while preserving the meaning of discrete count-based items.
- Reuse the application's existing recipe conversion table and implementation for canonical units, aliases, exact mass and volume base conversions, and count units rather than creating a separate Pantry conversion system.
- Use only known, compatible unit conversions when comparing or subtracting quantities; do not guess conversions. Do not use the existing approximate ingredient-density conversions to subtract Pantry stock automatically.
- Support explicit count conversions and package equivalences configured per Pantry item, such as a box containing a known number of filters or a bag containing a known mass.
- Allow each Pantry item to define multiple named package sizes, each with a package label, numeric quantity, and canonical unit.
- Use package equivalences for both manual stock entry and grocery suggestions. Stock entered as packages should convert to the item's base quantity, while grocery review should show the exact shortfall and a whole-package suggestion.
- Require package quantities to be dimension-compatible with the item's base unit and require user confirmation before a package relationship affects grocery calculations.
- Apply package-equivalence edits only to future stock actions and grocery calculations; do not rewrite existing stock or historical events.
- Support normalized ingredient identities, user-managed aliases, and fuzzy-match suggestions for likely matches.
- Fuzzy matches should always be suggestions requiring user confirmation; there should be no automatic confidence threshold that silently applies them.
- Define behavior for incompatible units, approximate quantities, duplicate items, and ingredients that only partially match a pantry item.

### Grocery list and pantry update logic

- Grocery-list generation should calculate requirements from the current pantry state without reserving, consuming, or otherwise changing pantry quantities.
- Always-available pantry items should continue to be skipped entirely, reusing the current pantry-staple exclusion behavior.
- For quantity-tracked items, compare the recipe requirement with the usable pantry quantity and add only the missing amount to the grocery list.
- If the pantry quantity meets or exceeds the recipe requirement, do not add that ingredient to the grocery list.
- If the recipe and pantry units cannot be safely compared, do not subtract the pantry quantity; preserve the full grocery requirement for user review.
- If either quantity is approximate, do not subtract Pantry stock automatically. Preserve the full grocery requirement and explain the limitation during post-generation grocery review, with a path to configure the item or package relationship in `PantryManagementModal`.
- Items configured for replenishment should support both a target level and a configured package or restock quantity. When a package relationship applies, show the exact shortfall alongside a suggestion for the number of whole packages needed; do not silently round away the exact requirement.
- Completing a grocery list should provide a user-controlled way to update pantry quantities. The default behavior should open the review modal automatically, with an optional user preference to disable the prompt and use manual updates instead.
- The post-completion review should prefill proposed pantry additions from grocery-list quantities and allow users to adjust the actual purchased quantity before saving.
- Unmatched or ambiguous grocery items should be shown for manual review, where the user can match an existing pantry item, create a new item, or skip the update.
- Introduce a reusable `PantryManagementModal` that can be opened from the grocery-list completion flow and other pages. It should support both reviewing proposed grocery-related updates and broader pantry management actions.

### Warnings and expiration

- Support multiple configurable warning thresholds and severities per item, including low-stock and critical-stock levels where needed.
- Surface low-stock and empty items prominently on the Pantry page.
- Track optional best-before or expiration dates as part of separate dated lots, allowing one Pantry item to have multiple quantities with different dates.
- Allow each item to define its own expiring-soon warning window. An item is expired as soon as its date has passed.
- Consume the earliest-expiring usable lot first when stock is reduced automatically through a confirmed pantry update.
- Surface items that are expiring soon or already expired without requiring expiration dates for non-food supplies.
- Make warnings actionable where appropriate, including a path to add replenishment items to a grocery list.

### Dashboard, history, and statistics

- Add a dashboard widget showing pantry items that are low, empty, expiring soon, or otherwise need attention.
- Link the dashboard widget to the relevant Pantry view and actions.
- Retain full inventory event history, including stock added, stock consumed, items discarded, items marked empty, and manual quantity corrections.
- Show current inventory status on the Pantry page and Dashboard widget.
- Add a user-facing summary statistics area at the top of the Pantry page with immediate metrics such as total tracked items, low-stock items, empty items, expiring-soon items, and expired items.
- Keep Pantry-page statistics focused on current inventory state and actionable attention items rather than long-term analysis.
- Add a Pantry section to the Stats page with longer-term consumption rate and frequently depleted item statistics.
- When history is limited, show partial statistics as clearly labeled estimates with the applicable history window and a data-quality or confidence indicator.
- Let users choose the analysis period for Pantry trends and statistics.
- Present the first Pantry statistics section with both KPI or ranked summaries and trend charts.

### Compatibility and data management

- Migrate existing pantry staples from Settings into the Pantry feature without losing their names, ordering, or grocery-list exclusion behavior.
- Update the export and import features to include Pantry data, including item details, quantities, stock modes, thresholds, expiration dates, aliases, and relevant inventory history.
- Allow the user to choose whether an export includes full inventory history or current Pantry state only.
- During import, allow the user to choose whether Pantry data replaces existing records or merges with them.
- During merge imports, show a grouped conflict-review screen organized by item, location, lot, aliases, and settings.
- For each conflict, allow the user to keep the existing value, use the imported value, merge compatible values, or skip the field or record.
- Require explicit review before resolving same-location quantity conflicts; do not add or replace those quantities automatically. Keep records separate when they represent different storage locations.
- Deduplicate imported inventory events by event identity while preserving non-duplicate local and imported history.
- Import non-conflicting data even when some conflicts remain unresolved, retain those unresolved conflicts for later review, and make the partial result visible to the user.
- Store Pantry data in a dedicated versioned export section while retaining legacy pantry-staple fields during the transition for compatibility.
- If an export omits inventory history, import the current Pantry state and record a single imported-baseline event containing the import time, source archive, source version, and imported quantities so the lack of prior history is explicit.
- Use the existing overall archive version for Pantry data rather than introducing an independent Pantry schema version.
- Include the complete Pantry state in the dedicated section: items, locations, stock modes, aliases, thresholds, package equivalences, dated lots, expiration data, and inventory events when history is included.
- Mark state-only exports explicitly as omitting inventory history.
- Ignore unknown Pantry fields during import while preserving all recognized data so future archive fields do not invalidate an otherwise usable import.
- Preserve compatibility with existing data-management archive export and restore flows, including safe handling of archives created before Pantry data existed.
- Handle duplicate, empty, malformed, or otherwise invalid legacy pantry-staple values safely during migration.
- For older archives that contain only pantry staples, pre-map each staple to an `Always available` Pantry item and let the user confirm or change the mapping during import.
- Keep the current pantry-staple system as the compatibility foundation, extending it rather than replacing it with an unrelated grocery-list path.

## First-Release Decisions and Open Details

- The existing pantry-staple skip behavior is approved for reuse.
- Tracked pantry quantities should be considered when creating grocery lists when a usable quantity is available.
- Grocery-list generation is calculation-only; pantry quantities change through a confirmed post-completion update flow.
- Pantry updates after grocery-list completion should open the review modal automatically by default, with a user preference allowing the prompt to be disabled in favor of manual updates.
- The reusable `PantryManagementModal` should support both grocery-update review and general pantry management.
- Replenishment should support a target level and configured package quantity, showing the exact shortfall and a whole-package suggestion when both are configured.
- Each Pantry item may define multiple confirmed package equivalences with a label, numeric quantity, and canonical unit. Package relationships apply only to future actions.
- Pantry quantities may be tracked separately by storage location, and duplicate items are allowed when their locations differ.
- Matching should use normalized identities and aliases, with fuzzy matches presented as suggestions that require confirmation.
- Stock modes should use the user-facing labels `Always available`, `Track quantity`, and `Replenish to target`.
- Pantry should reuse the existing application conversion table and exact base-unit implementation. Approximate density conversions should not automatically reduce grocery requirements.
- Conversions should support trusted within-mass and within-volume conversions, explicit count conversions, and package equivalences configured per Pantry item without automatic cross-dimension conversion.
- Pantry should expose all existing canonical recipe units and their supported aliases.
- Approximate or incompatible comparisons should be explained in grocery review and provide a path to configure the Pantry item or package relationship.
- Each item should define its own expiration warning window, and dates should become expired immediately after they pass.
- Fuzzy matches should always require confirmation and should never be silently auto-applied.
- Expiration should be tracked per optional dated lot, with earliest-expiring stock consumed first when applicable.
- Full inventory event history should be retained for the first release.
- Current inventory status and user-facing summary statistics should appear at the top of the Pantry page and in the Dashboard widget, while the Stats page should provide longer-term consumption rate and frequently depleted item analysis.
- Partial statistics should be labeled as estimates with their history window and a data-quality or confidence indicator.
- Pantry statistics should support a user-selectable analysis period and use both KPI or ranked summaries and trend charts.
- Exports should let users choose current state only or current state plus full history; imports should let users choose replace or merge and review conflicts.
- Pantry exports should use a dedicated versioned section while retaining legacy pantry-staple fields during transition. Imports without history should create an imported-baseline event with source archive and version metadata.
- Pantry should use the overall archive version, include complete state and optional events, mark omitted history explicitly, and ignore unknown fields during import.
- Merge imports should use a grouped review screen with keep, import, merge, and skip actions; same-location quantities require review, events are deduplicated, and unresolved conflicts may remain after non-conflicting data is imported.
- Legacy pantry staples should be pre-mapped to `Always available` items for user confirmation during import.
- The Pantry page layout is intentionally not specified yet.
- Remaining implementation-planning details include the exact package-equivalence editor controls, archive field names, unresolved-conflict persistence details, and statistics visual details.