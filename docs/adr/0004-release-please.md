# ADR-0004: Automate versioning with release-please and Conventional Commits

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

This project is built almost entirely through AI prompts, commits land directly
on `main` without pull requests, and it is open source — so the history is part
of the documentation. Three consequences:

- Version bumps and changelogs cannot depend on someone remembering. Anything
  manual will drift, and drift in a public changelog is worse than no changelog.
- Commit messages have to carry real meaning, since there is no PR description
  to fall back on and no reviewer to catch a vague one.
- Releases need exactly one human checkpoint. Fully automatic tagging on every
  push would publish half-finished work; a fully manual process would not
  survive a busy week.

## Decision

Adopt **Conventional Commits**, and let **release-please** own versioning.

Commit types in use: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`,
`ci`. Scopes matter and are conventional in this repo — `tool`, `engine`,
`worker`, `infra`, `ui`. So: `feat(tool): add heic to jpg`,
`fix(engine): free ffmpeg heap on cancel`.

`release-please.yml` watches `main` and maintains a release pull request:
`feat` bumps the minor, `fix` and `perf` bump the patch, `!` or a
`BREAKING CHANGE:` footer bumps the major. The PR accumulates a generated
CHANGELOG and the version bump. **Merging that PR is the release** — it
creates tag `vX.Y.Z`, publishes a GitHub Release, and its merge commit is
itself a push to `main`, which is what `ci.yml`'s `deploy` job runs on (there
is no separate `deploy.yml`; deploy is a job there, gated behind `check`,
`build` and `browser` passing first).

Two rules follow, both recorded in CLAUDE.md:

- **Never hand-edit a version, and never create a tag manually.** Tags come
  from release-please or they do not exist. A hand-made tag desynchronises the
  tool's state and the next release fights it.
- **Never rewrite pushed history.** The changelog is generated from commits, so
  rewriting history rewrites the public record.

`package.json` stays `"private": true` — nothing is published to npm. The
version field exists so release-please has somewhere to write, and so the
deployed app can display a build version.

## Consequences

**What it buys**

- The changelog is a byproduct of working, not a chore. It cannot go stale.
- One clear human checkpoint: review the release PR, see exactly what ships and
  what the version will be, merge. Everything downstream is automatic.
- Semantic versioning is derived from intent already stated in each commit,
  rather than argued about at release time.
- Well-formed commit messages are enforced by the thing the author wants
  (a correct release), which is the only enforcement that lasts.
- Good history is a contributor onboarding asset — `git log` reads as a
  narrative of how the project was built, which is a stated goal.

**What it costs**

- Commit discipline is now load-bearing. A `feat` typed as `chore` silently
  fails to bump the minor and vanishes from the changelog. There is no reviewer
  to catch it on a direct-to-`main` commit.
- Squash-merging an external PR makes the **PR title** the commit message, so
  PR titles must be conventional too. `ci.yml` runs a semantic-PR-title check
  for this reason.
- One more workflow with elevated permissions (`contents: write`,
  `pull-requests: write`) to keep pinned and reviewed.
- The changelog's quality is the commit messages' quality. Lazy subjects
  produce a lazy public changelog.

## Alternatives considered

**Changesets.** Rejected. It is built for monorepos publishing multiple
packages, and it asks for a separate changeset file per change. That is a
second artifact to write and remember on a single-package app with
direct-to-`main` commits — exactly the manual step this decision exists to
remove. Its strength (independent per-package versioning) is not a thing we
have.

**semantic-release.** Rejected. It publishes on every qualifying push with no
human gate. For a deployed web app where a release is also a production deploy,
the release PR is a checkpoint worth keeping.

**Manual versioning and a hand-written CHANGELOG.** Rejected as the thing most
certain to rot. It is also the least useful to an AI-driven workflow, where the
commit metadata is already structured and free to exploit.
