# Pantry UI Spec

## Purpose

Define the baseline UI structure for the new Pantry page. The first version should feel familiar to users of Grocery Lists and Prep Lists by reusing their page rhythm, density, selection model, controls, and responsive behavior.

This document defines the baseline information architecture and interaction surfaces. It does not finalize visual styling, detailed component APIs, or the final Pantry page layout.

## Design Direction

- Reuse the existing Grocery Lists and Prep Lists page patterns wherever the workflow is similar.
- Keep the page data-first and operational: users should be able to see what needs attention and update stock quickly.
- Place current inventory statistics near the top of the page so the Pantry page is useful at a glance.
- Keep long-term analysis on the Stats page; the Pantry page should focus on current state and immediate actions.
- Use the existing design system, shared `PageHeader`, shared buttons, tooltips, modal behavior, semantic theme tokens, and responsive list-page styles.

## Baseline Page Structure

```text
PageHeader
  Pantry
  Track household ingredients and supplies that are kept on hand.
  [Add item] [Optional: filter or settings action]

Current inventory summary
  [Tracked items] [Low stock] [Empty] [Expiring soon] [Expired]

Pantry workspace
  Quick filters / search / sort controls
  Left: pantry item collection and attention filters
  Right: selected item editor

Empty and loading states
Error and retry states
Responsive mobile layout
```

The desktop page should use the same broad two-pane model as Grocery Lists and Prep Lists: a collection/sidebar area on the left and a detail/editor area on the right. On smaller screens, the collection and editor should become a predictable single-column flow with an explicit way to return to the item collection.

## Page Header

Use the shared `PageHeader` component.

- Eyebrow: `Pantry`
- Title: `Pantry`
- Subtitle: a short explanation that the page tracks household ingredients and supplies kept on hand
- Primary action: `Add item`
- Optional secondary action: open Pantry settings or management tools if that action is needed outside the selected-item editor

The primary action should open the reusable `PantryManagementModal` or a focused create-item flow that uses the same modal foundation.

## Current Inventory Summary

Place a compact summary row directly below the page header and above the main workspace.

Required first-release metrics:

- Tracked items
- Low-stock items
- Empty items
- Expiring soon
- Expired

Interaction expectations:

- Each metric should be readable as a current count, not a long-term trend.
- Low-stock, empty, expiring-soon, and expired metrics should act as filters or links into the relevant Pantry view.
- `Tracked items` should represent the current Pantry inventory scope consistently across the summary and collection count. Always-available items remain part of Pantry even when they do not have a numeric quantity.
- Zero states should remain useful and should not look like an error.
- Summary metrics should remain compact on narrow screens and wrap without overlapping.

Use a compact responsive stat row rather than full dashboard cards or a segmented control. The row should use existing KPI patterns where available, remain visually lighter than the Stats page, and make the low-stock, empty, expiring-soon, and expired metrics keyboard-accessible filters.

## Pantry Collection and Filters

The left side of the workspace should follow the collection behavior of `ListsSidebar` while adapting its rows to inventory state.

### Collection header

- Title: `All items`
- Count: number of Pantry items in the current scope
- Always-visible search input, including on narrow layouts
- Add-item action may be repeated here on narrow or dense layouts if it improves reachability

### Quick filters

The baseline filter set should include:

- All items
- Low stock
- Empty
- Expiring soon
- Expired
- Always available
- Track quantity
- Replenish to target
- Recent updates

Use a fixed quick-filter list following the treatment already used by Grocery Lists and Prep Lists. Keep all nine baseline filters directly reachable; the selected filter must be visibly identified and keyboard accessible.

### Search and sorting

Search should match:

- Display name
- Normalized ingredient identity
- User-managed aliases
- Category
- Storage location

Baseline sort options:

- Attention first
- Recently updated
- Name
- Category
- Storage location
- Expiration date

Sorting must not mutate the user's underlying item order unless a later decision explicitly adds manual ordering.

### Pantry item row

Use dense two-line collection rows so inventory remains scannable without opening every item:

- Item name
- Current stock summary, such as `2 kg`, `8 filters`, or `Always available`
- Storage location when relevant
- Text status badge or severity label for low, empty, expiring, or expired state; color must not be the only status signal
- Expiration summary when relevant
- Last-updated or other compact metadata
- Selection state

Avoid putting every editable field in the row. The row should support selection and quick attention scanning; detailed changes belong in the editor or modal.

## Selected Pantry Item Editor

The right side should use the same focused editor role as `ListEditor` and the Prep Lists editor.

### Editor header

- Item name as the primary heading
- Current status and severity
- Storage location and last-updated metadata
- Actions for edit, duplicate to another storage location, and delete
- A prominent quick stock action area

### Quick stock actions

Provide fast actions for the common inventory workflow:

- Add stock
- Use stock
- Set exact quantity
- Mark empty
- Add or review a dated lot

Actions should open a focused form or the reusable `PantryManagementModal` when additional context is needed. Confirm destructive or potentially ambiguous changes.

### Stock overview

Show the current state before configuration details:

- Current quantity by location
- Base unit
- Package-equivalence summary when configured
- Stock mode: `Always available`, `Track quantity`, or `Replenish to target`
- Low-stock and critical thresholds
- Replenishment target and package suggestion when applicable

Show current stock by location first. For items with multiple locations, use expandable location sections; place that location's dated lots inside the section. Surface the earliest-expiring usable lot in the summary and clearly identify it in the expanded lot list.

### Item details

Provide editable fields for:

- Display name
- Normalized ingredient identity
- Aliases
- Category
- Storage location
- Stock mode
- Quantity and unit
- Warning thresholds and severities
- Expiration warning window
- Package equivalences, managed as repeatable package rows with a label, numeric quantity, canonical unit, and confirmation state
- Optional notes

Keep advanced configuration collapsed or separated from quick stock actions so routine updates remain fast. The default editor view should show stock overview and quick actions first, followed by the main item details; locations, dated lots, warnings, and package equivalences can be expanded as needed.

### Attention and explanation states

The editor should explain why an item needs attention:

- Low or critical stock
- Empty inventory
- Expiring soon
- Expired lot
- Approximate quantity
- Incompatible recipe or Pantry unit
- Unconfirmed fuzzy match
- Package equivalence requiring confirmation

These states should include a direct next action where possible, such as adding the item to a grocery list, editing the unit relationship, or reviewing a dated lot.

## PantryManagementModal

`PantryManagementModal` is a reusable interaction surface available from the Pantry page, Grocery List completion, Dashboard attention actions, and other future pages.

The modal should support two related modes:

### General management mode

- Create a Pantry item
- Edit an existing item
- Adjust stock
- Manage locations and dated lots
- Configure warnings and package equivalences
- Add or edit aliases

### Grocery update review mode

- Show proposed Pantry matches from a completed grocery list
- Show purchased quantity prefilled from the grocery-list quantity
- Allow actual purchased quantity correction
- Show approximate, incompatible, unmatched, or ambiguous comparisons
- Allow the user to match an existing item, create a new item, or skip an update
- Confirm the resulting stock additions before saving

The modal must use the shared `ModalShell` behavior for focus management, Escape handling, overlay behavior, labels, and responsive sizing.

Package-equivalence editing should use a repeatable row list inside the modal. Each row should support inline add, edit, and remove actions for a named package, numeric quantity, and canonical unit. Validate dimension compatibility with the item's base unit and require explicit confirmation before a relationship affects grocery calculations. Edits apply only to future stock actions and grocery calculations.

## Empty, Loading, Error, and No-Match States

### Loading

- Preserve the page header and summary structure where possible.
- Use stable skeleton dimensions so the page does not shift when inventory loads.

### Empty Pantry

- Explain that no Pantry items have been added yet.
- Provide a primary `Add item` action.
- Mention migration of existing pantry staples only when that migration is relevant to the current state.

### No filter or search matches

- Explain that no items match the current search or filter.
- Provide a clear way to clear the search or return to `All items`.
- Do not imply that the Pantry is empty when it only has no matches.

### Error

- Use the existing route error pattern and provide a retry action.
- Keep cached or already selected inventory visible when safe to do so.

## Responsive Behavior

Desktop:

- Keep summary metrics above the two-pane workspace.
- Preserve a usable minimum width for the collection/sidebar and selected-item editor.
- Keep the selected item visible while editing.

Mobile:

- Stack the summary metrics into a responsive row or grid without horizontal overflow.
- Show collection and selected item as separate logical views or stacked sections.
- Make the selected-item heading and a back-to-items action obvious when the editor occupies the full viewport.
- Keep primary actions reachable without requiring precise gestures.
- Ensure modal forms scroll within the modal body and preserve accessible focus order.

## Accessibility Baseline

- Use semantic headings and landmarks for the page header, summary, collection, and selected-item editor.
- Every icon-only action requires an accessible label and a tooltip where the icon is unfamiliar.
- Selected rows and active filters must expose state through semantics such as `aria-current` or `aria-pressed` where appropriate.
- Status colors must be paired with text or an icon; color alone cannot communicate low, empty, expiring, or expired state.
- Quantity inputs must have explicit labels, units, validation messages, and clear handling for approximate values.
- Modal workflows must preserve focus, support keyboard navigation, and announce validation or save errors.
- Ensure summary metrics, rows, badges, controls, and intermediate panels remain distinguishable in light, dark, and custom themes.

## Reuse and Ownership Notes

The baseline should reuse these existing patterns and primitives:

- `PageHeader` for the page header
- Grocery Lists and Prep Lists two-pane workspace structure
- Grocery list quick filters and collection-row density
- `ListEditor`-style selected-item editor behavior
- `ModalShell` for `PantryManagementModal`
- Existing shared button, tooltip, icon, error, and query-state patterns
- Existing semantic theme tokens and responsive page styles

Likely new Pantry-owned surfaces will include:

- Pantry page entry point
- Pantry collection/sidebar
- Pantry summary metrics
- Pantry item editor
- `PantryManagementModal`
- Pantry-specific row, status, lot, and package-equivalence components

## Resolved UI Decisions

The following decisions close the open UI choices for the first Pantry implementation:

- Use a compact responsive stat row for the five current-inventory metrics. Attention metrics act as keyboard-accessible filters; the row remains lighter than the Stats page.
- Keep search always visible, including on narrow layouts. Search matches display name, normalized ingredient identity, aliases, category, and storage location.
- Use a fixed quick-filter list with all nine baseline filters directly reachable and the active filter visibly identified.
- Use dense two-line collection rows with text status badges or labels. Status colors may reinforce but must not replace text or icon semantics.
- Organize multiple locations as expandable location sections with dated lots nested inside each location. Surface the earliest-expiring usable lot in the stock summary.
- Use repeatable package-equivalence rows in `PantryManagementModal`, with validation and explicit confirmation before calculations use a relationship.
- Use a sectioned selected-item editor. Keep stock overview and quick actions prominent; collapse advanced configuration by default.
- For the future Pantry section on the Stats page, use KPI or ranked summaries plus trend charts, with a selectable analysis period and clearly labeled estimate/data-quality information when history is limited.

Remaining implementation details are intentionally outside this UI decision round: exact component APIs, the final responsive breakpoints, archive field names, unresolved-conflict persistence, and the detailed chart library or visual treatment on the Stats page.

## Current-State References

- Grocery page entry point: `src/renderer/pages/grocery-list.tsx`
- Grocery collection/sidebar: `src/renderer/components/grocery-list/ListsSidebar.tsx`
- Grocery selected-item editor: `src/renderer/components/grocery-list/ListEditor.tsx`
- Grocery creation flow: `src/renderer/components/grocery-list/NewListModal.tsx`
- Prep page entry point: `src/renderer/pages/prep-lists.tsx`
- Shared modal foundation: `src/renderer/components/ui/ModalShell.tsx`
- Shared page header: `src/renderer/components/ui/PageHeader.tsx`
- Existing list-page styling: `src/renderer/components/grocery-list/grocery-list.module.css`
- Design system: `docs/STYLE-GUIDE.md`
- Product and data behavior: `docs/plans/pantry/pantry-spec.md`
