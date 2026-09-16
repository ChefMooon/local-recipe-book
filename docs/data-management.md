# Data Management Archive

This guide is for contributors and operators who need to understand the Local Recipe Book backup and restore contract. The canonical implementation lives in `src/shared/schemas/data-management-schemas.ts`, `src/main/server/lib/data-archive.ts`, and `src/main/server/services/data-management-service.ts`.

## Ownership and Runtime Boundary

The embedded Hono server owns archive assembly, validation, conflict planning, database writes, and photo-file writes. ZIP bytes are created and extracted in the Electron main/server process with the pure-JS `fflate` dependency. The renderer only calls typed API wrappers and the platform adapter.

Database schema ownership remains separate from the archive boundary. `prisma/schema.prisma` is the declarative Prisma schema, while `src/main/server/lib/schema.ts` owns the runtime raw SQL needed to create missing tables and indexes, reconcile selected columns on older databases, and perform known compatibility repairs. `src/main/server/lib/bootstrap.ts` runs that compatibility layer during database initialization. The project does not maintain a Prisma migration directory, and archive import/export does not apply SQL schema migrations.

Electron file dialogs are the only native file boundary:

- `data-management:openArchive` returns selected archive bytes and the selected path, or a canceled/error result.
- `data-management:saveArchive` writes bytes supplied by the renderer to a user-selected path, or returns a canceled/error result.
- The renderer cannot request arbitrary filesystem reads or writes.
- The existing HTTP API remains the service boundary. Desktop IPC only carries the file handoff needed by native dialogs.

Browser and LAN clients do not have native file capabilities. The archive portion of the Settings tab stays available as an explicit unsupported state, while preference reset remains available because it uses the authenticated API and does not require a native file dialog. Neither path invokes `window.api` directly from renderer code.

## Archive Contract

The new archive format is a ZIP file with the `.lrb` extension. The current supported format is:

| Field                  | Value                                        |
| ---------------------- | -------------------------------------------- |
| Format                 | `local-recipe-book`                          |
| Format version         | `1`                                          |
| Schema version         | `1`                                          |
| Domain payload version | `1`                                          |
| Default filename       | `local-recipe-book-{scope}-{YYYY-MM-DD}.lrb` |

Every archive contains `manifest.json` and one JSON file per domain. Meal photos use the `assets/meal-photos/` namespace.

```text
manifest.json
data/meal-plan.json       # meal-plan and all scopes
data/recipes.json          # every scope
data/grocery.json          # all scope
data/prep-lists.json       # all scope
data/preferences.json     # all scope
data/pantry.json           # all scope: current state and optional history
assets/meal-photos/*.jpg  # or avif, gif, png, webp
```

The manifest records the application version, export timestamp, selected scope, domain versions, asset metadata, and the ID policy. Source IDs are preserved in payloads for reference and review, but import always builds an ID map before dependent records are written.

### Scope semantics

| Scope       | Included data                                                                                                                                                          | Excluded data                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `meal-plan` | Scheduled and unscheduled meals, meal-type profiles/definitions, meal sub-type definitions, referenced recipes, recipe lineage/link closure, and available meal photos | Grocery lists, prep lists, preferences         |
| `recipes`   | Recipes, ingredients, tags, source metadata, lineage, and linked recipe records                                                                                        | Meals, photos, grocery/prep lists, preferences |
| `all`       | Everything in `meal-plan`, plus the complete recipe library, grocery lists/items, prep lists/items, checked state, allowlisted preferences, and Pantry state           | Secrets and runtime/device configuration       |

Pantry archives always identify whether inventory history is included with the
`historyIncluded` payload field. State-only imports preserve current locations,
lots, packages, aliases, and warning rules, then create one imported-baseline
event per imported item/location. Full-history imports preserve event metadata
and de-duplicate events by `sourceIdentity` (or a deterministic archive event
identity when the source did not provide one).

Pantry attention and exact grocery associations are included in `all` archives.
Import resolves grocery list and item IDs before restoring Pantry links or
linked attention. A missing grocery item is recorded in the import result as a
stale reference, and the restored link and linked attention are inactive; a
missing record can never restore an active suppression. Imported positive usable
quantity increases reconcile an until-restocked mute after the transaction.
Attention remains additive to raw status, so archive restore does not turn an
empty or low item into an `ok` item and does not hide expiring, expired, or
unavailable forecast attention.

Meal-plan exports include every meal returned by the meal service, including unscheduled meals. A recipe dependency is included when a meal references it, and the recipe exporter closes over source-recipe and linked-sub-recipe references. Recipe-only archives never contain photo assets.

Dates are normalized to ISO 8601 strings, nullable values remain `null`, and JSON-backed database fields are serialized into typed arrays or records rather than copied as opaque database strings. Archive entries are sorted before ZIP creation to keep layout and output ordering deterministic.

## Security and Validation Limits

Validation happens before database mutation or photo writes. The parser rejects unknown archive entries, duplicate entries, malformed JSON, unsupported format/schema/domain versions, missing scope payloads, missing references, undeclared assets, invalid checksums, and asset metadata that does not match its file extension.

The extraction limits are deliberately finite:

| Limit                  | Current maximum |
| ---------------------- | --------------: |
| Compressed archive     |          64 MiB |
| Uncompressed contents  |         128 MiB |
| Archive entries        |             512 |
| Individual photo asset |           8 MiB |
| Photo assets           |             100 |

Only `image/avif`, `image/gif`, `image/jpeg`, `image/png`, and `image/webp` are accepted. ZIP64 and encrypted entries are rejected. Entry names must use the canonical layout, UTF-8, forward slashes, and safe path components; absolute paths, drive-qualified paths, backslashes, NUL bytes, and `..` traversal are rejected. Photo entries are verified against the manifest SHA-256 checksum, byte size, meal ID, MIME type, and original filename.

Archives never contain the SQLite database, WAL/SHM files, raw settings, API keys, machine tokens, remote connection credentials, runtime settings, or device identity. The preferences payload is an explicit allowlist of household and planning preferences only. Replace restores those preferences only when the user enables the separate restore-preferences option.

The archive `schemaVersion` is a version for the `.lrb` payload contract, not the SQLite schema. A database schema change must be handled through the Prisma schema and runtime compatibility layer before archive workflows are tested against it. Export an `all` archive before testing an upgrade or a destructive change; keep the resulting recovery archive outside temporary storage.

## Export and Import Flow

Authenticated archive endpoints are registered under `/api/data-management`:

| Method | Path                                                        | Purpose                                                                                     |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET`  | `/api/data-management/export?scope=meal-plan\|recipes\|all` | Creates an archive and returns `application/zip` with a stable download filename            |
| `POST` | `/api/data-management/import/validate`                      | Extracts and validates a base64 archive without mutation                                    |
| `POST` | `/api/data-management/import/preview`                       | Validates the archive, reads local identities, and produces a non-mutating conflict preview |
| `POST` | `/api/data-management/import/apply`                         | Applies an explicit `merge` or `replace` request after validation and decisions             |

The current transport uses a JSON body containing a base64 `archive` string. Apply requests additionally contain `mode`, an optional ID map, conflict decisions or a bulk decision, and `restorePreferences` (false by default). Structured errors distinguish invalid requests, invalid/unsupported archives, required conflict decisions, disabled replace, and apply failures.

### Merge preview and decisions

Preview does not mutate the database or filesystem. Identity matching is deterministic: recipes use normalized source URL and title, meals use date/meal type/name/sort order, lists use date/name, items include their parent and stable item fields, meal-type profiles use name, definitions use profile plus slug, sub-types use slug, and preferences use the default record.

When conflicts exist, apply requires explicit decisions. `keep-local`, `skip`, and `import` are available for safe bulk actions; individual records may also use `replace`. Imported IDs are remapped before recipe, meal, grocery, prep, Pantry, and photo references are written. Pantry conflicts are grouped at the normalized item identity; same-location quantities are never silently merged. Separate locations remain separate, while non-conflicting Pantry records can import and unresolved conflicts remain visible in the review result. Unselected records are not silently overwritten, and the result reports imported, skipped, replaced, unresolved, conflict, and asset counts.

Attention records and Pantry grocery links follow the same mapped-ID and
conflict decisions. They are exact-ID associations, not normalized-name
matches. Deleted grocery records close their active link and restore eligible
Pantry attention; deleting a Pantry item removes its associated active state.
Warning-rule and stock-mode edits cause attention to be re-evaluated from the
current raw status and forecast rather than changing inventory truth.

### Preference reset

The Settings page exposes one confirmed `Reset preferences` action in Data Management. It resets editable `UserPreference` values through the existing preferences API, refreshes the preferences query, clears pending local preference drafts, and preserves the selected Settings category and search query. It does not delete or mutate recipes, meals, meal plans, archives, app settings, device settings, or network configuration. Browser and LAN sessions can use this action; native archive export/import remains desktop-only.

### Replace and recovery

Replace is available only for a validated `all` archive and requires explicit confirmation in the Settings UI. Before mutation it:

1. Creates a fresh `all` archive of the current content and writes it as a recovery `.lrb` file.
2. Extracts and stages photo assets in a temporary directory.
3. Clears content, including Pantry records and events, and writes the imported content inside the Prisma transaction boundary.
4. Writes only accepted photo assets and removes old photo files after the database transaction succeeds.

Replace is content-only by default. Preferences remain local unless the explicit allowlisted restore option is enabled. A transaction failure does not retain database changes; photo files written before failure are deleted as compensation, and temporary staging is cleaned up when the process remains alive. The recovery archive is returned in the result so the user can retain it. Photo deletion after a successful transaction is best-effort, so a failed cleanup can leave an orphaned old photo file without changing database state.

There is no automatic process restart or automatic recovery-archive re-import. A process interruption during staging or before transaction completion leaves the database transaction to SQLite/Prisma and may leave temporary files for operating-system cleanup. Treat the returned recovery archive as the operator rollback point and keep it outside the temporary directory when long-term recovery is required.

## Build and Packaging Checks

`fflate` is a production dependency because electron-vite externalizes main-process dependencies and Electron Builder must provide it at runtime. The following checks are wired into normal workflows:

```bash
npm run check:data-management:runtime  # dependency and source boundary; used by dev
npm run build                          # electron-vite build plus main-bundle check
npm run build:unpack                   # unpacked Electron build plus app.asar check
npm run build:win                      # Windows installer plus app.asar check
```

The package check looks for `out/main/index.js` and `node_modules/fflate/package.json` inside a fresh `app.asar`. `DATA_MANAGEMENT_PACKAGE_PATH` can point the check at a specific `app.asar` when inspecting a CI artifact. Prisma packaging remains governed by the existing `build.extraResources` entries for `.prisma`, `@prisma/client`, and `@prisma/engines`.

On Windows, stop running Electron processes before `npm run db:push` or `npm run db:generate` if the Prisma engine is locked. The documented `--skip-generate` and `--no-engine` workaround remains available in the developer guide.

## Tests and Fixtures

The focused archive command is:

```bash
npx vitest run src/main/server/lib/data-archive.test.ts \
  src/main/server/services/data-management-service.test.ts \
  src/main/server/services/data-management-import.test.ts \
  src/main/server/routes/data-management.test.ts \
  src/shared/schemas/data-management-schemas.test.ts
```

Archive tests create in-memory ZIP fixtures with `fflate` and cover canonical round trips, checksum verification, traversal, unsupported assets, and uncompressed-size limits. Service import tests use mocked Prisma transactions, photo boundaries, and recovery-backup writers; they cover secret exclusion, conflict ID mapping, content-only replace, preference opt-in, and cleanup after an injected transaction failure. Renderer API/platform and Settings tests cover response parsing, browser unsupported behavior, native dialog cancellation, and query invalidation.

Run the complete delivery checks with:

```bash
npm run test
npm run lint
npm run build
npm run docs:check:ipc
```

Manual Windows installer, native dialog, real photo restoration, and interrupted-process recovery checks require a packaged Electron runtime and fixture database. They are not represented as completed by the automated commands alone.
