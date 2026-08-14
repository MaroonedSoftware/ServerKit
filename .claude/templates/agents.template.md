# AGENTS.md — @maroonedsoftware/<name>

<!--
Template for a package-level AGENTS.md. Copy, fill in, delete these comments.

Follow the skeleton exactly. The point of a fixed skeleton is that an agent which has read one
of these can predict where a fact lives in any other. Do not reorder, rename, or drop sections;
if a section genuinely does not apply, keep the heading and write one line saying so.

Source of truth, in order: src/index.ts (and each subpath entry) > package.json > README.md.
The README is prose and can drift — never treat it as the only source.
-->

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

<!-- Two or three sentences. What it does, and explicitly when NOT to reach for it. -->

## Install

<!--
Install line, required peers, optional peers and what each unlocks:

```bash
pnpm add @maroonedsoftware/<name>
```

Required peers: ...
Optional peers: `x` — unlocks the `./x` subpath.
-->

## Position in the graph

- **Depends on:** <internal packages, or "nothing internal">
- **Depended on by:** <internal packages, or "nothing internal">
- **Subpath exports:** `./x` — <what it is, and why it is a subpath rather than a root export>

## API surface

<!--
Every root and subpath export. No omissions — an absent symbol should mean "does not exist",
not "wasn't worth listing". Verify against dist/index.d.ts after a build, not against the README.
-->

| Export | Kind | Shape | Notes |
| ------ | ---- | ----- | ----- |

## Canonical usage

<!--
One minimal, correct, copy-pasteable snippet with real import paths. If wiring order matters,
the snippet shows the correct order. If a .claude/skills/ example covers this package, link it
and stay consistent with it rather than writing a second set of snippets.
-->

## Rules for generated code

<!--
Imperative bullets: do X, never Y. Package-specific only — repo-wide rules (no hyphens, Luxon,
undefined over null, tests in tests/) live in the root AGENTS.md and are not repeated here.
-->

## Gotchas

<!--
Non-obvious failure modes: silent misbehaviour, order dependencies, things that typecheck but
are wrong. If nothing qualifies, say "None beyond the repo-wide rules" rather than padding.
-->

## Working inside this package

<!--
For an agent editing this package rather than consuming it: src/ layout, where tests live,
invariants a change must not break, whether a changeset is required, what else must be updated
in lockstep (README, root README index, root AGENTS.md package index, exports, tsup entries).
-->
