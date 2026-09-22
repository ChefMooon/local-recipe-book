# Release Guide

This guide covers the current GitHub Actions release flow for the Electron app.

---

## How Releases Work

| Artifact | Trigger tag | Workflow | Output |
|---|---|---|---|
| Local Recipe Book desktop app | `v*` | `release-client.yml` | GitHub Release + Windows installer artifacts |

Pushing a `v` tag starts the desktop release workflow.

---

## Before Tagging

- Ensure the release metadata is committed on `main` with a message such as `chore: prepare v1.1.1 release`, then push that commit to `origin` before creating the tag.
- Update `package.json` `version` to match the intended release.
- Update `CHANGELOG.md` if you are maintaining release notes.
- Run `npm run prepare:release-notes` to extract the matching version section from `CHANGELOG.md`. The generated `release-notes-windows.md` file is disposable packaging input and is ignored by git.
- Verify local validation passes:

```bash
npm run lint
npm run test
npm run build
```

The release workflow reruns build, lint, and test on GitHub before packaging, so a bad tag should fail before publishing.

---

## Create a Release

The publish-release skill creates and pushes the requested tag after local validation and release metadata preparation. It watches the matching `Release Client` workflow by release commit SHA and tag until it completes successfully, then updates the resulting GitHub Release draft with the validated changelog entry. Before editing notes, it verifies that the release `tagName` and title are exactly the requested tag; leave the release as a draft until it has been reviewed.

For the final handoff, use the authenticated draft editor URL `https://github.com/OWNER/REPOSITORY/releases/edit/TAG`, replacing `OWNER/REPOSITORY` with the verified GitHub remote slug and `TAG` with the exact release tag. The GitHub API can return a temporary `html_url` containing an `untagged-*` slug for an unpublished draft; that URL is not canonical and can return 404. The releases page, `https://github.com/OWNER/REPOSITORY/releases`, is the secondary navigation fallback.

Manual tag creation from the repository root:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## What the Workflow Does

`release-client.yml` runs on `windows-latest` and:

1. Checks out the repo.
2. Installs dependencies with `npm ci`.
3. Generates the Prisma client.
4. Builds the Electron app with `npm run build` (which includes a prebuild step that runs `build:web` first, producing both the browser renderer bundle and the Electron app).
5. Reruns `npm run lint`.
6. Reruns `npm run test`.
7. Extracts the package version's release notes from `CHANGELOG.md` into a generated packaging file.
8. Packages the Windows installer with `electron-builder --win`.
9. Verifies that `dist/latest.yml` contains non-empty `releaseNotes`.
10. Publishes the Windows installer with `electron-builder --win --publish always`.

The workflow uses the repository `GITHUB_TOKEN` to publish the release assets defined by the Electron Builder config in `package.json`. A normal Windows release has one installer `.exe` plus two required updater assets: the matching `.blockmap` and `latest.yml` (three assets total). The blockmap and `latest.yml` are metadata for the same installer, not additional installer artifacts or duplicate releases.

After the workflow creates the GitHub Release draft, update its body with the validated `CHANGELOG.md` entry for the matching version. Preserve any generated release text and avoid duplicating the changelog block. Verify the workflow's matching SHA/ref, successful completion, exact draft tag/title, changelog text, one installer `.exe`, its matching `.blockmap`, and `latest.yml` before publishing or treating the release as complete. Multiple matching installers, duplicate asset names, or multiple releases for one tag are ambiguous and must stop the release process.

The breaking Local Recipe Book identity uses package slug `local-recipe-book` and Electron app ID `com.local-recipe-book.app`. Existing installs do not retain update continuity after the app ID change. Before upgrading, export an `all` `.lrb` archive, install the new build as a new application identity, and re-import the archive into its fresh database. The archive restores supported content and allowlisted preferences, not raw settings, tokens, secrets, or device configuration.

---

## Verify the Release

1. Open GitHub Releases and confirm the `v1.0.0` release exists.
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

Patch releases use the same flow:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Prerelease-style semver tags still match the workflow trigger as long as they start with `v`, for example:

```bash
git tag v1.0.1-rc.1
git push origin v1.0.1-rc.1
```

---

## Troubleshooting

**Release workflow did not start**
Confirm the pushed tag begins with `v` and exists on the remote: `git push origin v1.0.0`.

**Release validation failed**
Run `npm run lint`, `npm run test`, and `npm run build` locally. The workflow uses the same commands.

**Windows packaging failed**
Check the Electron Builder publish config in `package.json`, the repository release permissions, and the workflow logs from the `Package & publish Windows release` step.

**Prisma-related packaging errors**
Confirm `npm run db:generate` succeeds locally and that the Prisma resources listed under `build.extraResources` in `package.json` are still correct.
