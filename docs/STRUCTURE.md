# Local Recipe Book Documentation Structure

## 1. Core Documentation Map

| Topic                                 | File                                                       | Summary                                                                                        |
| ------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Workspace instructions                | `../.github/copilot-instructions.md`                       | High-signal routing guide with project overview and common pitfalls                            |
| Developer workflows and commands      | `developer-guide.md`                                       | Setup, run, test, build, and feature implementation workflow                                   |
| System architecture and runtime model | `architecture.md`                                          | Process boundaries, data flow, auth, and runtime modes                                         |
| Data management archives              | `data-management.md`                                       | Archive format, scopes, validation, restore, security limits, and fixtures                     |
| Pantry inventory                      | `pantry.md`                                                | Pantry workflows, stock modes, grocery integration, forecasts, migration, and data boundaries  |
| App configuration and settings        | `local-recipe-book-config.md`                              | Environment variables, app settings, and preference contracts                                  |
| LAN and browser access                | `lan-browser-access.md`                                    | Trusted-device LAN/browser access, token lifecycle, and operations                             |
| Electron IPC contracts                | `ipc-channels.md`                                          | Canonical request-response and push channel reference                                          |
| Frontend visual and UX standards      | `STYLE-GUIDE.md`                                           | UI style system and frontend implementation expectations                                       |
| Browser page QA implementation plan   | `browser-page-qa-plan.md`                                  | Sequential browser route QA plan, matrix, severity rubric, and execution workflow              |
| Browser page QA findings log          | `browser-page-qa-findings.md`                              | Issue log and per-route completion matrix for the current QA cycle                             |
| Browser page remediation planning     | `browser-page-remediation-plan.md`                         | Template for quick-win and deep-refactor fix planning after QA completion                      |
| Test coverage status                  | `TEST.md`                                                  | Current automated test snapshot, coverage map, and gaps                                        |
| Architecture improvement plan         | `plans/local-recipe-book-architecture-improvement-plan.md` | Proposed, review-only plan for locking and improving the current architecture                  |
| Final release readiness plan          | `plans/final-release-readiness-plan.md`                    | Database, backup, packaged-build, and operator checks required before the initial beta release |
| Recipe export shared architecture     | `plans/recipe-export-shared-architecture.md`              | Shared renderer/server export infrastructure and domain boundaries for future recipe formats   |
| Customizable themes frontend plan     | `plans/customizable-themes-frontend-plan.md`               | Future implementation plan for applying and editing the existing custom theme profile contract |
| Release process                       | `release-guide.md`                                         | Packaging and release workflow guidance                                                        |

Active documentation filenames use the Local Recipe Book identity. Historical `docs/archive` content may retain former identifiers as historical context.

---

## 2. Archive Layout

| Directory           | Contents                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| `archive/plans/`    | Completed feature plans and superseded architecture proposals               |
| `archive/copilot/`  | Paused Copilot integration plans and research                               |
| `archive/research/` | Historical research that is not an active implementation reference          |
| `archive/`          | Historical operational guides that no longer describe the supported runtime |

## 3. Maintenance Rules

1. Keep one source of truth per topic and link to it from other docs.
2. When adding or changing IPC channels, update `ipc-channels.md` in the same change.
3. When adding or changing settings, update `local-recipe-book-config.md` in the same change.
4. When changing build/test/dev commands, update `developer-guide.md` in the same change.
5. For frontend/UI behavior changes, verify alignment with `STYLE-GUIDE.md`.
