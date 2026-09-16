---
title: "Pantry Warning Dismissal - Implementation Plan"
status: BLOCKED
current_phase: 5 / 5
created: 2026-09-15
last_updated: 2026-09-15
---

# Overall Plan Completion Status

- **Final State:** BLOCKED
- **Total Phases Completed:** 4 / 5
- **Summary of Outcome:** Phases 1-4 are implemented and feature-gated. Phase 5 completed the focused verification, documentation, and release-readiness review, but the full suite remains blocked by the known unrelated throttling UI fixture failure and packaged desktop/browser/theme interaction evidence was unavailable.

# Specification & Overview

### 1. Scope & Objective

- **Source:** `docs/plans/pantry-warning-dismissal/pantry-warning-dismissal-spec.md`.
- **Goal:** Reduce repeated Pantry attention signals by adding presentation-level dismissal behavior while preserving inventory truth, warning calculations, forecast calculations, inventory events, and existing reviewed purchase semantics.
- **In-Scope:**
  - An explicit Pantry-to-grocery-item action and stable association for actionable stock or forecast needs.
  - An until-restocked mute for supported empty and low-stock attention.
  - A bounded fixed-duration snooze, such as seven days, if Phase 1 confirms it belongs in the first release.
  - Attention serialization, persistence, routes, renderer actions, and collection/editor presentation for the selected warning families.
  - Export/import compatibility for dismissal state and grocery associations.
  - Focused service, route, renderer, and cross-domain tests.
- **Out-of-Scope:**
  - Custom snooze dates.
  - Changing or deleting inventory, warning thresholds, warning rules, or `always-available` behavior as a dismissal side effect.
  - Indefinite suppression without an explicit restock or lifecycle rule.
  - Fuzzy name-based Pantry/grocery matching.
  - Treating a grocery item being created or checked as proof of purchase.
  - Automatically hiding expiring or expired warnings unless Phase 1 explicitly approves that safety tradeoff.

### 2. Technical Constraints & Architecture

- Keep domain status separate from presentation attention. A muted item must remain inspectable as `ok`, `low`, `empty`, `expiring-soon`, or `expired` according to current inventory and lot data.
- Model C1, C2, and C3 as one attention model with explicit precedence and replacement rules, rather than unrelated boolean flags.
- Use the existing Pantry stock mutation and inventory-event boundaries to evaluate restock/unmute behavior; do not infer purchase from grocery intent or checking alone.
- Reuse current grocery-list selection/current-list conventions only after discovery. Do not invent list behavior where the repository does not establish it.
- Preserve the existing completion review as the only path that applies purchased stock to Pantry quantities.
- Follow current Prisma generation and database update practices, including the repository's Windows workaround if an active Electron process locks the Prisma engine.
- Keep renderer platform access behind the existing platform abstraction and preserve documented IPC/API boundaries.
- Treat archive export/import as part of the feature contract. A restored dismissal must not silently reference a missing grocery record.
- Product decisions that the source leaves unresolved are gates, not implementation assumptions.

### Decision Closure Register

Triage completed against the existing Pantry, grocery, archive, and runtime boundaries:

- **Auto-resolved:** 6 routine decisions.
- **Owner decisions:** 10 material product, schema, or architecture decisions, all now resolved.
- **Discovery-needed:** 0; repository evidence was sufficient to classify the remaining decisions as owner-controlled.

#### Auto-resolved decisions

- **d1-service-boundary:** Keep attention policy in `PantryService` and a service-owned helper/module; expose it through the existing Hono/shared-schema path. Do not add a second renderer or IPC domain path. Confidence: high; reversibility: moderate.
- **d2-validation-errors:** Use shared Zod schemas and the existing route error envelope for new Pantry attention and grocery-link operations. Replace direct grocery request-body casts for touched link/lifecycle operations. Confidence: high; reversibility: easy.
- **d3-archive-id-mapping:** Restore grocery associations only after archive source IDs have been mapped to local IDs. Missing referenced records must never produce an active suppression; the implementation must either clear the association with a visible result or reject that association before mutation according to the owner-selected stale-link policy. Confidence: high; reversibility: moderate.
- **d4-raw-status-contract:** Every serialized Pantry item will retain raw `status` and forecast data, with dismissal represented additively as attention data. No dismissed status value will be introduced. Confidence: high; reversibility: moderate.
- **d5-stock-boundary-coverage:** The attention reconciliation policy must be invoked from every existing stock-changing boundary: manual stock actions, package stock, lot add/update/remove, confirmed Pantry completion, and archive import. Confidence: high; reversibility: moderate.
- **d6-validation-sequence:** Phase validation will use exact, reproducible commands rather than “discovered” command descriptions: focused Vitest suites, `npm run test`, `npm run lint`, `npm run build`, `npm run docs:check:ipc`, applicable data-management checks, and the documented Windows Prisma workflow. Confidence: high; reversibility: easy.

#### Resolved owner decisions

- **d7-warning-scope:** Dismissal applies to stock and numeric forecast attention only. Expiring-soon, expired, and forecast-unavailable/data-quality attention remain visible. Confidence: high; reversibility: moderate.
- **d8-restock-trigger:** Until-restocked mute clears on any positive usable-quantity increase, including qualifying partial purchases, package additions, lot additions, and positive corrections/imports; reductions do not clear it. The underlying low/empty status remains authoritative. Confidence: medium-high; reversibility: moderate.
- **d9-grocery-check:** Checking a linked grocery item restores eligible Pantry attention immediately. The link remains non-purchasing history until confirmed Pantry review or unlink; checking never changes Pantry quantity. Confidence: high; reversibility: moderate.
- **d12-association-cardinality:** One Pantry item has at most one active grocery link. Relinking explicitly replaces or closes the prior association. Confidence: high; reversibility: moderate.
- **d13-cross-domain-consistency:** Use stable idempotent operation/review identities rather than introducing a shared cross-domain transaction refactor. Existing Pantry stock mutations remain transactional; retries must not duplicate links or stock, and per-item outcomes must be reported. Confidence: medium; reversibility: moderate.
- **d10-list-selection:** Use the existing deterministic current-list convention; when no list exists, create an ongoing list with a clear name. Confidence: high; reversibility: easy.
- **d11-c1-snooze:** Include one seven-day snooze for stock and numeric forecast attention only. Snooze expiry restores attention; expiration and forecast-unavailable attention remain visible. Confidence: medium-high; reversibility: moderate.
- **d14-terminal-lifecycle:** Removal, deletion, skipped decisions, and failed review restore attention and close the active link. Checking restores attention without changing stock. Confirmed review applies stock through the existing Pantry path, then closes/re-evaluates the link. Confidence: medium-high; reversibility: moderate.
- **d15-stale-archive-link:** Clear a missing active grocery association during import and report a visible stale-reference warning; never restore it as an active suppression. Confidence: high; reversibility: moderate.
- **d16-attention-precedence:** Keep one effective suppressible attention state per Pantry item. The newest explicit C1/C2/C3 action replaces the prior suppressible source. A qualifying stock increase clears until-restocked and causes the linked action to be re-evaluated. Expiring-soon, expired, and forecast-unavailable/data-quality attention remain visible regardless of suppressible state. Confidence: medium-high; reversibility: moderate.

#### Owner-controlled decisions still open

- None. All material owner-controlled decisions are resolved; Phase 1 validation and truth-table recording remain execution tasks.

Dependency order: `d12-association-cardinality` and `d13-cross-domain-consistency` constrained the persistence/API shape; `d7` through `d11`, `d14`, `d15`, and `d16` now constrain attention semantics, UI behavior, and archive handling.

#### Attention truth table

| Condition                                                                                    | Raw status/forecast                        | Visible attention                                | Effective suppressible state                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------- |
| Expiring-soon, expired, or forecast-unavailable/data-quality                                 | Unchanged and inspectable                  | Visible                                          | C1/C2/C3 cannot hide it                             |
| Stock or numeric forecast attention with no active mute                                      | Unchanged and inspectable                  | Visible                                          | None                                                |
| Stock or numeric forecast attention after seven-day snooze                                   | Unchanged and inspectable                  | Hidden until expiry                              | C1                                                  |
| Empty/low attention after until-restocked action                                             | Unchanged and inspectable                  | Hidden until qualifying positive usable increase | C2                                                  |
| Stock/forecast attention with active unchecked grocery link                                  | Unchanged and inspectable                  | Hidden until link lifecycle re-evaluation        | C3                                                  |
| New explicit C1/C2/C3 action while another suppressible state exists                         | Unchanged and inspectable                  | Follows the newest action                        | Previous suppressible state is replaced             |
| Grocery item checked, removed, deleted, skipped, or failed review without confirmed purchase | Unchanged and inspectable                  | Eligible attention restored                      | Active link closed or re-evaluated                  |
| Confirmed Pantry purchase review                                                             | Updated only through existing stock action | Re-evaluated from resulting state                | Link closed/re-evaluated; no implicit purchase path |

---

# Execution Plan & Handoffs

## Phase 1: Product Decisions and Repository Discovery

- **Status:** COMPLETED
- **Objective:** Turn the assessment's unresolved choices into an implementation-ready acceptance contract and confirm the repository conventions that control list selection, archive data, status summaries, and stock mutation boundaries.

### Tasks

- [x] Dismiss stock and numeric forecast attention only; expiring-soon, expired, and forecast-unavailable/data-quality attention remains visible.
- [x] Decide the low-stock restock trigger: any positive usable-quantity increase clears the mute; reductions do not. Record the choice and the behavior for partial purchases, corrections, package additions, lot changes, and imports.
- [x] Removal, deletion, skipped decisions, and failed review restore attention and close the active link; checking without confirmed purchase restores attention and never changes Pantry quantity; confirmed review applies stock through the existing Pantry path and then closes/re-evaluates the link.
- [x] Add to the deterministic current grocery list and create an ongoing list with a clear name when none exists.
- [x] Include one seven-day snooze for stock and numeric forecast attention only; expiration and forecast-unavailable attention remain visible.
- [x] Inspect the existing archive export/import implementation, grocery list lifecycle, Pantry summary/attention counts, and stock mutation event handling; document concrete integration points without treating discovery as a new contract.
- [x] Define the canonical attention precedence, clear/reset rules for deletion and recreation, warning-rule changes, stock-mode changes, imports, and linked grocery records.
- [x] One active grocery link per Pantry item; relinking replaces or closes the prior association, and repeated lifecycle operations use stable idempotent operation/review identities.
- [x] Clear a missing linked grocery record during archive import and report a visible stale-reference warning.
- [x] Record the attention truth table covering simultaneous C1, C2, and C3 sources, raw status, forecast state, visible attention, precedence, replacement, and reset behavior.

### Phase 1 Discovery Record

- **Archive export/import and ID mapping:** `src/main/server/services/data-management-service.ts` owns `exportGrocery`, `exportPantry`, `loadLocalSnapshot`, `buildImportAnalysis`, `buildApplyAnalysis`, `writeImportPayloads`, `clearContentForReplace`, and `applyImport`. Grocery lists/items and Pantry items are exported as separate domain payloads. `buildImportAnalysis` populates `ArchiveIdMap` entries for `groceryLists`, `groceryItems`, and `pantryItems`; `buildApplyAnalysis` applies conflict decisions, preserving IDs for replace and assigning new UUIDs for merge creates. `writeImportPayloads` writes grocery lists before Pantry items inside one transaction. Its `mapped` helper returns null and increments `unresolved` when a mapped reference is absent. `src/shared/schemas/data-management-schemas.ts` owns `GroceryPayloadSchema`, the Pantry archive schema, `ArchiveIdMapSchema`, and the canonical archive layout. There is no Pantry-to-grocery association in the current archive contract, so no existing stale-link reconciliation exists; Phase 2 must map any new association after source IDs are resolved and clear/report a missing grocery record rather than restore an active stale link.
- **Grocery list lifecycle and current-list convention:** `src/main/server/services/grocery-service.ts` owns `serializeGroceryList`, `compareGroceryLists`, `sortGroceryLists`, `getCurrentGroceryList`, `createGroceryList`, `updateGroceryList`, `deleteGroceryList`, `createGroceryItem`, `updateGroceryItem`, `deleteGroceryItem`, `restoreGroceryListSnapshot`, and `toggleItem`. Ongoing lists have `date: null` and sort before dated lists; among ongoing lists the newest `createdAt` wins; dated lists sort by date, then newest `createdAt`. `getCurrentGroceryList` returns the first sorted list or null. `src/main/server/routes/grocery-lists.ts` exposes this through `GET /grocery-lists?current=1`; `POST /grocery-lists` is explicit creation. No create-if-none helper exists, so the later Pantry action must create a clear-named ongoing list when this endpoint currently returns null. Checked state is only a boolean lifecycle state: `toggleItem` changes `checked`, item/list deletion and snapshot restore are separate transitions, and `getPantryCompletionProposals` plus `applyPantryCompletion` are the review transitions. Only `applyPantryCompletion` calls `PantryService.applyStockAction`; checking a grocery item does not mutate Pantry stock.
- **Pantry serialization and counts:** `src/main/server/services/pantry-service.ts` owns `getStatus`, `serializeItem`, `list`, and `summary`; `src/main/server/services/pantry-forecast.ts` owns `calculatePantryForecast`. Serialized items retain raw `status`, `usableQuantity`, and the full forecast state/reason/attention/remaining quantity/remaining days/projected run-out fields. `summary()` derives `trackedItems`, `lowStock`, `empty`, `expiringSoon`, `expired`, and `forecastAttention` from the raw serialized items, so dismissal must be additive and must not alter these raw status or forecast fields. The Pantry renderer consumes this contract in `src/renderer/pages/pantry.tsx`; grocery list serialization exposes `checkedCount`, `totalItems`, `completionPercentage`, and each item's `checked` in `serializeGroceryList`.
- **Stock-changing Pantry boundaries and hooks:** `PantryService.applyStockAction` handles manual add/consume/discard/mark-empty/correction, updates location/lot quantities, creates a manual inventory event, and publishes `publishCommittedChange("pantry", "update", id)`. `applyPackageStockAction` handles confirmed package additions, creates a package inventory event, and publishes the same Pantry update. `addLot` increases aggregate location quantity and creates a lot but currently publishes only the Pantry update event and does not create an inventory event. `removeLot` decreases aggregate quantity, creates a discard event, and publishes; `updateLot` adjusts location quantity or moves locations, creates a correction event, and publishes. `create` and `update` can also write initial or edited location quantities transactionally and publish create/update without an inventory event. Confirmed Pantry completion is `GroceryService.applyPantryCompletion`, which validates the review decision and then delegates stock mutation to `applyStockAction`; grocery checking remains non-purchasing. Archive import is `DataManagementService.writeImportPayloads`: it writes Pantry quantities/lots/packages and either imported history events or idempotent imported-baseline events using `sourceIdentity`, within `applyImport`'s transaction. The post-import publication loop currently includes meal, recipe, groceryList, prepList, mealType, and preference, but not `pantry`; no separate attention reconciliation hook exists today. These are discovery facts for Phase 2/3 integration, not new Phase 1 behavior.
- **Focused and later validation commands:** The Phase 1 focused command is `npx vitest run src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx src/main/server/services/grocery-service.test.ts src/main/server/routes/grocery-lists.test.ts`. The exact repository-supported archive follow-up command is `npx vitest run src/main/server/lib/data-archive.test.ts src/main/server/services/data-management-service.test.ts src/main/server/services/data-management-import.test.ts src/main/server/routes/data-management.test.ts src/shared/schemas/data-management-schemas.test.ts`. Later validation commands already supported by `package.json` and `docs/developer-guide.md` are `npm run test`, `npm run lint`, `npm run build`, `npm run docs:check:ipc`, `npm run check:data-management:runtime`, `npm run check:data-management:build`, and `npm run check:data-management:package`; schema-changing phases additionally use `npm run db:push` followed by `npm run db:generate`.

### Verification & Acceptance Criteria

_All criteria must pass before advancing to the handoff report._

- [x] **Automated Checks:** Run the exact focused Pantry and grocery commands selected during discovery, at minimum the focused Pantry service/route/renderer tests and grocery service/route tests; no implementation changes are required for this phase.
- [x] **Functional Assertions:** A written decision record exists in this plan or a linked project document for all four source clarifications plus C1 inclusion; each decision names the resulting lifecycle and safety boundary.
- [x] **Functional Assertions:** Each source change C1, C2, and C3 has a selected first-release behavior, an explicit non-goal, and a validation scenario.
- [x] **Functional Assertions:** The chosen output contract distinguishes domain status from muted attention and preserves reviewed purchase semantics.
- [x] **Functional Assertions:** The decision record includes association cardinality, cross-domain consistency/retry behavior, archive ID-mapping order, missing-reference behavior, and the exact validation commands for later phases.

### Plan Compliance Checklist

_Verify each item against the actual diff before claiming this phase complete. Do not mark the phase COMPLETED if any item fails._

- [x] **Required Files:** This phase must update this plan with the resolved decisions and may add only a focused decision/discovery artifact if repository conventions require one.
- [x] **Boundaries:** Do not modify application code, Prisma schema, exports, or unrelated documentation while decisions remain unresolved.
- [x] **Legacy Code Removed:** None. Existing behavior remains unchanged during this preparation phase.
- [x] **Acceptance Checks:** Confirm the repository discovery and existing focused tests were actually run and the decisions are recorded, not assumed.

### Phase 1 Handoff & Verification Report

_Filled out by the executing agent upon phase completion._

- **Compliance Check:** PASS
- **Verification Result:** PASS - the focused Pantry and grocery suites passed with 5 test files and 36 tests passed.
- **Execution Proof / Logs:** `npx vitest run src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx src/main/server/services/grocery-service.test.ts src/main/server/routes/grocery-lists.test.ts` -> 5 passed, 36 passed.
- **Artifacts Created/Modified:** `docs/plans/pantry-warning-dismissal/pantry-warning-dismissal-plan.md` only. No application code, Prisma schema, exports, or unrelated documentation changed.
- **Decisions & Deviations:** Product, schema-shaping, and cross-domain consistency decisions are resolved in the Decision Closure Register. Discovery found no blocking contradiction. Repository gaps to carry into later phases are explicit: no create-if-none grocery helper, no Pantry publication/reconciliation after archive import, and no inventory event from `addLot`.
- **Next Phase Context:** Phase 2 may begin from the recorded archive ID-map order, current-list convention, raw Pantry status/forecast contract, and stock boundary inventory. Phase 2 has not been started.

---

## Phase 2: Attention Persistence and Shared Contracts

- **Status:** COMPLETED
- **Objective:** Add the durable, explicit data and shared contract foundation for Pantry attention and Pantry-to-grocery associations without changing the meaning of inventory status.

### Tasks

- [x] Translate Phase 1 decisions into the smallest persistence model for timed mute, until-restocked mute, and explicit Pantry-to-grocery association; use repository discovery to choose fields/relations rather than assuming a schema shape.
- [x] Add the corresponding shared schemas, types, API paths, and request/response validation for attention actions and grocery linking.
- [x] Define persistence invariants for one Pantry item with multiple possible attention sources, stale links, deleted grocery records, list changes, and item deletion/recreation.
- [x] Extend archive export/import to preserve, rehydrate, or intentionally clear attention and link state according to the Phase 1 decision; document behavior for missing linked records.
- [x] Apply the schema using the repository's database workflow and regenerate Prisma artifacts with the Windows lock workaround when necessary.

### Verification & Acceptance Criteria

- [x] **Automated Checks:** Run schema/database validation, Prisma generation, shared schema/type tests, and the focused export/import tests.
- [x] **Functional Assertions:** Persisted attention state survives reload and is scoped to the intended Pantry item; domain quantities, inventory events, warning thresholds, and forecast inputs are unchanged.
- [x] **Functional Assertions:** A link identifies the exact Pantry and grocery records without name-based matching and has a deterministic stale-record policy.
- [x] **Functional Assertions:** Export/import behavior is compatible with the chosen lifecycle and cannot restore a silently active reference to a missing grocery item.

### Plan Compliance Checklist

- [x] **Required Files:** Prisma schema and generated client artifacts as required by the repository; shared Pantry/grocery schemas and types; API/IPC path definitions if required; data-management export/import modules and focused tests identified during Phase 1.
- [x] **Boundaries:** Do not change status calculation, stock quantity, forecast calculation, warning thresholds, or grocery checking semantics as a side effect of adding persistence.
- [x] **Legacy Code Removed:** Replace or supersede any temporary name-based or unpersisted dismissal path; do not leave competing dismissal representations.
- [x] **Acceptance Checks:** Confirm database, generated-client, contract, and archive tests were run against the actual diff.

### Phase 2 Handoff & Verification Report

- **Compliance Check:** PASS - the Phase 2 diff is limited to persistence, runtime schema bootstrapping, shared contracts/API boundaries, archive mapping, and focused tests. No Pantry status/forecast calculation, stock mutation, grocery checking, renderer, or Phase 4 lifecycle behavior was changed.
- **Verification Result:** PASS for Phase 2 acceptance criteria. The focused Phase 2 matrix passed 11 files and 68 tests; the post-review idempotency matrix passed 3 files and 16 tests; the archive-focused suite passed 5 files and 26 tests; the repository lint, Prisma validation, runtime/build data-management checks, and IPC documentation drift check passed.
- **Execution Proof / Logs:** `npx vitest run src/shared/schemas/pantry-attention-schemas.test.ts src/shared/schemas/data-management-schemas.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx src/main/server/services/grocery-service.test.ts src/main/server/routes/grocery-lists.test.ts src/main/server/lib/data-archive.test.ts src/main/server/services/data-management-service.test.ts src/main/server/services/data-management-import.test.ts src/main/server/routes/data-management.test.ts` -> 11 passed, 68 passed. `npx vitest run src/main/server/services/pantry-attention-service.test.ts src/main/server/routes/pantry.test.ts src/shared/schemas/pantry-attention-schemas.test.ts` -> 3 passed, 16 passed. `$env:LOCAL_RECIPE_BOOK_DATABASE_URL='file:./tmp/phase2-validation.db'; npm run db:push -- --skip-generate; npx prisma generate --no-engine; npx prisma validate; Remove-Item Env:LOCAL_RECIPE_BOOK_DATABASE_URL` -> database synchronized, client generated, and schema valid. `npm run lint`, `npm run docs:check:ipc`, `node scripts/check-data-management-build.mjs --runtime`, and `node scripts/check-data-management-build.mjs --build` -> passed. `npm run build:web; npx electron-vite build; node scripts/check-data-management-build.mjs --build` -> web, Electron main/preload/renderer, and build-time data-management checks passed.
- **Artifacts Created/Modified:** `prisma/schema.prisma`; `src/main/server/lib/schema.ts`; `src/main/server/services/pantry-attention-service.ts`; `src/main/server/services/pantry-attention-service.test.ts`; `src/main/server/routes/pantry.ts`; `src/main/server/routes/pantry.test.ts`; `src/main/server/services.ts`; `src/main/server/core-index.ts`; `src/main/server/services/data-management-service.ts`; `src/main/server/services/data-management-import.test.ts`; `src/shared/schemas/pantry-attention-schemas.ts`; `src/shared/schemas/pantry-attention-schemas.test.ts`; `src/shared/schemas/data-management-schemas.ts`; `src/shared/api/types.ts`; `src/shared/index.ts`; `src/shared/types.ts`; and this plan.
- **Decisions & Deviations:** Attention history stores source, expiry, link, operation/review identities, active state, and close metadata. One active attention and one active grocery link are enforced through runtime partial unique indexes. Grocery references are exact IDs; import maps grocery IDs before restoring links and records missing references as inactive stale links. Clear operations target the exact attention ID, and lifecycle retries replay by operation identity so retries cannot affect a later state. The full `npm run test` command remains blocked by one unrelated existing failure in `src/renderer/pages/throttling-ui.qa.test.tsx` (`heatmapQuery` is undefined; 567 of 568 tests passed). The `npm run build` wrapper remains blocked before compilation by Windows `EPERM` while Prisma tried to rename a locked query engine; running its web/Electron build stages directly against the already-generated no-engine client passed. The repository-wide Node typecheck also reports existing unrelated diagnostics, including fixture typing in the touched archive test around `autoReviewPantry`; no new Phase 2 implementation-file diagnostic was reported.
- **Next Phase Context:** Phase 3 may consume the persisted attention/link payloads and routes, while keeping raw Pantry status and forecast fields authoritative. It must add attention derivation, expiry/restock reconciliation, and renderer controls without changing the Phase 2 archive mapping or exact-ID/idempotency contracts. Phase 4 remains responsible for creating the grocery item/list action and lifecycle integration; Phase 2 does not create lists, infer purchase from checking, or mutate Pantry stock.

---

## Phase 3: Pantry Attention and Restock Behavior

- **Status:** COMPLETED
- **Objective:** Implement service and route behavior that derives presentation attention from persisted dismissal state while retaining the current Pantry status and forecast truth.

### Tasks

- [x] Extend Pantry service serialization and summary calculations to expose actual status plus attention/mute state without replacing status with a dismissed value.
- [x] Implement the fixed snooze action if approved, including expiry, reappearance, cancellation/replacement rules, and protection against hiding newly included safety-critical warning families.
- [x] Implement until-restocked mute for supported stock/forecast warnings and clear it from the selected stock mutation/restock boundaries, including empty items, low items, corrections, imports, and mode/threshold changes as decided.
- [x] Add Pantry routes and request validation for dismissal, unmute, and attention inspection; preserve existing stock/lot/package/event routes.
- [x] Update Pantry collection/editor controls and copy so users can dismiss attention while still seeing the underlying low/empty/forecast state when inspecting the item.
- [x] Add focused service, route, and renderer tests for active mute, expired snooze, restock, partial stock changes, reload persistence, summary counts, and unchanged inventory truth.

### Verification & Acceptance Criteria

- [x] **Automated Checks:** Focused Phase 3 matrix passed 5 files and 47 tests; the exact Pantry/grocery regression matrix passed 5 files and 43 tests; archive service/import tests passed 2 files and 10 tests; touched-file ESLint and editor diagnostics passed.
- [x] **Functional Assertions:** An empty item with an active mute remains `empty`; its attention is suppressed only according to the selected policy and returns after snooze expiry or a qualifying positive usable-quantity increase.
- [x] **Functional Assertions:** Low-stock behavior is covered by the policy truth table and positive-only restock tests, including partial increases and non-increasing corrections.
- [x] **Functional Assertions:** Stock changes retain existing inventory-event behavior and do not mutate quantities merely because attention was dismissed; Pantry service and archive import tests cover these boundaries.
- [x] **Functional Assertions:** Expiring/expired and forecast-unavailable safety attention remains visible, and muted state is recoverable through the editor restore control.

### Plan Compliance Checklist

- [x] **Required Files:** Pantry service, Pantry routes/schemas, renderer Pantry page/components, and focused Pantry service/route/UI tests were updated; no grocery lifecycle creation or unrelated feature module was added.
- [x] **Boundaries:** Dismissal remains additive to Pantry status and forecast, inventory truth is preserved, restock is not inferred from grocery checking, and renderer access uses the existing API client/platform boundary.
- [x] **Legacy Code Removed:** Attention derivation is centralized in the service-owned policy; no competing renderer-side dismissal calculation or direct platform call was introduced.
- [x] **Acceptance Checks:** Status, forecast, mutation-event, dismissal, restock, archive-import, and UI assertions were executed by the focused matrices and touched-file diagnostics.

### Phase 3 Handoff & Verification Report

- **Compliance Check:** PASS - Phase 3 changes are limited to service-owned attention derivation/reconciliation, Pantry routes/contracts, renderer controls/presentation, archive-import reconciliation wiring, and focused tests. Phase 4 grocery-item/list lifecycle work and Phase 5 broad documentation/release work were not implemented.
- **Verification Result:** PASS for Phase 3 acceptance criteria. The focused Phase 3 matrix passed 5 files and 47 tests. The exact Pantry/grocery regression matrix passed 5 files and 43 tests. Archive service/import tests passed 2 files and 10 tests. Touched-file ESLint and editor diagnostics passed. Web build had already passed after implementation.
- **Execution Proof / Logs:** `npx vitest run src/main/server/services/pantry-attention-policy.test.ts src/main/server/services/pantry-attention-service.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx` -> 5 passed, 47 passed. `npx vitest run src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx src/main/server/services/grocery-service.test.ts src/main/server/routes/grocery-lists.test.ts` -> 5 passed, 43 passed. `npx vitest run src/main/server/services/data-management-service.test.ts src/main/server/services/data-management-import.test.ts` -> 2 passed, 10 passed. `npx eslint` on touched Phase 3 TypeScript files -> passed. `get_errors` on touched implementation files -> no errors. The repository-wide Node typecheck still reports unrelated baseline diagnostics outside the Phase 3 slice.
- **Artifacts Created/Modified:** `src/main/server/services/pantry-attention-policy.ts`; `src/main/server/services/pantry-attention-policy.test.ts`; `src/main/server/services/pantry-attention-service.ts`; `src/main/server/services/pantry-attention-service.test.ts`; `src/main/server/services/pantry-service.ts`; `src/main/server/services/data-management-service.ts`; `src/main/server/services.ts`; `src/main/server/routes/pantry.ts`; `src/main/server/routes/pantry.test.ts`; `src/main/server/routes/stats.test.ts`; `src/shared/schemas/pantry-attention-schemas.ts`; `src/shared/schemas/pantry-attention-schemas.test.ts`; `src/shared/api/types.ts`; `src/shared/types.ts`; `src/renderer/pages/pantry.tsx`; `src/renderer/pages/pantry.module.css`; `src/renderer/pages/pantry.test.tsx`; and this plan.
- **Decisions & Deviations:** Raw status and forecast remain authoritative and are serialized alongside additive attention state. Snooze duration is enforced by the service at seven days, regardless of client expiry input. Until-restocked clears only after a strictly positive usable-quantity increase. Safety attention remains visible. Archive import reconciles positive imported increases after the transaction. The required full-suite and release-level checks remain deferred to Phase 5; the repository-wide Node typecheck has pre-existing unrelated diagnostics, while touched Phase 3 implementation files are clean.
- **Next Phase Context:** Phase 4 may add the explicit Pantry-to-grocery-item/list action and linked lifecycle using the persisted exact-ID/idempotent contracts from Phase 2. It must preserve the Phase 3 attention policy, must not infer purchase from grocery checking, and must not replace the existing Pantry completion review path.

---

## Phase 4: Shopping-List Action and Linked Lifecycle

- **Status:** COMPLETE
- **Objective:** Make the shopping-list action the primary dismissal path while maintaining an explicit link and preserving the existing reviewed purchase workflow.

### Tasks

- [x] Add the Pantry action to create or link a grocery item using the Phase 1 list-selection policy; prevent fuzzy matching and avoid duplicate links according to the decided rules.
- [x] Extend grocery service/routes and Pantry integration to expose linked state and lifecycle transitions for active, checked, removed, completed, and purchase-review outcomes.
- [x] Apply the chosen suppression lifecycle: keep attention muted only for the approved linked state, restore or prompt when checking/removing/completing without confirmed Pantry stock, and clear the link after the approved terminal event.
- [x] Update Pantry and grocery-list UI to show the relationship and make the attention state understandable without implying that a grocery item is purchased stock.
- [x] Add cross-domain tests with similar Pantry names and multiple grocery items to prove only the explicitly linked item is affected.
- [x] Verify archive export/import and deletion behavior for linked items, including stale links and restored records.

### Verification & Acceptance Criteria

- [x] **Automated Checks:** Focused Phase 4 matrix passed 13 files and 86 tests. Full `npm run test` passed 112 files and 586 tests; one unrelated baseline failure remains in `src/renderer/pages/throttling-ui.qa.test.tsx` because its HomeDashboard mock omits `heatmapQuery`.
- [x] **Functional Assertions:** Adding a shopping item from Pantry creates or links the exact intended grocery record and suppresses only the linked Pantry attention according to the selected lifecycle.
- [x] **Functional Assertions:** Checking a grocery item without applying reviewed Pantry stock follows the chosen restore/prompt rule and never changes Pantry quantity silently.
- [x] **Functional Assertions:** Confirmed purchase review remains the source of stock mutation and clears or re-evaluates attention through the defined restock path.
- [x] **Functional Assertions:** Similar names, multiple lists, removal, completion, and missing-record restore cases do not suppress the wrong Pantry warning.

### Plan Compliance Checklist

- [x] **Required Files:** Grocery service/routes and shared contracts; Pantry integration/routes; renderer Pantry and grocery-list surfaces; archive modules; focused cross-domain tests identified from Phase 1.
- [x] **Boundaries:** No normalized-name suppression, implicit stock mutation, or assumption that checked means purchased; do not replace existing purchase review.
- [x] **Legacy Code Removed:** One explicit Pantry grocery link now controls lifecycle behavior; created items retain the exact database ID rather than being resolved by name.
- [x] **Acceptance Checks:** Focused cross-domain/archive matrix, lint, production build, and full-suite check were run against the actual diff. `npm run build` and its data-management build check passed.

### Phase 4 Handoff & Verification Report

- **Compliance Check:** PASS - Phase 4 changes are limited to the Pantry shopping-list action, exact link lifecycle, reviewed completion preservation, renderer relationship presentation, archive change publication, and focused tests. Phase 5 release/documentation work was not started.
- **Verification Result:** PASS with one unrelated full-suite baseline failure: `src/renderer/pages/throttling-ui.qa.test.tsx` fails because `heatmapQuery` is undefined in its existing HomeDashboard mock. The Phase 4 matrix, lint, production build, and data-management build check passed.
- **Execution Proof / Logs:** `npm exec -- vitest run ...` focused matrix: 13 files, 86 tests passed. `npm run lint`: passed. `npm run build`: passed. `npm run test`: 112 files and 586 tests passed, 1 unrelated test failed.
- **Artifacts Created/Modified:** Pantry/grocery lifecycle services, routes, shared schemas, Pantry and grocery-list renderer surfaces/styles, archive import change publication, and `src/main/server/services/grocery-pantry-lifecycle.test.ts`.
- **Decisions & Deviations:** The existing Pantry grocery-link route was reused. A missing-list action creates an ongoing `Pantry Restock` list. Grocery checking only transitions the link; reviewed completion remains the sole stock mutation path. Transition identities are caller-provided for distinct check/uncheck operations and stable retries.
- **Next Phase Context:** Phase 5 may perform its separately scoped verification/documentation/release-readiness work. No Phase 5 changes were made here.

---

## Phase 5: Verification, Documentation, and Release Readiness

- **Status:** BLOCKED
- **Objective:** Validate the complete attention model across supported workflows, document user-visible and data-management behavior, and leave the implementation ready for review without silently expanding scope.

### Tasks

- [x] Run the full test suite and relevant build/typecheck/lint/data-management checks from the developer workflow; the full suite has one preserved unrelated baseline failure.
- [x] Exercise the source assessment's discriminating scenarios: timed empty-item mute, empty and low restock boundaries, similar-name explicit links, checked-without-purchase review, reload persistence, and archive restore.
- [x] Review UI behavior in Pantry collection/editor and grocery-list flows for clear status-versus-attention presentation, recoverability, and no overlap/regression with existing controls; interactive desktop/browser/theme evidence remains unavailable.
- [x] Update the focused Pantry, grocery, archive, IPC/API, and user-facing documentation required by the repository's documentation map; document chosen warning-family and lifecycle rules.
- [x] Review migration/backward compatibility and stale-state cleanup for existing data, imported archives, deleted records, and future warning-rule changes.
- [x] Record final deviations, residual risks, deferred decisions, and release recommendation in this plan's final handoff report.

### Verification & Acceptance Criteria

- [ ] **Automated Checks:** Feature-focused checks and production build passed, but `npm run test` remains blocked by the unrelated `src/renderer/pages/throttling-ui.qa.test.tsx` `heatmapQuery` fixture failure.
- [x] **Functional Assertions:** All source requirements selected for release are covered by passing focused tests or repository review; domain status and inventory truth remain intact in every dismissal path.
- [x] **Functional Assertions:** The four source clarifications are reflected consistently in persistence, service, API, renderer, export/import, and tests.
- [x] **Functional Assertions:** No expired/expiring safety warning is hidden; the rule is documented and covered by focused policy and renderer tests.
- [x] **Functional Assertions:** Existing Pantry completion review and grocery calculation-only behavior remain intact.

### Plan Compliance Checklist

- [x] **Required Files:** The required final report and relevant Pantry, data-management, and developer documentation were updated; no unrelated cleanup was made.
- [ ] **Boundaries:** The feature has no unresolved product decisions or stale generated artifacts, but the unrelated failing regression test and unavailable interactive UI evidence prevent a completed release gate.
- [x] **Legacy Code Removed:** Review found no duplicate dismissal model, fuzzy association, implicit purchase mutation, or bypassed completion-review path.
- [ ] **Acceptance Checks:** Required feature commands and scenarios have evidence, but the overall plan cannot be set to COMPLETED while the full-suite baseline failure remains.

### Phase 5 Handoff & Verification Report

- **Compliance Check:** BLOCKED - documentation and scope boundaries pass; the full-suite regression gate and interactive UI evidence gate remain open.
- **Verification Result:** BLOCKED for release completion, with the feature-focused verification passing: 7 focused files and 59 tests passed; `npm run test` produced 112 passing files and 586 passing tests plus one unrelated failure. Explicit Node and web project typechecks also retain repository-wide baseline diagnostics.
- **Execution Proof / Logs:** `npx vitest run --reporter=verbose src/main/server/services/pantry-attention-policy.test.ts src/main/server/services/pantry-attention-service.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/main/server/services/grocery-pantry-lifecycle.test.ts src/renderer/pages/pantry.test.tsx src/main/server/services/data-management-import.test.ts` -> 7 files and 59 tests passed. `npm run lint`, umbrella `npx tsc -p tsconfig.json --noEmit`, `npm run docs:check:ipc`, `npm run check:data-management:runtime`, isolated `npx prisma validate`, `npx prisma generate --no-engine`, `npm run build`, `npm run build:unpack`, and `npm run check:data-management:package` -> passed. Explicit `npx tsc -p tsconfig.node.json --noEmit` reports 50 baseline diagnostics across 20 files; `npx tsc -p tsconfig.web.json --noEmit` reports existing renderer/shared diagnostics, including the known Pantry test fixture shape errors. `npm run test` -> 112 files and 586 tests passed, one unrelated failure in `src/renderer/pages/throttling-ui.qa.test.tsx` because `heatmapQuery` is undefined in the existing mock.
- **Artifacts Created/Modified:** `docs/pantry.md`; `docs/data-management.md`; `docs/developer-guide.md`; this plan; and `docs/reports/2026-09-15-pantry-warning-dismissal-implementation-report.md`.
- **Decisions & Deviations:** The selected lifecycle rules are seven-day snooze, positive-only until-restocked clearing, exact-ID grocery links, non-purchasing grocery checks, reviewed completion as the only stock mutation path, visible safety attention, and inactive stale links on archive import. No application code or unrelated baseline failure was changed. Manual packaged desktop, browser/LAN, and light/dark/custom theme verification was unavailable and is not claimed.
- **Next Phase Context:** No next phase. Before release recommendation can change to COMPLETED, fix or explicitly waive the unrelated throttling UI fixture failure and execute the unavailable interactive desktop/browser/theme checks.

---
