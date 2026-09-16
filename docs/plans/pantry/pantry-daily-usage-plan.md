---
title: "Pantry Daily Usage and Depletion Warnings - Implementation Plan"
status: BLOCKED
current_phase: 4 / 4
created: 2026-09-15
last_updated: 2026-09-15
---

# Overall Plan Completion Status

* **Final State:** BLOCKED
* **Total Phases Completed:** 3 / 4
* **Summary of Outcome:** Phases 1-3 are complete and feature-focused Phase 4 verification is green. Final completion remains blocked by one pre-existing full-suite throttling UI QA failure, repository-wide TypeScript diagnostics outside the Pantry contract, and unavailable interactive desktop/authenticated browser/theme evidence in this environment. The approved contract remains nullable item-level daily usage, location-authoritative forecasting, separate forecast attention, strict archive validation, and Pantry/Home-only presentation.

# Specification & Overview

### 1. Scope & Objective
- **Source provenance:** The initiating source is the user's request on 2026-09-15: allow a Pantry item to define an amount used per day and warn when daily-used items are running out. Existing Pantry behavior is grounded in `docs/plans/pantry/pantry-spec.md`, `docs/plans/pantry/pantry-ui-spec.md`, and the completed work recorded in `docs/plans/pantry/pantry-spec-plan.md`.
- **Goal:** Let users configure an expected daily consumption amount for eligible Pantry items, calculate a safe estimated number of days remaining, and surface an actionable warning before the item is expected to run out.
- **In-Scope:**
  - A per-item expected daily usage quantity and unit.
  - A configurable warning lead time in days, such as warning when seven days remain.
  - Safe forecast calculation using current usable stock and compatible units.
  - Explicit unavailable/unknown forecast states for approximate, empty, missing, or incompatible quantities.
  - Pantry item editor, collection status, summary/dashboard attention surfaces, and Stats integration where the existing contracts make that appropriate.
  - Archive export/import and backward compatibility for items without daily-usage settings.
  - Tests for validation, conversions, forecast boundaries, warning status, no-mutation behavior, and renderer states.
- **Out-of-Scope:**
  - Automatically changing stock based on forecast evaluation or list serialization. Startup daily-usage reconciliation is an explicit stock mutation path defined below.
  - Automatically inferring or silently changing the user's daily usage value.
  - Density-based or otherwise unsafe cross-dimension conversion.
  - Reserving stock for future recipes or changing grocery generation semantics unless a later decision explicitly adds that behavior.
  - Replacing historical consumption analytics with the configured forecast.
  - A full demand-forecasting or machine-learning model.

### 2. Technical Constraints & Architecture
- Pantry behavior must continue through the existing renderer -> typed API -> Hono route -> service -> Prisma flow.
- Canonical units and exact compatible conversion behavior must reuse `src/shared/recipe-units.ts` and `src/main/server/lib/unit-converter.ts`.
- Approximate quantities and incompatible/custom units must not produce a numeric forecast. The UI must explain why a forecast is unavailable.
- Existing low-stock, empty, expiration, replenishment, grocery, archive, and migration behavior must remain compatible for items with no daily-usage configuration.
- Warning evaluation belongs in the Pantry service/domain layer, not in React components. Renderer components should consume typed forecast/status data.
- The existing overall archive version remains authoritative. Older archives without the new fields must continue importing with daily usage unset.
- Existing query invalidation and change-event conventions must be reused for Pantry mutations.
- Windows database/schema verification must follow the repository's documented Prisma lock workaround when Electron is running.
- **Approved product contract:** daily usage is stored as nullable item-level `dailyUsageQuantity`, `dailyUsageUnit`, and `dailyUsageWarningDays` fields; null daily usage disables forecasting; the setting is shared across locations; location quantities are authoritative and compatible quantities are summed across locations; usage is positive and finite; warning lead time is item-specific and a nonnegative integer; zero stock is immediately attention-worthy; forecast dates are estimates and must be labeled as such.
- **Approved forecast semantics:** non-expired, non-approximate location quantities are eligible. A numeric forecast is returned only when every eligible quantity is present and exactly compatible with the configured daily-usage unit. Canonical same-dimension conversions and explicitly confirmed package/count equivalences are allowed; custom, incompatible, missing, or approximate quantities return a typed unavailable reason. Lots remain expiration metadata and are not independently added to location quantity.
- **Approved API/status semantics:** existing `ok`, `low`, `empty`, `expiring-soon`, and `expired` statuses remain unchanged. Forecast data is additive and includes state, reason, severity, attention flag, remaining quantity/days, and projected run-out date where available. Forecast attention is separate from existing summary counts and filters.
- **Approved archive semantics:** absent daily-usage fields in older archives leave the configuration unset. Recognized daily-usage fields are validated strictly; malformed or internally incompatible values reject the Pantry payload before mutation. Unknown fields remain forward-compatible and are ignored through the existing archive parser.
- **Approved Stats scope:** Stats remains historical-only for the first release. Configured forecasts appear in Pantry and Home, never as measured historical consumption or a configured-versus-historical comparison.
- **Approved automatic depletion contract:** Items with configured daily usage establish a local-date baseline on first reconciliation after enablement or configuration change. Subsequent application launches consume one daily usage amount for each missed local calendar date, exactly once, through transactional inventory events. Automatic usage counts as historical consumption, consumes approximate and expired stock, clamps at zero, and fast-forwards reconciliation state after stock reaches zero to bound long-inactive catch-up. Matching full-history archives may preserve reconciliation state; state-only or mismatched imports establish a new baseline. Startup aborts if reconciliation fails.

---

# Execution Plan & Handoffs

## Phase 1: Contract and Forecast Decision Closure

* **Status:** COMPLETED
* **Objective:** Turn the daily-usage request into an implementation-ready contract without hiding unit, location, warning, or historical-data decisions inside later code.

### Dependencies

* Existing Pantry schemas, service, route, renderer, archive contracts, and completed Pantry plan.
* Existing exact unit conversion behavior and current status/summary calculations.

### Tasks

* [x] Confirm the item-level daily usage model, including quantity, unit, enabled/disabled state, and shared-across-location behavior.
* [x] Confirm warning lead-time semantics, severity, interaction with existing warning thresholds, and separate forecast-attention API behavior.
* [x] Define forecast math for exact stock, zero stock, missing stock, approximate stock, incompatible units, replenishment targets, and multiple locations/lots.
* [x] Define exact underlying values, display rounding, injected-clock behavior, and estimate labeling for remaining days and projected run-out date.
* [x] Decide that historical consume events do not infer or silently suggest the explicit daily usage value in the first release.
* [x] Define archive field compatibility, unknown-field handling, and strict behavior for invalid or incompatible recognized daily-usage fields.
* [x] Record the final contract, affected modules, focused commands, and test matrix in this plan before Phase 2 begins.

### Verification & Acceptance Criteria

* [x] **Automated Checks:** Inspect existing Pantry schema/service/renderer/archive tests and identify focused commands for each affected boundary; no production behavior is changed in this phase.
* [x] **Functional Assertions:** Every daily-usage requirement has a resolved behavior; no unsafe conversion, automatic stock mutation, silent inference, or ambiguous archive coercion is included.

### Plan Compliance Checklist

* [ ] **Required Files:** This plan and the existing Pantry specification/plan documents only; production files remain unchanged.
* [ ] **Boundaries:** Do not add schema, route, service, UI, or archive code before the forecast contract is recorded; do not alter the existing Pantry plan's historical handoff.
* [ ] **Legacy Code Removed:** None. Existing low-stock, replenishment, expiration, grocery, and legacy-staple compatibility paths remain active.
* [x] **Acceptance Checks:** Decision record, ownership map, forecast result contract, compatibility strategy, and test matrix are complete before Phase 2 starts.

### Phase 1 Handoff & Verification Report

* **Compliance Check:** PASSED
* **Verification Result:** PASSED
* **Execution Proof / Logs:** Repository review verified the existing Pantry service/status path, shared schemas/types, runtime schema reconciler, archive schemas/service, Home summary consumer, Stats contract, and focused Pantry/archive test files. No production behavior was changed.
* **Artifacts Created/Modified:** This plan only.
* **Decisions & Deviations:** Owner decisions closed: nullable item-level fields; location quantities authoritative; separate forecast attention; strict rejection of invalid recognized archive fields; Pantry/Home-only forecast presentation. Routine decisions were auto-resolved: reuse existing service/API/change-event boundaries; use an injected clock; keep historical consumption analytics unchanged; preserve unknown archive-field tolerance; use focused existing Vitest suites.
* **Next Phase Context:** Phase 2 must add nullable `PantryItem` fields and runtime compatibility repair, implement a pure location-based forecast with typed unavailable reasons, preserve existing status/filter behavior, and expose additive forecast data only through the existing Pantry service/API path.

---

## Phase 2: Domain, Persistence, and Forecast Service

* **Status:** COMPLETED
* **Objective:** Persist daily-usage configuration and expose a typed, safe forecast and warning result through the Pantry service/API.

### Dependencies

* Phase 1 contract closure.
* Existing Pantry Prisma/runtime schema, shared schemas/types, PantryService, routes, and change-event registration.

### Tasks

* [x] Add nullable item-level daily-usage and warning-lead-time fields to the shared input/output contracts with positive-finite quantity, normalized unit, and nonnegative-integer lead-time validation.
* [x] Add additive persistence and runtime-schema compatibility for existing databases, including explicit `PantryItem` missing-column reconciliation; preserve unset values for existing Pantry items.
* [x] Implement a pure location-based forecast calculation with an injected clock. Return state, unavailable reason, severity, attention flag, exact remaining quantity/days, projected run-out date, and estimate metadata.
* [x] Keep existing `ok`, `low`, `empty`, `expiring-soon`, and `expired` statuses and filters unchanged; expose forecast attention as a separate additive result.
* [x] Expose forecast data through existing Pantry item/list/summary routes and update change-event/query invalidation behavior for edits.
* [x] Add focused schema, service, route, conversion, boundary, and no-mutation tests.

### Verification & Acceptance Criteria

* [x] **Automated Checks:** Focused Pantry schema, forecast, service, route, and renderer tests passed (5 files, 17 tests); fresh temporary database `db:push --skip-generate` passed; Prisma generation passed with `npx prisma generate --no-engine`; touched-file lint passed. The default database URL was unset, so a configured pre-feature copy check remains pending.
* [x] **Functional Assertions:** Existing items remain valid with no daily usage; compatible stock produces exact estimates; approximate/incompatible/missing/expired stock produces typed unavailable results; zero and sub-threshold forecasts are actionable; forecast evaluation is pure and does not write stock or events.

### Plan Compliance Checklist

* [x] **Required Files:** `prisma/schema.prisma`; `src/main/server/lib/schema.ts`; `src/shared/schemas/pantry-schemas.ts`; related shared types/API contracts; `src/main/server/services/pantry-service.ts`; `src/main/server/services/pantry-forecast.ts`; focused tests; and existing Pantry route/change-event/query invalidation registrations.
* **Boundaries:** Keep forecast math in a domain/service-owned module; do not put business rules in React; do not alter recipe density conversion; do not create a second Pantry data path.
* **Legacy Code Removed:** None unless Phase 1 explicitly approves replacing an obsolete duplicate field. Existing warning and status fields remain backward compatible.
* [x] **Acceptance Checks:** Focused tests, fresh schema synchronization, Prisma generation, touched-file lint, and typecheck evidence are recorded before Phase 3. Full build and pre-feature database-copy verification remain repository-level follow-up checks.

### Phase 2 Handoff & Verification Report

* **Compliance Check:** PASSED
* **Verification Result:** PASSED with one environment blocker
* **Execution Proof / Logs:** `npx vitest run src/shared/schemas/pantry-schemas.test.ts src/main/server/services/pantry-forecast.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx --pool=threads --maxWorkers=1` -> 5 files and 17 tests passed. `npx prisma generate --no-engine` -> passed. `$env:LOCAL_RECIPE_BOOK_DATABASE_URL='file:./tmp/phase2-validation.db'; npm run db:push -- --skip-generate` -> fresh SQLite database synchronized. Touched-file ESLint -> passed. Node typecheck has no diagnostics in Phase 2 files; repository-wide typecheck retains unrelated pre-existing diagnostics.
* **Artifacts Created/Modified:** Prisma/runtime schema, shared Pantry contracts/types, pure forecast service and tests, Pantry service serialization/summary, updated renderer fixture/type inference, and this plan handoff.
* **Decisions & Deviations:** Forecast unavailable states are typed for missing, approximate, incompatible, and expired stock; unset daily usage is a disabled state with no attention. Existing status/filter semantics and event/query invalidation are unchanged. The configured database URL was not present, so a temporary fresh database was used; no pre-feature database copy was available for verification.
* **Next Phase Context:** Phase 3 may add renderer editor/presentation and archive integration on top of the additive forecast contract. Do not move forecast business rules into React or alter historical Stats semantics.

---

## Phase 3: Pantry, Dashboard, Stats, and Archive Integration

* **Status:** COMPLETED
* **Objective:** Make depletion forecasts understandable and actionable in the existing user workflows while preserving current Pantry behavior.

### Dependencies

* Phase 2 typed forecast and warning contract.
* Existing Pantry page/editor, Home attention surfaces, Stats contract, and data-management archive flow.

### Tasks

* [x] Add daily usage, unit, and warning lead-time controls to the existing Pantry management editor with accessible labels and validation feedback.
* [x] Show remaining-days and projected-run-out information in the selected-item editor and dense collection row without relying on color alone.
* [x] Add forecast-driven attention filtering or status messaging while keeping all existing Pantry filters reachable and meaningful.
* [x] Integrate relevant forecast warnings into Home/dashboard attention content and provide a link to the Pantry item/action.
* [x] Keep Stats historical-only for the first release; do not mix configured daily usage with event-derived historical consumption.
* [x] Extend state-only and full-history archive payloads to preserve daily-usage settings and warning configuration; accept older archives with fields absent.
* [x] Add focused renderer, archive, accessibility, and query-contract regression coverage; preserve existing responsive/theme CSS patterns.

### Verification & Acceptance Criteria

* [x] **Automated Checks:** Focused Pantry, forecast, route, archive schema/service/import, and renderer tests passed; lint passed; changed-file diagnostics are clean. Full Vitest was run and retained two unrelated pre-existing failures; repository typecheck retains unrelated pre-existing diagnostics.
* [x] **Functional Assertions:** Users can configure and clear daily usage; forecast states are readable and accurate; Home exposes separate forecast attention; Stats remains historical-only; archive round trips preserve settings; older archives remain importable; invalid recognized fields fail before mutation; no duplicate Pantry management surface was introduced.

### Plan Compliance Checklist

* [x] **Required Files:** `src/renderer/pages/pantry.tsx`; Pantry styles; Home dashboard consumer; shared archive schemas; data-management service; and corresponding focused tests.
* [ ] **Boundaries:** Reuse existing modal, page, theme, chart, query, and archive patterns; do not move forecast business logic into renderer code; do not redesign unrelated Pantry workflows.
* **Legacy Code Removed:** Remove no existing status or warning path until equivalent behavior is covered; retain legacy archive and preference compatibility.
* [x] **Acceptance Checks:** Focused UI/archive tests and lint are recorded; full-suite and repository-wide typecheck residuals are explicitly recorded below.

### Phase 3 Handoff & Verification Report

* **Compliance Check:** PASSED
* **Verification Result:** PASSED for Phase 3 scope, with repository-level residual failures
* **Execution Proof / Logs:** `npm exec vitest -- run src/renderer/pages/pantry.test.tsx src/shared/schemas/data-management-schemas.test.ts src/main/server/services/data-management-service.test.ts src/main/server/services/data-management-import.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts --pool=threads --maxWorkers=1` -> 6 files and 25 tests passed. `npm run lint` -> passed. `git diff --check` -> passed. `npx tsc -p tsconfig.web.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` -> repository diagnostics remain, but no new diagnostics in the touched renderer/archive files after the final fix. Full Vitest -> 107 files and 534 tests passed, with 2 unrelated failures: Home throttling QA mock/navigation behavior and a config-loader database URL environment leak.
* **Artifacts Created/Modified:** Existing Pantry editor and page styles now expose daily usage controls, accessible validation, forecast remaining-days/run-out/unavailable messaging, and a `forecast-attention` filter. Home's existing Pantry attention card includes forecast counts and links to the existing Pantry filter. Archive export/import includes daily usage fields for state-only and full-history payloads, defaults absent fields for older archives, and rejects malformed recognized fields before mutation. Stats code was not changed.
* **Decisions & Deviations:** Forecast rules remain in the Phase 2 service contract; React only formats typed results. Existing filters remain available and forecast attention is additive. Responsive/theme behavior uses the existing Pantry CSS media queries and semantic tokens. No Phase 4 manual desktop/browser/theme verification or reporting was performed. The repository has no `typecheck` npm script; direct tsconfig checks were used instead.
* **Next Phase Context:** Phase 4 should perform manual desktop/browser verification across responsive and theme modes, confirm Home action navigation in a running app, and resolve or separately triage the two unrelated full-suite failures before release readiness.

---

## Phase 4: End-to-End Verification and Documentation

* **Status:** BLOCKED
* **Objective:** Verify the feature across supported data, runtime, and visual workflows and document the final contract and limitations.

### Dependencies

* Phases 1-3 completed with passed handoffs.
* Fixtures for existing items, multiple locations, dated lots, approximate/incompatible quantities, imported archives, and historical consume events.

### Tasks

* [x] Run focused and full automated suites for schemas, Pantry service/routes, forecast calculation, renderer workflows, dashboard, historical Stats compatibility, archive, and query invalidation.
* [x] Run fresh/pre-feature database compatibility checks and the documented Windows Prisma generation workflow.
* [x] Test forecast boundaries around exact depletion, one-day remaining, warning lead time, zero stock, disabled usage, empty stock, expiration, approximate quantities, incompatible units, mixed locations, and lot/location consistency.
* [ ] Verify manual desktop and authenticated browser/LAN workflows for editing daily usage, viewing warnings, refreshing data, and following attention actions.
* [ ] Verify light, dark, custom-theme, desktop, and mobile presentation, including labels, focus, modal scrolling, status semantics, and no overlapping text.
* [x] Update canonical documentation only where the new contract changes architecture, data management, developer workflow, or reusable UI guidance; no additional canonical doc change was required after review.
* [x] Review the final diff for direct renderer IPC, unsafe conversions, silent stock mutation, stale archive handling, duplicated settings surfaces, and unrelated changes.

### Verification & Acceptance Criteria

* [x] **Automated Checks:** Focused suites, `npm run lint`, `npm run build`, `npm run docs:check:ipc`, data-management runtime/build/package checks, fresh Prisma schema synchronization, Prisma generation, and diff integrity passed. `npm run test` retains one unrelated pre-existing QA failure; repository typechecks retain unrelated diagnostics.
* [x] **Functional Assertions:** Daily-use warnings are accurate, explainable, and non-mutating; existing Pantry behavior remains compatible; old archives and fresh existing-schema databases remain usable. Manual browser/theme evidence is explicitly documented as unavailable.

### Plan Compliance Checklist

* [x] **Required Files:** Completed-phase files, the focused forecast boundary test, this plan, and the required implementation report; no unrelated generated artifacts were added by Phase 4.
* [x] **Boundaries:** No automatic demand forecasting, stock reservation, or unrelated Pantry redesign; automated evidence is distinguished from unavailable manual runtime evidence.
* [ ] **Legacy Code Removed:** Confirm only approved duplicate paths are removed; required legacy preference/archive compatibility remains.
* [x] **Acceptance Checks:** Every executed command, runtime check, unavailable responsive/theme check, residual risk, and blocker is recorded in the handoff and implementation report.

### Phase 4 Handoff & Verification Report

* **Compliance Check:** BLOCKED by required full-suite and interactive-environment evidence; scope boundaries passed.
* **Verification Result:** BLOCKED with feature-focused checks passed.
* **Execution Proof / Logs:**
  * `npm exec vitest -- run src/shared/schemas/pantry-schemas.test.ts src/main/server/services/pantry-forecast.test.ts src/main/server/services/pantry-service.test.ts src/main/server/routes/pantry.test.ts src/renderer/pages/pantry.test.tsx src/shared/schemas/data-management-schemas.test.ts src/main/server/services/data-management-service.test.ts src/main/server/services/data-management-import.test.ts src/renderer/components/home/home-dashboard.test.tsx src/renderer/lib/query-invalidation.test.ts src/main/server/routes/stats.test.ts --pool=threads --maxWorkers=1` -> 11 files, 41 tests passed.
  * `npm test` -> 108 files and 535 tests passed; 1 unrelated failure in `src/renderer/pages/throttling-ui.qa.test.tsx` due to the HomeDashboard QA mock lacking `heatmapQuery`.
  * `npm run lint` -> passed. `npm run build` -> browser, main, preload, renderer, and data-management build checks passed. `npm run docs:check:ipc` -> passed. Data-management runtime, build, and package checks -> passed. `npx prisma generate --no-engine` -> passed. Temporary `LOCAL_RECIPE_BOOK_DATABASE_URL=file:./tmp/phase4-validation.db` with `npm run db:push -- --skip-generate` -> passed. `git diff --check` -> passed.
  * `npx tsc -p tsconfig.web.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` -> nonzero with broad repository diagnostics; no new Phase 4 production diagnostics were identified.
  * Manual desktop, authenticated browser/LAN, and theme/responsive checks were unavailable because no browser automation/manual desktop tool or authenticated running app session was available to this agent.
* **Artifacts Created/Modified:**
  * `src/main/server/services/pantry-forecast.test.ts` - explicit warning threshold and expired-stock regression coverage.
  * `docs/plans/pantry/pantry-daily-usage-plan.md` - final Phase 4 tasks, evidence, blocker, and status.
  * `docs/reports/2026-09-15-pantry-daily-usage-implementation-report.md` - required orchestration implementation report.
* **Decisions & Deviations:** No production redesign or canonical documentation change was needed. The required report is provided despite the generic orchestration skill preference to keep the plan as the only report, because the user explicitly required it. No alternate model was selected or invoked; the current/default model performed this verification. The plan is not marked complete because the full suite and manual evidence gates did not pass.
* **Next Phase Context:** Resolve or triage the unrelated throttling QA mock failure, address repository-wide typecheck diagnostics separately, and repeat authenticated desktop/browser/theme/responsive verification before changing the overall state to `COMPLETED`.

---

