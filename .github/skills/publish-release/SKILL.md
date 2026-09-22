---
name: publish-release
description: "Prepare a Local Recipe Book desktop release draft from this repository. Use for release preparation, version bumps, changelog checks, GitHub draft creation, GitHub Actions Windows packaging, release draft verification, and post-release checks."
argument-hint: "Release version or tag, for example 1.1.1 or v1.1.1"
user-invocable: true
---

# Publish Release

Prepare an unpublished, versioned GitHub Release draft for the Local Recipe Book Electron app. The skill creates the draft against the verified release commit, dispatches the documented GitHub Actions workflow on the release tag, and lets Electron Builder upload Windows installer artifacts to that existing draft.

## Inputs

- Requested release version or tag, such as `v1.1.1`.
- Optional release notes or changelog text.
- The target remote, normally `origin`.

If the version, release notes policy, target remote, or permission to create a GitHub draft is unclear, ask before changing files or running a release command. Never invent a version or release notes.

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

   Stop on the first failure, report the command and relevant output, and do not create a release draft or tag through the Releases API.

9. Recheck the final version, worktree, branch, and diff. Ensure the release commit is present on `main`, the worktree is clean, and the package version exactly matches the normalized tag. Push the release preparation commit to the configured remote before creating the release draft:

   ```bash
   git push origin main
   ```

   Substitute the confirmed remote and current release branch. Check the native command exit code immediately, then verify that the remote `refs/heads/main` resolves to the intended release commit. This push is part of the requested release-preparation workflow; never force-push.

10. Create or resume the GitHub Release draft for the exact tag:
    - Save the release commit SHA and normalized tag. Inspect the local tag and the remote tag before creating anything. If a remote tag exists, resolve annotated tags to their peeled commit and require it to equal the release commit SHA. Never move or overwrite an existing tag.
      - List releases with pagination and select only exact `tag_name` matches. If more than one exists, stop. If one exists, require `draft=true`, `tag_name` and `name` exactly equal the requested tag, and retain its release ID and original body. A published or mismatched release is a hard stop. If none exists, create one with the REST API using the verified `OWNER/REPOSITORY` slug and this payload: `tag_name` equal to the normalized tag, `target_commitish` equal to the full release commit SHA, `name` equal to the normalized tag, and `draft: true`. Set `prerelease: false` to match Electron Builder's current draft behavior. Example standalone command:

        ```powershell
        gh api --method POST "repos/OWNER/REPOSITORY/releases" -f tag_name=v1.1.1 -f target_commitish=FULL_COMMIT_SHA -f name=v1.1.1 -F draft=true -F prerelease=false
        ```

        Substitute the verified slug, tag, and full SHA. Check the native exit code immediately. Do not send a second create request after a timeout or ambiguous response; inspect remote state first.

    - Verify the resulting remote tag peels to the intended release commit. Verify exactly one release exists for the tag, its ID is the selected/created ID, and its exact tag/title and draft state are unchanged.
    - List all assets for the release, including pagination. Allow only zero assets or unique names from the exact expected set: `Local Recipe Book-VERSION-Setup-x64.exe`, that filename plus `.blockmap`, and `latest.yml`. Derive `VERSION` from the validated package version. Stop on duplicate or any unexpected name. The pinned `electron-publish@25.1.7` returns an existing draft for its tag and deletes/reuploads an asset when GitHub reports a same-name upload conflict; do not manually delete assets.

11. Dispatch and watch the `Release Client` workflow:
    - Confirm the workflow file is present on the default branch. Record a UTC dispatch-start timestamp, then in a standalone command dispatch the workflow with the tag ref and expected SHA:

      ```powershell
      gh workflow run release-client.yml --repo OWNER/REPOSITORY --ref v1.1.1 -f expected_commit_sha=FULL_COMMIT_SHA
      ```

      Substitute the verified slug, tag, and full SHA. Check the native exit code immediately. A dispatch command failure is a hard stop until workflow and release state are inspected.

    - Query runs through the GitHub REST API and identify only a new run created at or after the saved dispatch-start timestamp whose workflow ID/name is `Release Client`, `event` is `workflow_dispatch`, `head_sha` equals the release commit SHA, and `head_branch` identifies the requested tag. Do not select a pre-existing run or select only by recency. If multiple runs match, stop and report ambiguity.
    - Use exactly one non-interactive process to discover the run and wait for it to complete. It may poll every 30 seconds, up to 30 minutes total. Do not make chat-level polling calls or send progress updates while it waits. If the terminal tool moves the process to the background, wait for its completion notification and retrieve its output only once.
    - Require one final machine-readable result containing run ID/URL, `head_sha`, tag/ref, event, status, conclusion, and timeout/error fields when applicable. Set `GH_PAGER=cat` for API calls. Do not use `gh run watch` or `gh run view`.
    - Treat the run as successful only when the saved run has the expected SHA, tag/ref, and event, and reports `status=completed`, `conclusion=success`. On build failure, cancellation, mismatch, API error, or timeout, stop before editing release notes. Report the run details and that the draft remains available for a deliberate retry. On resume, recheck the exact draft and asset allowlist, then dispatch a new run only if state remains valid.
      The workflow runs on `windows-latest`: `npm ci`, Prisma generation, release-note extraction, build, lint, and tests precede one `npx electron-builder --win --publish always` upload. The package GitHub publish configuration remains `releaseType: draft`; the workflow validates `dist/latest.yml` and never publishes the release. The expected assets are one `.exe`, its `.blockmap`, and `latest.yml`.

12. After the matching run succeeds, fetch the saved release record by ID and repeat exact tag/title/draft checks. List releases and assets with pagination; require exactly one release for the requested tag. Keep the API `html_url` diagnostic only; never present a temporary `untagged-*` URL as the review link.
13. Extract the exact validated changelog entry for the requested version from `CHANGELOG.md` into a temporary UTF-8 notes file. Preserve the original note text and order; do not manually retype, summarize, or infer notes. Remove only the `## [VERSION] - YYYY-MM-DD` heading because the draft title already contains the version. Normalize line endings consistently before comparison.
14. Compose the new release body from the extracted changelog block followed by the existing draft body. If the existing body already begins with or contains that exact changelog block, do not add a duplicate; preserve the existing body unchanged in that case. Never pass a changelog-only file to `gh release edit --notes-file` when the existing body is non-empty.
15. Immediately before editing, confirm the same release ID is still a draft and still has the exact requested tag/title. Require the readiness check to return exactly `ready`; then update only the release body with the combined notes file. Check the native command exit code immediately. If the release is missing, published, changed, or the edit fails, report the exact failure and do not claim the notes were updated. Remove the temporary file after the edit without modifying the repository.
16. Fetch the release body again and prove the exact changelog block occurs exactly once and the complete original body remains after it. If the original body was empty, verify the final body equals the changelog block. Stop on mismatch.
17. Verify the release exists exactly once for the release tag, remains a draft, has exact `tag_name` and `name`, contains the validated changelog block, and has exactly one matching `.exe`, matching `.blockmap`, and `latest.yml`, all in `uploaded` state with nonzero size. Reject duplicate asset names or unknown assets. Do not count metadata files as additional installers. Construct the primary review link as `https://github.com/OWNER/REPOSITORY/releases/edit/TAG` from the verified slug and exact tag; also provide `https://github.com/OWNER/REPOSITORY/releases` as the secondary navigation fallback. Leave the release unpublished.
18. For a successful release, recommend downloading and installing the Windows build, launching the app, checking startup and settings persistence, confirming browser bundle availability, and checking the updater feed when auto-update is in scope.

### Resume and Command Safety

If the session is interrupted after the metadata commit, main push, draft creation, workflow dispatch, run start, notes update, or final verification, resume from the first incomplete phase. Inspect existing local and remote state before acting; do not recreate a release, retarget an existing tag, select a workflow run from a different SHA/ref, or edit a release that has been published. Preserve these checkpoint values in the continuation summary or session checkpoint: repository, normalized tag, release commit SHA, workflow run ID and URL, release ID, completed phase, and next phase. If the wait is interrupted, preserve the saved run checkpoint and on resume start one new wait process. If dispatch outcome is unclear, inspect runs before dispatching again. A retry must use the same exact draft and commit and pass the complete expected-asset allowlist; never automatically delete arbitrary assets.

On Windows PowerShell, execute every mutating GitHub, Git, and release command separately. Check `$LASTEXITCODE` immediately after each native command before running the next command. Do not chain tag creation, pushes, release edits, or verification with semicolons. A failed command is a hard stop until its state is inspected.

## Safety Rules

- Never publish from an unexpected branch or with unrelated uncommitted changes without explaining the risk and receiving explicit approval. Release metadata changes are expected to be committed by this skill.
- Always commit requested release metadata with the exact message `chore: prepare vX.Y.Z release` before pushing the release branch.
- Always push the release preparation commit before creating the release draft, and verify that the remote branch contains it.
- The requested release workflow authorizes creating the requested draft and any missing Git tag through the Releases API, and dispatching the workflow, without additional confirmation.
- Verify an existing tag's peeled commit before reuse; never retarget or overwrite it.
- Always create or verify the exact draft before dispatch, then watch the matching GitHub Actions run until successful completion; verify its run ID, URL, event, SHA, ref, status, and conclusion.
- Always copy the validated changelog entry into the existing draft after the successful packaging workflow and verify the final body.
- Allow retry only when all existing assets are unique members of the expected installer, blockmap, and `latest.yml` set; fail on unknown or duplicate assets.
- Final verification must prove the package version, release tag, exact draft `tagName` and `name`, workflow success and matching SHA/ref, `draft=true`, exact changelog-block occurrence, preservation of the pre-existing release body, exactly one release for the tag, and exactly one `.exe`, matching `.blockmap`, and `latest.yml` with successful upload state and nonzero size. The reported primary link must be the authenticated draft editor route `https://github.com/OWNER/REPOSITORY/releases/edit/TAG` built from the verified remote slug and normalized tag; never report a temporary `untagged-*` `html_url` as the canonical link.
- Never create a draft or tag before local lint, test, and build checks pass.
- Never create a release tag whose version differs from `package.json`.
- Never assume API draft creation created the intended tag; verify the remote peeled tag commit and workflow result.
- Do not change unrelated compatibility identifiers or dependency names merely as part of a release. The Local Recipe Book naming-break plan is an explicit exception for the settled package, app, storage, configuration, browser, and protocol identifiers.
- If Prisma generation fails on Windows because a running Electron process locks the engine DLL, stop the dev process and retry using the documented repository workaround before continuing.
- Do not force-push, delete, or retarget an existing release tag without explicit authorization.
- Describe the result as a release draft that was created or prepared and remains unpublished; do not call a draft release published.

## Repository References

- [Release guide](../../../docs/release-guide.md)
- [Release workflow](../../../.github/workflows/release-client.yml)
- [Package metadata and scripts](../../../package.json)
- [Developer guide](../../../docs/developer-guide.md)
