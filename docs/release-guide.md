# Release Guide

This guide covers the current GitHub Actions release flow for the Electron app.

---

## How Releases Work

| Artifact                      | Workflow trigger                      | Workflow             | Output                                             |
| ----------------------------- | ------------------------------------- | -------------------- | -------------------------------------------------- |
| Local Recipe Book desktop app | `workflow_dispatch` on a `v*` tag ref | `release-client.yml` | GitHub Release draft + Windows installer artifacts |

The publish-release skill prepares the release commit, creates a draft against that commit, and dispatches the workflow on the exact tag. A tag push alone does not start the release workflow.

## Before Release

- Ensure the release metadata is committed on `main` with a message such as `chore: prepare v1.1.1 release`, then push that commit to `origin` before creating the draft or tag.
- Update `package.json` `version` to match the intended release.
- Update `CHANGELOG.md` if you are maintaining release notes.
- Run `npm run prepare:release-notes` to extract the matching version section from `CHANGELOG.md`. The generated `release-notes-windows.md` file is disposable packaging input and is ignored by git.
- Verify local validation passes:

```bash
npm run lint
npm run test
npm run build
```

The release workflow reruns build, lint, and test on GitHub before packaging. A failed build leaves the draft unpublished and available for a later dispatch.

---

## Create a Release

The publish-release skill creates the GitHub Release draft through the REST API after local validation and release metadata preparation. It supplies the verified release commit SHA as `target_commitish`, sets the draft title to the exact tag, verifies that the tag resolves to that commit, then dispatches `Release Client` with the tag ref and expected SHA. The workflow independently checks the ref, checked-out commit, peeled tag target, package version, draft identity, and existing asset names before installing dependencies or building. After a successful run, the skill updates the draft body with the validated changelog entry and verifies the resulting notes and assets. Leave the release as a draft until it has been reviewed.

CI runs for pull requests targeting `main`. Direct pushes to `main` do not start a separate CI run. The release workflow is available through `workflow_dispatch` and must exist on the default branch. It runs the full build, lint, and test checks before uploading draft assets.

For the final handoff, use the authenticated draft editor URL `https://github.com/OWNER/REPOSITORY/releases/edit/TAG`, replacing `OWNER/REPOSITORY` with the verified GitHub remote slug and `TAG` with the exact release tag. The GitHub API can return a temporary `html_url` containing an `untagged-*` slug for an unpublished draft; that URL is not canonical and can return 404. The releases page, `https://github.com/OWNER/REPOSITORY/releases`, is the secondary navigation fallback.

To manually retry packaging after confirming the existing draft and tag still match the intended commit, dispatch the workflow with the exact tag and full commit SHA:

```powershell
gh workflow run release-client.yml --repo OWNER/REPOSITORY --ref v1.0.0 -f expected_commit_sha=FULL_COMMIT_SHA
```

Replace the repository slug, tag, and SHA with the verified values. Do not use this command to create a draft or move a tag; the release skill owns those checks.

---

## What the Workflow Does

`release-client.yml` runs on `windows-latest` and:

1. Checks out the dispatched tag ref.
2. Verifies that the ref is a supported `vMAJOR.MINOR.PATCH` tag, the expected full commit SHA matches both `HEAD` and the peeled tag target, and `package.json` has the tag's version.
3. Verifies exactly one release exists for the tag and it has the exact tag/title and remains a draft.
4. Lists all draft assets and allows only unique names for the expected versioned Windows installer, its `.blockmap`, and `latest.yml`; unexpected or duplicate assets fail before packaging.
5. Installs dependencies with `npm ci` and generates the Prisma client.
6. Extracts the package version's release notes from `CHANGELOG.md` into the generated packaging file.
7. Builds the Electron app with `npm run build` (which includes a prebuild step that runs `build:web` first, producing both the browser renderer bundle and the Electron app).
8. Reruns `npm run lint` and `npm run test`.
9. Packages and uploads the Windows installer and updater assets to the existing GitHub Release draft in one Electron Builder invocation. The GitHub publish configuration sets `releaseType` to `draft`; the workflow does not publish the release.
10. Verifies that `dist/latest.yml` contains non-empty `releaseNotes`.

The workflow uses the repository `GITHUB_TOKEN` to upload the release assets defined by the Electron Builder config in `package.json`. The release remains a draft for review and manual publication. A normal Windows release has one installer `.exe` plus two required updater assets: the matching `.blockmap` and `latest.yml` (three assets total). The blockmap and `latest.yml` are metadata for the same installer, not additional installer artifacts or duplicate releases.

The preflight permits an empty draft or a partial upload containing only the unique expected asset names. The pinned Electron Publisher replaces an existing same-name asset when retrying an upload conflict, so the skill can dispatch another run after rechecking the draft. Unknown or duplicate asset names are not cleaned up automatically; inspect and resolve those manually before retrying. After the workflow succeeds, the skill updates the draft body with the validated `CHANGELOG.md` entry, preserving generated release text and avoiding duplicate changelog content. Verify the matching SHA/ref, successful workflow conclusion, exact draft tag/title, changelog text, one installer `.exe`, its matching `.blockmap`, and `latest.yml` before publishing or treating the release as complete. Multiple matching installers, duplicate asset names, or multiple releases for one tag are ambiguous and must stop the release process.

The breaking Local Recipe Book identity uses package slug `local-recipe-book` and Electron app ID `com.local-recipe-book.app`. Existing installs do not retain update continuity after the app ID change. Before upgrading, export an `all` `.lrb` archive, install the new build as a new application identity, and re-import the archive into its fresh database. The archive restores supported content and allowlisted preferences, not raw settings, tokens, secrets, or device configuration.

---

## Verify the Release

1. Open the authenticated draft editor URL and confirm the requested release is still a draft.
2. Confirm exactly one Windows installer `.exe`, its matching `.blockmap`, and `latest.yml` were uploaded; the latter two are updater metadata for the same installer.
3. Confirm `latest.yml` contains the extracted changelog notes for the new version. The updater reads these notes from the feed, so this must pass even if the GitHub Release body has not yet been edited.
4. Download and install the build on Windows.
5. Launch the app and confirm startup, local server boot, and settings persistence.
6. Confirm the browser web bundle is included — open the static URL on a LAN device or check that browser assets are present in the packaged output.
7. If auto-update is part of the release you are testing, confirm the updater can see the GitHub-hosted release feed and that **View release notes** shows the new notes.

This change applies only to future releases prepared after it lands. Do not modify or republish existing release assets or `latest.yml` files. Older releases may continue to show the renderer fallback message when their metadata has no notes.

For this naming-break release, also verify that the package creates `{userData}/data/local-recipe-book.db` and does not read old `copilot-chef` database, photo, browser, environment, configuration-file, or protocol identifiers.

---

## Hotfixes and Prereleases

Patch and prerelease versions use the same draft-first skill flow. For a manual retry, use the exact existing tag and its full target commit SHA:

```powershell
gh workflow run release-client.yml --repo OWNER/REPOSITORY --ref v1.0.1 -f expected_commit_sha=FULL_COMMIT_SHA
```

Prerelease-style semver tags such as `v1.0.1-rc.1` are also accepted by the workflow when the package version and draft tag match exactly.

---

## Troubleshooting

**Release workflow did not start**
Confirm the workflow file exists on the default branch, the dispatch used `workflow_dispatch` with the exact tag ref, and the dispatch command succeeded. Check the workflow run list for a run matching the expected SHA and tag.

**Release preflight failed**
Check the expected SHA, checked-out tag target, and `package.json` version. Confirm the exact-tag release exists, is still a draft with the exact title, and contains no unknown or duplicate assets.

**Release validation failed**
Run `npm run lint`, `npm run test`, and `npm run build` locally. The workflow uses the same commands.

**Windows packaging failed**
Check the Electron Builder publish config in `package.json`, the repository release permissions, and the workflow logs from the packaging step. After confirming the draft and tag still match, the skill can dispatch a retry when existing assets are only the expected unique names. Unknown or duplicate assets require manual inspection; the workflow does not remove them.

Keep `build.win.signAndEditExecutable` enabled so Electron Builder can embed the Windows app icon and other executable resources. Code signing remains optional; when no signing certificate is configured, Electron Builder skips signing unless forced signing is enabled.

**Prisma-related packaging errors**
Confirm `npm run db:generate` succeeds locally and that the Prisma resources listed under `build.extraResources` in `package.json` are still correct.
