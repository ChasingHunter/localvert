---
name: release
description: Cut a Localvert release — review the release-please PR, merge it, verify the tag, GitHub Release and deploy. Use when asked to release, cut a version, or ship a version bump.
---

# Release

Versioning is automated. release-please watches conventional commits on `main`
and maintains an open release PR containing the version bump and changelog.
Releasing means reviewing and merging that PR — never hand-editing a version,
never creating a tag by hand.

Version semantics come from commit types: `fix:` → patch, `feat:` → minor,
`feat!:` or a `BREAKING CHANGE:` footer → major.

## Steps

1. **Find the release PR.**
   `gh pr list --label "autorelease: pending"`
   If there is none, there are no releasable commits since the last release
   (only `chore:`/`docs:`/`ci:` since then). Say so and stop.

2. **Review the changelog diff.** `gh pr diff <n>`. Check:
   - Every user-visible change this cycle is represented.
   - The version bump matches the changes. A new converter is a `feat` → minor.
     If the bump looks wrong, the cause is a mistyped commit — say so; do not
     patch the version by hand to compensate.
   - No entry leaks internal noise, a path from a developer's machine, or an AI
     attribution line.

3. **Confirm CI is green** on the PR before merging.

4. **Merge it.** `gh pr merge <n> --squash`. release-please then creates the
   tag `vX.Y.Z` and the GitHub Release; the push to `main` runs `ci.yml`,
   whose `deploy` job ships it once `check`, `build` and `browser` pass
   (deploy is a job in `ci.yml`, not a separate workflow).

5. **Verify the release actually shipped** — do not report success from the
   merge alone:
   - `gh run watch` that CI run to completion.
   - `gh release view vX.Y.Z` shows the release with its notes.
   - Load the live site and run one real conversion.

6. **Report** the version, the release URL, the live URL, and confirmation that
   a conversion works in production.

## If the deploy fails after the tag exists

Do not delete the tag or force-push. Fix forward: commit the fix to `main`,
which redeploys. A tag that points at a broken deploy is a normal, recoverable
state; a rewritten tag breaks every clone that already fetched it.
