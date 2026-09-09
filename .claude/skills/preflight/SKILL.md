---
name: preflight
description: End-of-session gate for Localvert — run the full verify, split work into clean conventional commits, update the roadmap. Use before finishing a work session or when asked to "commit what we have" or "wrap up".
---

# Preflight

The ritual that keeps `main` green and the history readable. Run it before
ending a session with uncommitted work.

## 1. Verify

`pnpm verify` — typecheck, lint, test, build. All four green.

If something fails, **fix the cause**. Do not skip a test, loosen a budget,
weaken a type, or reach for `--no-verify`. If a failure is genuinely
pre-existing and unrelated to this session's work, say so explicitly in your
report rather than quietly working around it.

## 2. Inspect the working tree

`git status` and `git diff`. Look for:

- Scratch files, debug logging, commented-out experiments.
- Fixtures or build artefacts that should not be tracked (check `.gitignore`).
- Anything containing a secret, token, account id, or personal path. This repo
  is public — a secret committed here is a secret published.
- Generated files (`src/tools/index.ts`, `src/lib/engines/manifest.ts`) that
  are stale. Run `pnpm gen` if so.

## 3. Commit in logical units

Split the work into small conventional commits, each one coherent on its own:
the engine, the tool, the test, the docs. Do not squash a session into one
"implement everything" commit — this repo's history is meant to be a useful
reference for contributors reading it later.

Follow the commit rules in `CLAUDE.md`. In particular: **no `Co-Authored-By`,
no "Generated with", no AI attribution of any kind.**

Do not push unless asked.

## 4. Update the memory

- Tick completed items in `docs/ROADMAP.md`, with the date.
- Add an ADR for any architectural decision made this session.
- Update `docs/CONVERTERS.md` / `docs/ENGINES.md` if tools or engines changed.

These files are how the next session — possibly on a different machine, with no
memory of this conversation — picks up where you left off. Keeping them true is
part of the work, not paperwork after it.

## 5. Report

Tell the user: commits made (with subjects), what moved on the roadmap, what is
still in progress, and anything you deliberately left undone.
