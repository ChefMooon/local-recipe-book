---
name: publish-release
description: "Create and publish a Local Recipe Book desktop release from this repository. Use for release preparation, version bumps, changelog checks, v* Git tags, GitHub Actions Windows packaging, GitHub Release publishing, and post-release verification."
argument-hint: "Release version or tag, for example 1.1.1 or v1.1.1"
user-invocable: true
---

# Publish Release

Create a versioned release for the Local Recipe Book Electron app using the repository's documented GitHub Actions workflow. The workflow publishes Windows installer artifacts to a GitHub Release; it does not publish a local build directly.

## Inputs

- Requested release version or tag, such as `v1.1.1`.
- Optional release notes or changelog text.
- The target remote, normally `origin`.

If the version, release notes policy, target remote, or permission to push a tag is unclear, ask before changing files or running a publish command. Never invent a version or release notes.

## Procedure

1. Read `docs/release-guide.md` and confirm the release workflow still matches this skill. Inspect `.github/workflows/release-client.yml` if the guide and repository behavior appear inconsistent.
2. Check the repository state with `git status --short --branch`, the current branch, and the configured remotes. Confirm the intended release commit is on `main`. Treat uncommitted changes to the release metadata files (`package.json`, `package-lock.json`, and `CHANGELOG.md`) as preparatory work that this skill owns; stop only for unrelated changes or an unexpected branch.
   - Derive the canonical GitHub repository slug as `OWNER/REPOSITORY` from the confirmed target remote and normalize it once. Require every `gh api`, `gh release`, and user-facing GitHub URL in this procedure to use that exact verified slug. Reject a remote that is not a GitHub repository URL or cannot be normalized unambiguously.
3. Normalize the requested tag to the `vMAJOR.MINOR.PATCH` form, preserving prerelease suffixes such as `v1.1.1-rc.1`. Reject tags that do not start with `v` or are not valid semver-style release tags.
4. Compare the tag version with `package.json`'s `version`. They must match exactly after removing the leading `v`. If they differ, update `package.json` to the requested release version and update the root `package-lock.json` using the repository's normal npm versioning workflow. Do not leave a version mismatch for the user to repair manually. Review the resulting metadata diff; if any release file contains unrelated user changes, stop and ask before committing it.
5. Validate the release entry in `CHANGELOG.md` for the identified version before running release checks:
   - Normalize the requested tag to its version form by removing the leading `v`, while preserving a prerelease suffix such as `1.1.1-rc.1`.
   - Require an exact release heading in the form `## [VERSION] - YYYY-MM-DD`, where `VERSION` is the normalized requested version and the date is a real ISO calendar date.
   - Require that the entry contains meaningful release notes before the next `## [` release heading. A heading with no notes, placeholder text, or only empty subsections is invalid.
   - Treat an entry for another version, a malformed heading, or a missing entry as invalid. Do not infer or silently create release notes.
   - The release workflow extracts this validated version section into generated `release-notes-windows.md` before packaging. Do not manually create, commit, or stage that generated file.
6. If the `CHANGELOG.md` entry is missing or invalid, stop the release workflow and ask the user whether they want to use the `/update-changelog` skill to create or repair the entry. Do not commit, run lint/test/build, create a tag, or push anything until the user resolves this decision. If they decline, stop without publishing.
7. After the requested version and changelog entry are valid, inspect the release metadata diff. Ensure it contains the intended version updates and changelog entry, and that no unrelated changes are included. If release metadata is uncommitted, stage only `package.json`, `package-lock.json`, and `CHANGELOG.md`, then create a commit with this exact message:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: prepare v1.1.1 release"
   ```

   Substitute the normalized requested tag in the commit message. If the metadata is already committed in the current `main` history, do not create an empty duplicate commit.
8. Run the documented local checks from the repository root:

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

   Stop on the first failure, report the command and relevant output, and do not create or push a release tag.
9. Recheck the final version, worktree, branch, and diff. Ensure the release commit is present on `main`, the worktree is clean, and the package version exactly matches the normalized tag. Push the release preparation commit to the configured remote before creating the tag:

   ```bash
   git push origin main
   ```

   Substitute the confirmed remote and current release branch. Check the native command exit code immediately, then verify that the remote `refs/heads/main` resolves to the intended release commit. This push is part of the requested release-preparation workflow; never force-push.
10. Create and push the release tag from the verified release commit. The requested release workflow authorizes this push without an additional confirmation:

   ```bash
   git tag v1.1.1
   git push origin v1.1.1
   ```

   Before creating it, verify that the requested tag does not already exist locally or on the remote. Run `git tag` and `git push` as separate commands, check the native exit code after each command, and do not continue after a failure. After pushing, verify that the remote tag resolves to the intended release commit. Do not use force-push or overwrite an existing tag.
11. Watch the matching `Release Client` GitHub Actions workflow to completion using a deterministic, non-interactive process:
   - Capture the verified release commit SHA and normalized tag/ref before or immediately after pushing the tag.
   - Query the workflow runs through the GitHub REST API and select the run only when both `head_sha` equals the release commit SHA and `head_branch`/ref identifies the requested tag. Do not select a run solely because it is the newest result from a limited list.
   - After identifying the matching run, start exactly one non-interactive terminal process that owns all waiting. That process may call `gh api` internally, sleep for 30 seconds while the run is queued or in progress, and repeat until the run reaches a terminal state or the 30-minute deadline expires. Do not implement this as one terminal/tool call per poll.
   - While that process is running, do not issue additional status calls, job queries, release lookups, progress checks, or repeated terminal-output retrievals. Do not send interim progress updates about the wait. If the terminal tool moves the process to the background, wait for its single completion notification and retrieve its output only once.
   - Require the process to emit one final machine-readable result containing the saved run ID and URL, `head_sha`, tag/ref, `status`, `conclusion`, and a timeout or error field when applicable. Set `GH_PAGER=cat` for its `gh api` calls as needed. Do not use `gh run watch` or `gh run view`, which may open an interactive pager or alternate terminal buffer in the Windows VS Code environment.
   - Treat the workflow as watched only when that final result identifies the saved run with the expected SHA/ref and reports `status=completed` and `conclusion=success`. If it reports `failure`, `cancelled`, `timed_out`, another non-success conclusion, a mismatched SHA/ref, an API/command error, or a timeout, stop before release lookup or notes editing. Report the run ID, URL, status, conclusion, and relevant failure context. Retrieve the failed run's job/step summary only after the wait process has finished and only when needed.
   The workflow runs on `windows-latest` and performs `npm ci`, `npm run db:generate`, `npm run prepare:release-notes`, `npm run build`, `npm run lint`, `npm run test`, packages once with `npx electron-builder --win`, validates `dist/latest.yml`, and then publishes with `npx electron-builder --win --publish always` using the repository `GITHUB_TOKEN`. That invocation intentionally uploads three assets for the single Windows installer: one `.exe`, its `.blockmap` updater metadata, and `latest.yml`. These are not duplicate installers or duplicate releases.
12. Once the matching workflow run has completed successfully, locate the GitHub Release for the requested tag using a short, bounded lookup followed by a list-based fallback:
    - First perform at most three exact-tag lookups for the normalized requested tag. Use one non-interactive process that queries the release-by-tag endpoint, retries only for a genuine `404` or not-found response, and waits briefly between attempts (for example, 10 seconds after the first failure and 20 seconds after the second). Stop immediately for authentication errors, permission failures, malformed responses, or any other command/API error.
    - Do not perform additional exact-tag retries after the third lookup fails. If all three lookups return `404`, perform one fallback lookup using the authenticated REST release list, equivalent to:

       ```bash
       gh api --method GET "repos/OWNER/REPOSITORY/releases?per_page=100"
       ```

    - From the fallback output, select only releases whose `tag_name` exactly equals the normalized requested tag. Do not select by release name, creation time, list position, or newest-release status.
    - If the fallback returns exactly one matching release, retrieve its complete release record by ID and continue validation. If it returns zero or multiple matching releases, stop and report the exact lookup failure or ambiguity.
    - The fallback must not create a release, retarget a tag, publish a release, or use a different tag.
   - Retrieve and preserve the selected release's `id`, API `url`, `html_url`, `name`, `body`, `isDraft`, `tagName`, and assets. Require `tagName` to equal the normalized requested tag exactly and require `isDraft=true`. If either assertion fails, stop and report the exact failure before editing anything; never silently create a second release or retarget an existing tag.
   - Treat the API-provided `html_url` as diagnostic metadata only. GitHub may expose an unpublished draft through a temporary `untagged-*` browser slug that later returns 404; never present that value as the canonical review link.
    - The lookup process must emit one final machine-readable result containing the lookup method (`exact-tag` or `release-list-fallback`), attempt count, release ID/URL when found, tag, draft state, and an error field when applicable.
13. Ensure the draft is visibly identified with the requested release version before updating its notes. Require the release `name` to contain the exact requested tag. If it does not, while `isDraft=true`, run a standalone command equivalent to:

   ```bash
   gh release edit v1.1.1 --repo OWNER/REPOSITORY --title "v1.1.1"
   ```

   Check the native command exit code immediately, then fetch the release again and require both `tagName == v1.1.1` and `name == v1.1.1` (substituting the requested tag). If the title cannot be corrected or the tag/name assertion fails, stop and do not update notes or claim success. Do not change the draft state.
14. Extract the exact validated changelog entry for the requested version from `CHANGELOG.md` into a temporary UTF-8 notes file. Preserve the original note text and order; do not manually retype, summarize, or infer notes. Remove only the `## [VERSION] - YYYY-MM-DD` heading when the release `name` already contains the requested version. If the title does not contain the version, retain the heading. Normalize line endings consistently before comparison.
15. Compose the new release body from the extracted changelog block followed by the existing draft body. If the existing body already begins with or contains that exact changelog block, do not add a duplicate; preserve the existing body unchanged in that case. Never pass a changelog-only file to `gh release edit --notes-file` when the existing body is non-empty, because that replaces generated release text.
16. Immediately before editing, confirm that the matching release is still a draft and still has the exact requested tag/title:

   ```bash
   gh release view v1.1.1 --repo OWNER/REPOSITORY --json isDraft,tagName,name --jq "if (.isDraft == true and .tagName == \"v1.1.1\" and .name == \"v1.1.1\") then \"ready\" else \"not-ready\" end"
   ```

   Require the command to return exactly `ready`. Then update the draft release body with the combined notes file:

   ```bash
   gh release edit v1.1.1 --repo OWNER/REPOSITORY --notes-file PATH_TO_TEMP_NOTES
   ```

   Substitute the requested tag, repository derived from the configured remote, and temporary combined-notes path. Require the readiness command to return exactly `ready` before editing. Check the native command exit code immediately after the edit. If the release is not found, is already published, or the edit fails, report the exact failure and do not claim the release notes were updated. Remove the temporary notes file after the edit without modifying the repository.
17. Fetch the release body again after editing and prove that the exact changelog block is present exactly once and that the complete original body remains after it. If the original body was empty, verify the final body equals the changelog block. If either assertion fails, report the mismatch and do not report a successful release.
18. Verify the GitHub Release exists exactly once for the pushed tag, remains a draft, has `tagName` and `name` exactly equal to the requested tag, contains the validated changelog block, and has exactly one matching Windows `.exe` installer plus its matching `.blockmap` and `latest.yml`, each with successful upload state and nonzero size. Do not count the blockmap or `latest.yml` as additional installers. If there is more than one matching `.exe`, more than one matching blockmap, duplicate asset names, or more than one release for the exact tag, stop and report the ambiguity instead of editing or publishing anything. Immediately before reporting success, construct the primary draft review/edit link as `https://github.com/OWNER/REPOSITORY/releases/edit/TAG`, substituting the verified repository slug and exact normalized tag. Confirm that the link uses the same verified repository and tag; do not substitute the API-provided `html_url`, especially when it contains `untagged-`. Also provide `https://github.com/OWNER/REPOSITORY/releases` as a secondary authenticated navigation fallback. Present the result as a draft review link and leave the release unpublished; do not publish it or change its draft state.
19. For a successful release, recommend downloading and installing the Windows build, launching the app, checking startup and settings persistence, confirming browser bundle availability, and checking the updater feed when auto-update is in scope.

### Resume and Command Safety

If the session is interrupted after the metadata commit, main push, tag push, workflow start, release lookup, draft-body update, or final verification, resume from the first incomplete phase. Inspect existing local and remote state before acting; do not recreate an existing commit or tag, select a workflow run from a different SHA, or edit a release that has already been published. Preserve these checkpoint values in the continuation summary or session checkpoint: repository, normalized tag, release commit SHA, workflow run ID and URL, release ID or URL, completed phase, and next phase. If the internal wait is interrupted, preserve the saved run checkpoint and, on resume, start one new internal-wait process; do not create a sequence of chat-level polling calls. If release lookup is interrupted, preserve the workflow checkpoint and start one new bounded lookup process with at most three exact-tag attempts followed by one release-list fallback; do not create another release or select a release from a different tag.

On Windows PowerShell, execute every mutating GitHub, Git, and release command separately. Check `$LASTEXITCODE` immediately after each native command before running the next command. Do not chain tag creation, pushes, release edits, or verification with semicolons. A failed command is a hard stop until its state is inspected.

## Safety Rules

- Never publish from an unexpected branch or with unrelated uncommitted changes without explaining the risk and receiving explicit approval. Release metadata changes are expected to be committed by this skill.
- Always commit requested release metadata with the exact message `chore: prepare vX.Y.Z release` before pushing the release branch.
- Always push the release preparation commit before creating the tag, and verify that the remote branch contains it.
- The requested release workflow authorizes creating and pushing the requested tag without an additional confirmation prompt.
- Always watch the matching GitHub Actions run until successful completion before looking up or editing the release draft; verify its run ID, URL, SHA, ref, status, and conclusion.
- Always copy the validated changelog entry into the matching GitHub Release draft after the successful packaging workflow creates it, and verify the draft body before reporting success.
- Final verification must prove the package version, release tag, exact draft `tagName` and `name`, workflow success and matching SHA/ref, `draft=true`, exact changelog-block occurrence, preservation of the pre-existing release body, exactly one release for the tag, and exactly one `.exe`, matching `.blockmap`, and `latest.yml` with successful upload state and nonzero size. The reported primary link must be the authenticated draft editor route `https://github.com/OWNER/REPOSITORY/releases/edit/TAG` built from the verified remote slug and normalized tag; never report a temporary `untagged-*` `html_url` as the canonical link.
- Never push a tag before local lint, test, and build checks pass.
- Never push a tag whose version differs from `package.json`.
- Never assume the tag push succeeded; verify the remote tag and workflow result.
- Do not change unrelated compatibility identifiers or dependency names merely as part of a release. The Local Recipe Book naming-break plan is an explicit exception for the settled package, app, storage, configuration, browser, and protocol identifiers.
- If Prisma generation fails on Windows because a running Electron process locks the engine DLL, stop the dev process and retry using the documented repository workaround before continuing.
- Do not force-push, delete, or retarget an existing release tag without explicit authorization.
- Describe the result as a release draft that was created or prepared and remains unpublished; do not call a draft release published.

## Repository References

- [Release guide](../../../docs/release-guide.md)
- [Release workflow](../../../.github/workflows/release-client.yml)
- [Package metadata and scripts](../../../package.json)
- [Developer guide](../../../docs/developer-guide.md)
