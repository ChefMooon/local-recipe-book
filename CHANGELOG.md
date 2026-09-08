# Changelog

All notable changes to this project will be documented in this file.

## [1.2.7] - 2026-09-08

### Added

- Meal duplication now lets you choose which enabled meal types to copy, including custom and date-ranged meal slots.
- Recipes can now be exported from their detail view as print-ready PDFs, HTML, Markdown, or CSV, with selectable recipe sections.
- Desktop update behavior is now configurable, with clearer controls for checking, downloading, deferring, and installing updates.

### Fixed

- Improved the mobile recipe detail header so actions and recipe information remain usable on smaller screens.
- Stabilized meal-plan printing and exporting on mobile, including modal layout and print controls.

## [1.2.6] - 2026-09-01

### Added

- Settings are now organized into clearer categories, making preferences easier to find.
- Renderer controls now include accessible tooltips to improve navigation and understanding.

### Changed

- Improved cold-start loading performance for the meal plan.

### Fixed

- Meal-plan duplicate interactions are more reliable and resist accidental repeated actions.
- Mobile layouts now preserve usable bottom scroll space and keep prep and grocery-list headers visible.
- Meal-plan edit styling is more consistent, including meal-type controls.
- Recipe advanced filters now preserve their expanded state.

## [1.2.5] - 2026-08-25

### Fixed

- API authentication now consistently rejects unauthenticated requests when configured server tokens are present.

## [1.2.4] - 2026-08-25

### Added

- Pairing codes now renew automatically, helping connected PWA and LAN clients stay available longer.
- Multiple clients can now synchronize recipe-book and meal-plan changes live.
- The `/connect` screen now has separate host and port fields, a segmented pairing-code input, and a token visibility toggle.

### Changed

- The app now shuts down faster.

### Fixed

- Improved standalone PWA headers on iOS by correcting safe-area handling and clearing the iPad status-bar inset.
- Meal-plan week drag-scroll bands now appear only when scrolling is available.
- Restored the `+ Add` action for week slots containing a single meal.

## [1.2.3] - 2026-08-23

### Added

- Added one-time pairing codes to make connecting supported PWA and LAN clients easier.
- Added drag navigation for the meal-plan week view, including sticky panes and automatic week flipping at the board edges.

### Fixed

- Improved mobile meal-plan actions and protected the mobile header from iOS safe-area overlap.
- Refined the slot manager modal and theme styling for a more consistent experience across supported themes.
- Corrected home-page greeting alignment and prevented stale assets from being served to LAN clients.
- Updated the mobile navigation drawer to use the correct theme colors.

## [1.2.2] - 2026-08-21

### Added

- Meal plan duplication can now target specific enabled meal types, including custom and date-ranged meal slots.
- Added forward-only week navigation with a direct return to the current week.
- Added drag-hover week switching for moving meals across week boundaries.
- Recipe search and sorting now use a consolidated filter card with expandable advanced filters.

### Changed

- Improved compact week-board layouts so long meal names and custom labels wrap cleanly while preserving horizontal scrolling.

### Fixed

- Stabilized cross-week meal dragging and prevented accidental or historical week navigation.
- Dashboard upcoming meals now apply meal-type cutoff rules consistently.
- Improved chart and heatmap tooltip contrast across light and dark themes.

## [1.2.1] - 2026-08-20

### Fixed

- Corrected the database filename.

## [1.2.0] - 2026-08-20

### Changed

- Completed the Local Recipe Book naming update across the app and its configuration, storage, and connection surfaces. Existing content can be recovered through an `all` `.lrb` export and re-import.

## [1.1.2] - 2026-08-20

### Added

- Added backup and restore tools in Settings so users can protect and recover their local recipe book data.
- Added configurable meal-type cutoff times so dashboard counts reflect only meal slots that are still active for the current day.

### Changed

- Refined meal-plan add and edit dialogs with a more compact layout and smoother meal-entry flow.
- Desktop users are now prompted when an update is available so they can install it more easily.

### Fixed

- Recipe ingredient conversion now preserves cup measurements and applies flour density conversions more accurately.
- Corrected meal-plan drop-intent popover styling in supported themes.

## [1.1.1] - 2025-08-14

### Added

- Imported recipes now include clickable source links so you can open the original recipe directly.

### Changed

- Upcoming meals on the dashboard are now grouped more clearly by meal and day.
- Renamed the Settings “Connection” tab to “Network” and refined its placement for easier navigation.

### Fixed

- Corrected dark-theme styling inconsistencies across the meal plan, dashboard, and settings views.

## [1.1.0] - 2025-08-13

### Added

- Added desktop lifecycle controls for launch-at-login, launch minimized, close-to-tray behavior, and theme preferences, along with a Connection section for viewing app and server diagnostics.
- Added configurable light, dark, and system theme options.
- Added repeatable recipe-ingestion tests and improved URL recipe importing, including earlier duplicate detection.
- Added a setting to remember the desktop window position and size between restarts.

### Changed

- Improved meal-plan date navigation and refreshed its dark-theme behavior.
- Updated the interface iconography and refined settings controls for a clearer, more consistent experience.

### Fixed

- Fixed the Update Default Meal Plan Profile modal, scrolling now works
- Fixed the meal add/edit modal rendering so stray `disabled=` text no longer appears above the form fields.
- Fixed recipe cards so favorite-state changes are reflected immediately.
- Improved prep-list item styling.

## [1.0.0] - 2026-05-27

### Changed

- Breaking: Copilot Chef has been rebranded as Local Recipe Book and the Copilot chat workflow has been removed in favor of a local-first meal-planning experience.
- Home and dashboard surfaces were refreshed with clearer upcoming meal summaries, cleaner action layouts, and stronger responsive behavior.
- The meal-planning workflow now supports faster calendar management with day and week quick actions, month popover improvements, batch slot actions, and drag-and-drop stability fixes.
- The browser and LAN experience is more reliable, including better host normalization and a dedicated browser connect route.
- The web and Electron bundles now load more efficiently through chunk splitting and lazy loading for heavier renderer paths.

### Added

- Added meal reordering, meal duplication, linked recipe navigation, meal sub-type management, side default templates, and header-level undo/redo controls to the meal planner.
- Added meal photos, made-history tracking, and recipe library improvements including duplication, lineage tracking, sortable saved views, and preserved fractional ingredient units.
- Added ongoing grocery-list support, shop completion controls, and a prep-list planning workflow.
- Added expanded workspace and IPC documentation to support the current Electron, browser, and LAN architecture.

### Fixed

- Fixed duplicate-recipe conflict handling so recipe-save flows behave more predictably.
- Fixed recipe last-made synchronization so linked meals and recipes stay aligned.
- Fixed the meal-plan drawer drag lifecycle and slot-hover behavior to reduce scheduling glitches.
- Fixed local pre-development startup requirements around Prisma engine binaries.

## [0.1.1] - 2026-04-30

### Added

- Browser clients now detect when their access token has been revoked or expired and are automatically redirected to the pairing screen with a clear reason message.
- Added helpful field hints in Settings for the browser URL and access link to make LAN pairing easier to understand.
- Confirmation dialog added before resetting browser access to prevent accidental disconnects.

### Fixed

- The app now retries loading its server connection on startup (up to 5 attempts) and displays a meaningful error message instead of a blank loading screen when the server is unreachable.
- Pages and components now update immediately after the server reconnects, eliminating stale data shown after a reconnect.
- Progressive web app start URL corrected so that pairing links work correctly when Copilot Chef is installed as a PWA.
- Browser clients connected via old link formats are now recognized and handled automatically without requiring manual re-pairing.

### Changed

- The "Rotate token" button in Settings has been renamed to "Reset browser access" for clarity.

## [0.1.0] - 2026-03-30

Initial release of Copilot Chef.

### Added

**Desktop client** (`client-v0.1.0`)

- Tauri 2 desktop app for Windows, macOS (universal), and Linux
- Meal plan page with day, week, and month calendar views
- Drag-and-drop meal rescheduling and trash-drop deletion with undo
- Grocery list page with categorized checklist and completion progress
- Recipe book with search, filtering, and full recipe detail view
- Stats dashboard with meal heatmap, meal-type breakdown, cuisine breakdown, weekly trend, and top meals
- Settings page with dietary preferences, household size, cuisine preferences, AI persona selection, and reply-length control
- Floating AI chat panel with streaming responses, slash commands, inline choice buttons, and session history browser
- In-app auto-update via Tauri updater plugin

**Server** (`server-v0.1.0`)

- Hono API server with routes for meals, grocery lists, recipes, preferences, personas, stats, chat sessions, and meal logs
- GitHub Copilot SDK integration with streaming chat, multi-session support, and context-aware system prompt
- Copilot tools: add/remove/move meals, suggest meals, manage grocery items, save recipes
- Bearer token authentication middleware with optional machine-auth mode
- SQLite persistence via Prisma with WAL mode
- `copilot-chef-server` CLI with `start`, `version`, `config`, `db`, and `update` commands
- Server self-update check against GitHub Releases (`server-v*` tags)

**Core and shared packages**

- `@copilot-chef/core`: Prisma schema, domain services (MealService, GroceryService, RecipeService, PreferenceService, PersonaService, MealLogService, ChatHistoryService), and CopilotChef orchestration
- `@copilot-chef/shared`: shared Zod schemas, config schema (TOML), and API path constants
