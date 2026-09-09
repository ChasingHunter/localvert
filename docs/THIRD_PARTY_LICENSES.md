# Third-party licenses

Localvert itself is [MIT](../LICENSE). It ships and lazily fetches third-party
engines, some under copyleft licenses. This file is the attribution record and
the source offer.

**Every engine gets an entry here before its adapter is written.** License
review is the first step of the
[add-engine](../.claude/skills/add-engine/SKILL.md) checklist, not the last.
The rationale for shipping copyleft engines under an MIT project is
[ADR-0002](adr/0002-mit-license-gpl-isolation.md); read it before adding
anything with a GPL or LGPL entry.

## How engines are shipped

No third-party binary is committed to this repository. `scripts/sync-engines.ts`
pulls each engine from npm at build time, and we ship the **published upstream
build, unmodified**. Engines load in a dedicated Web Worker via dynamic
`import()`, communicating only by message passing, and are fetched at runtime
only when a user selects a format that needs them.

For unmodified binaries, the links in the Source column satisfy the source-offer
obligation of the GPL and LGPL. If we ever need to patch an engine, that
requires its own ADR and we must publish the modified source.

---

## Engines

| Engine | Version | License | Copyright | Source |
|---|---|---|---|---|
| _none yet_ | | | | |

## Copyleft engines

Engines under GPL or LGPL, listed separately because they carry obligations
beyond attribution. Each is loaded at arms length as described above.

| Engine | License | Obligation | How it is met |
|---|---|---|---|
| _none yet_ | | | |

## Build and development dependencies

Tooling that does not ship to users — Next.js, React, TypeScript, Biome,
Vitest, Playwright, Wrangler and their transitive dependencies. All permissive
(MIT, Apache-2.0, BSD, ISC). Not enumerated here; `pnpm licenses list` produces
the current set from the lockfile.

Only code that reaches a user's browser is tracked in the tables above.

---

## In-app licenses page

The tables above are mirrored at `/licenses` in the app, so a user can read the
attribution without visiting the repository. Both are generated from the engine
manifest, so they cannot drift — but if you edit one by hand, edit both.
