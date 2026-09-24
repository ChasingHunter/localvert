<!--
PR title must be a Conventional Commit: feat(...), fix(...), docs:, chore:,
etc. — matching CLAUDE.md's commit rules. External PRs are squash-merged, so
the title becomes the commit message that release-please reads. A semantic
check runs in CI and will block the merge if this isn't right.
-->

## What and why

<!-- What does this change, and why does it need to happen? -->

## Checklist

- [ ] `pnpm verify` passes locally (typecheck, lint, test, build).
- [ ] PR title is a Conventional Commit.
- [ ] Docs updated if this changes behavior a fresh clone would need to know
      (`docs/ROADMAP.md`, `docs/CONVERTERS.md`, `docs/ENGINES.md`, an ADR).

### Invariants (see CLAUDE.md)

- [ ] No network I/O with user file data — nothing added here can make a file,
      or bytes derived from one, leave the browser.
- [ ] No decode, encode, or zip work runs on the main thread.
- [ ] No conversion engine landed in the core bundle (only dynamic `import()`
      inside a worker).
