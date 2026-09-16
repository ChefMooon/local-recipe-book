# Specification Change Impact Assessment: Pantry Warning Dismissal

## Decision Summary
- Overall disposition: hand off to planning agent
- Confidence: medium
- Scope assessed: Pantry low-stock, empty-stock, expiration, and daily-usage forecast attention; dismissal behavior and the proposed shopping-list action. This assessment does not define the final UI, schema, or API shape.

The overall idea is beneficial for reducing repeated attention signals, provided dismissal changes presentation attention rather than inventory truth. The recommended product direction is a layered approach: make an action-oriented shopping-list flow the primary path, add an explicit until-restocked mute for users who do not want a list item, and offer one short fixed snooze as a bounded escape hatch. Do not hide the underlying stock, expiration, or forecast state, and do not infer pantry relationships from names alone.

## Proposed Changes
### C1: Quick preset snooze
- Intended outcome: Let a user temporarily mute a recurring pantry warning without configuring a date or changing inventory.
- In scope: One or two fixed durations, such as seven days, exposed from the warning or item action surface; persisted dismissal state; automatic return of attention after the duration.
- Out of scope: A custom date picker, deleting or changing inventory, disabling warning rules, or suppressing warnings indefinitely.
- Dependencies: A definition of which warning families can be snoozed and a persisted per-item dismissal record or equivalent field.
- Open assumptions: The preset applies to stock and forecast attention, while expiration and expired warnings remain visible unless explicitly included. The seven-day value is an example, not a settled requirement.

### C2: Until-restocked mute
- Intended outcome: Allow a user to acknowledge an empty or low-stock warning indefinitely while preserving the item as empty or low in the database.
- In scope: A user-controlled mute that survives reloads; automatic unmute when a qualifying stock increase or restock event occurs; continued display of the actual inventory state when the item is inspected.
- Out of scope: Converting an item to `always-available`, changing warning thresholds, deleting history, or treating acknowledgment as proof that stock exists.
- Dependencies: A precise definition of “restocked,” stock mutation events, and warning presentation separate from domain status.
- Open assumptions: For an empty item, adding positive usable stock is the restock trigger. For a low item, the product may either unmute on any increase or only when stock reaches the configured threshold/target; this decision is still material.

### C3: Action-oriented dismissal through the shopping list
- Intended outcome: Give users a concrete next action, such as “Add to Shopping List,” and suppress the related pantry attention while the need is represented in a shopping workflow.
- In scope: A user action from Pantry that creates or links an actionable grocery item; suppression tied to that explicit relationship; a defined lifecycle for active, checked, removed, completed, and purchased items.
- Out of scope: Fuzzy name-based suppression across arbitrary grocery lists, silently changing pantry stock, or assuming that checking an item means it was brought home.
- Dependencies: Current grocery-list selection/creation flows, a stable association between a grocery item and a pantry item, and the existing Pantry completion review that applies purchased stock only after confirmation.
- Open assumptions: The default suppression window is while a linked grocery item remains active and unchecked. If it is checked without a Pantry stock update, the warning should return or the user should be prompted; this must be decided before implementation.

## Clarifications
- Asked and answered: No interactive clarification round was completed because the repository evidence allowed a useful conditional assessment without blocking on product decisions.
- Still needed:
  - Which warning families are dismissible: stock/forecast only, or also expiring-soon and expired warnings?
  - For “until restocked,” does low-stock mute end on any positive quantity increase, or only when quantity reaches the configured warning threshold/replenishment target?
  - Does shopping-list suppression last until the linked item is checked, until Pantry stock is confirmed through the purchase review, or another explicit lifecycle event?
  - Should the action add to the current grocery list, let the user choose a list, or create a new list when none is current?
- Assumptions used for this assessment:
  - Dismissal is presentation state and must not alter `PantryItem.status`, usable quantity, inventory events, forecast calculations, or grocery requirement calculations.
  - Warning status remains inspectable in the Pantry editor even when attention is muted.
  - A grocery item is not proof of purchase; existing Pantry completion review remains the source of stock mutation.
  - The proposed “dismissal” behavior is intended to reduce alert fatigue, not to remove safety-critical expiration information by default.

## Current-State Evidence
- [Pantry documentation](../../pantry.md) states that Pantry surfaces low stock, empty stock, expiring lots, expired lots, and daily-usage forecast attention, while the service owns status evaluation and forecast calculation. It also states that grocery generation is calculation-only and does not mutate Pantry quantities.
- [pantry-service.ts](../../../src/main/server/services/pantry-service.ts) computes `ok`, `low`, `empty`, `expiring-soon`, and `expired` in `getStatus`, and serializes that status directly from current stock and lot data. There is no dismissal or attention-mute input in the current calculation.
- [pantry-forecast.ts](../../../src/main/server/services/pantry-forecast.ts) computes forecast `attention` from remaining days and warning lead time. The forecast is recalculated from current locations and has no persisted acknowledgment state.
- [schema.prisma](../../../prisma/schema.prisma) defines PantryItem warning configuration and inventory relations, but no snooze, muted-until, acknowledgment, or Pantry-to-GroceryItem relation. Grocery items currently contain name, quantity, unit, category, notes, meal, and checked state.
- [pantry-schemas.ts](../../../src/shared/schemas/pantry-schemas.ts) validates warning thresholds and stock actions, but has no dismissal or shopping-link contract.
- [pantry.ts](../../../src/main/server/routes/pantry.ts) exposes item, stock, lot, package, warning-rule, and event endpoints. There is no dismissal endpoint and no Pantry-to-grocery action endpoint.
- [pantry.tsx](../../../src/renderer/pages/pantry.tsx) shows status labels and forecast attention in both the collection and editor. Existing quick actions mutate stock or mark an item empty; there is no warning dismissal action.
- [pantry-service.test.ts](../../../src/main/server/services/pantry-service.test.ts) verifies low, expired, and stock mutation behavior, including inventory event creation. These tests establish that warning state currently follows inventory state and that stock changes publish Pantry updates.
- [grocery-service.ts](../../../src/main/server/services/grocery-service.ts) serializes grocery items and tracks checked state. Its Pantry completion flow applies stock only after a review decision, which is the relevant distinction for C3.
- Unknown: Whether an existing higher-level current-list selection convention should govern a new “Add to Shopping List” Pantry action; the inspected grocery service exposes current-list retrieval, but the desired user choice and empty-list behavior are not specified.

## Impact Findings
### C1: Quick preset snooze
- Classification: beneficial with conditions
- Positive impact: A fixed seven-day-style preset is discoverable, low-friction, and bounded. It addresses repeated warnings without introducing the cognitive and implementation cost of a custom date picker.
- Negative impact or unintended consequence: A fixed period may be wrong for different shopping rhythms. If it is stored as a single item-level flag, it could hide a new expiration warning or a newly severe empty state that should be visible. The UI must distinguish muted attention from actual status.
- Affected surfaces: Pantry persistence/schema, shared payload and validation types, Pantry service status/presentation serialization, Pantry routes, renderer collection/editor actions, export/import behavior, and focused service/UI tests.
- Dependencies and interactions: Must coexist with C2 and C3 using one clear precedence model. Stock changes, warning-rule changes, and deletion/recreation must not leave stale mute state. Data exports need an explicit compatibility policy.
- Confidence and rationale: Medium-high. The current status and forecast are deterministic and have no acknowledgment state, so a bounded presentation-level record fits the ownership boundary. The exact warning scope and duration remain product decisions.
- Discriminating check: Add a test fixture with an empty item and a seven-day mute; verify status remains `empty`, the warning is not counted as attention while active, and attention returns after the timestamp. Then add stock and verify the mute does not corrupt inventory state.
- Recommendation: revise

### C2: Until-restocked mute
- Classification: beneficial with conditions
- Positive impact: This directly addresses recurring empty/low-stock fatigue for items the user already knows they need to buy. It preserves the database truth and avoids forcing a calendar decision.
- Negative impact or unintended consequence: “Restocked” is ambiguous for low-stock items. Unmuting after any quantity increase can immediately show the same low warning again; unmuting only at threshold/target may keep a warning hidden after a partial purchase. A permanent mute can also hide a problem if the user never buys the item.
- Affected surfaces: Pantry item warning state, stock action/event handling, service serialization and summary counts, renderer controls and status copy, imports/exports, and tests around add/correction/mark-empty actions.
- Dependencies and interactions: Must be reset or re-evaluated after stock additions, corrections, imports, threshold edits, and changes between stock modes. C3 should be able to use the same underlying mute lifecycle without creating a second competing suppression mechanism.
- Confidence and rationale: Medium. The evented stock model provides a reliable trigger boundary, but the low-stock semantics cannot be chosen from repository evidence alone.
- Discriminating check: For both an empty item and a low item, exercise an add-stock event below and above the configured threshold/target; compare the expected attention state under each candidate definition and confirm the status itself never changes except through inventory calculation.
- Recommendation: proceed

### C3: Action-oriented dismissal through the shopping list
- Classification: beneficial with conditions
- Positive impact: This is the strongest alignment with the stated goal because it converts a warning into a concrete next action and keeps the need visible in a workflow designed for shopping. It reduces the risk of users forgetting why a warning was dismissed.
- Negative impact or unintended consequence: The current data model has no stable pantry-to-grocery link. Matching by normalized name alone could suppress the wrong item, duplicate requests, or hide a warning when a grocery item belongs to a recipe rather than the Pantry item. Treating a checked grocery item as purchased would violate the current completion-review contract.
- Affected surfaces: Prisma schema and migration, shared grocery/Pantry contracts, grocery service and routes, Pantry service and routes, renderer Pantry and grocery-list flows, data-management export/import, and cross-domain tests.
- Dependencies and interactions: Requires a list-selection policy and explicit linked-item lifecycle. It should reuse the existing Pantry completion review for actual stock updates. The linked grocery item should remain actionable while unchecked; after checking, removal, completion, or failed review, the warning behavior must be deterministic.
- Confidence and rationale: Medium-high for the user benefit, medium for implementation scope. The current separation between calculation-only grocery generation and reviewed Pantry updates is clear evidence that a link is safer than implicit stock mutation.
- Discriminating check: Create two Pantry items with similar names and two grocery items; link only one explicitly, then verify only the linked Pantry warning is muted. Check the grocery item without applying Pantry stock and verify the warning lifecycle matches the chosen product rule.
- Recommendation: proceed

## Cross-Change Considerations
- Treat these as one warning-attention model with multiple user actions, not three unrelated boolean flags. A single item may have an active timed mute, an until-restocked mute, or a linked grocery action; precedence and replacement rules must be explicit.
- Keep domain status separate from attention presentation. A muted item may still be `empty`, `low`, or `expired`, and the editor should make that state recoverable and understandable.
- Sequence the shopping-list association decision before implementation of automatic suppression. The association is the architectural dependency; the button copy and fixed preset can be designed around it.
- Do not automatically suppress expired or expiring warnings as part of the first version unless the product decision explicitly accepts that safety tradeoff. Stock/forecast attention is the lower-risk initial scope.
- Include archive import/export behavior in planning. A mute without its linked grocery record can become stale after restore, so the plan needs either to export dismissal state, rehydrate links, or intentionally clear them with visible behavior.
- Preserve current Pantry completion semantics: adding a grocery item is intent, checking it is shopping progress, and only the reviewed purchase flow changes stock.

## Handoff Options
1. **Continue specification assessment**: Resolve the four product decisions in Clarifications, especially dismissible warning families, low-stock restock semantics, linked grocery lifecycle, and current-list selection. This is required if the team wants a precise acceptance contract before planning.
2. **Hand off to the planning agent**: Produce a plan for a first release limited to stock and forecast attention, with C3 as the primary action, C2 as the persistent fallback, and C1 as an optional bounded preset. Carry forward the separation between status and attention, explicit Pantry-to-GroceryItem association, existing purchase-review semantics, archive compatibility, and the unresolved choices listed above.

## Quality Gate
- Every requested change was identified and mapped to an intended outcome: C1 fixed preset, C2 until-restocked toggle, and C3 shopping-list action.
- Material clarifications are visible; repository-verifiable facts were checked locally, while product choices that cannot be inferred are labeled unresolved.
- Current-state claims have repository evidence in Pantry documentation, service/domain code, schema, routes, renderer, grocery service, and tests.
- Benefits, risks, dependencies, interactions, and sequencing are explicit for each change.
- Each recommendation includes a cheap discriminating check that could falsify the assessment.
- Unresolved decisions are preserved before handoff, and no application code or unrelated files were modified.
