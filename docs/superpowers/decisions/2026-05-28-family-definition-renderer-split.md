# Decision — FamilyDefinition renderer loading path (Option A: split type)

**Date:** 2026-05-28
**Branch:** `spec/v2-note-creation-design`
**Context:** Pre-step before Plan 3 Task 3 (Lecture FamilyDefinition registration) lands the first live family. Plan 2's final reviewer flagged this as carry-forward #2 in [v2-plan2-foundation-done memo](../../.claude/projects-not-tracked-by-git/memory/v2_plan2_foundation_done_2026-05-27.md): "FamilyDefinition.renderer is a React ComponentType — Plan 3 is mostly main-process work but renderer field is renderer-process. Decide the loading path before Plan 3 registers the first live family."

## Problem

After Plan 2, `desktop/src/shared/families/index.ts` shipped a single
`FamilyDefinition<T>` interface with a `renderer: ComponentType<{ note: T }>`
field (React) and `slots?: ReadonlyArray<SlotDefinition<unknown>>` where
`SlotDefinition` itself carries `renderer: ComponentType<{ items: T[] }>`.

At the type level both are `import type { ComponentType } from 'react'`
(erased at compile). Audit `grep -rn "from 'react'" src/main src/preload`
returns zero hits — Lisna's existing discipline is **main + preload import
zero React**.

The risk arrives at value-import time. Plan 3 Task 3's family barrel
(`families/lecture/index.ts`) would do `import { LectureRenderer } from
'./renderer'` to populate the registry entry. Anything that loads that
barrel — and the orchestrator in `desktop/src/main/sidecar/orchestrator.ts`
must, to read `family.schema`, `family.prompts`, `family.mergeStrategy` —
pulls `renderer.tsx` and its React dependencies into the main bundle.

## Options considered

### A. Split type — `FamilyCoreDefinition` + `FamilyRendererDefinition`, two registries (CHOSEN)

`families/index.ts` (always-loaded core barrel) declares
`FamilyCoreDefinition<T>` — schema, prompts, slot **schemas only**, merge,
picker, eval baselines. React-free. Its registry is
`familyCoreRegistry: Partial<Record<NoteFamily, FamilyCoreDefinition<NoteBase>>>`
populated by `registerFamilyCore()`.

A sibling `families/renderer.tsx` (renderer-only) declares
`FamilyRendererDefinition<T>` — `renderer: ComponentType<{ note: T }>`,
optional `streamingRenderer`, and a `slotRenderers: SlotRendererMap`
keyed by slot kind. Its registry is `familyRendererRegistry` populated
by `registerFamilyRenderer()`.

`util/slot.ts` splits accordingly: `SlotSchemaDefinition<T>` (type, schema,
promptHint, triggers — all the things the prompt builder + orchestrator
need) lives in the core barrel; the slot renderer component lives in the
renderer barrel via the `SlotRendererMap` keyed by `slot.type`.

Each family ships two files (alongside the schema/prompts/merge files
Plan 3 already plans):

```
families/lecture/
  core.ts        (T3 — registerFamilyCore; imported only by main)
  renderer.tsx   (T11 — registerFamilyRenderer; imported only by renderer)
```

Main side: `import './families/register-all-cores'` (a barrel that
side-effect-imports each family's `core.ts`).
Renderer side: imports the cores barrel **plus**
`./families/register-all-renderers`.

### B. Two-stage register — one `FamilyDefinition` with optional renderer

`renderer?: ComponentType<...>` + `slotRenderers?: ...` become optional.
Main calls `registerFamily(core)`; renderer additionally calls
`attachFamilyRenderer(id, { renderer, slotRenderers })` to mutate the same
registry entry. Single FamilyDefinition type, one registry.

Rejected: optional renderer weakens the contract everywhere — every read
of `fam.renderer` becomes `if (fam.renderer)` even in the renderer
process where it is guaranteed present. Runtime mutation timing is a
footgun (the registry is observable to renderer code *before* attach
completes, and TypeScript can't catch that).

### C. Lazy dynamic import — `rendererPath: string`

FamilyDefinition stores a path string; renderer process does
`const { Renderer } = await import(rendererPath)` at render time.

Rejected: loses static type on the renderer (`unknown` until awaited);
Electron+Vite dynamic-import handling adds bundling and MIME-type issues;
SlotDefinition renderer dispatch lives deep inside the family renderer's
JSX tree, where async lazy-load would force a Suspense boundary or
indirection that adds no value.

## Decision

**Option A.** The split aligns with Lisna's existing zero-React-in-main
discipline (verified by grep), keeps the registry immutable post-bootstrap
(no runtime augmentation), and naturally extends to SlotDefinition without
forcing `Partial<>` or lazy-import indirection. Main's tsconfig can drop
`@types/react` from `compilerOptions.types` if we later choose to enforce
the boundary at type-check time as well — not done in this commit, but
the option becomes available.

## Renamed surface (Plan 2 outputs that change)

Plan 2 outputs (currently on disk):

| Was | Becomes | Why |
|---|---|---|
| `FamilyDefinition<T>` in `families/index.ts` | `FamilyCoreDefinition<T>` in `families/index.ts` | Drops `renderer` + `streamingRenderer`; `slots` becomes `ReadonlyArray<SlotSchemaDefinition<unknown>>` |
| `familyRegistry` in `families/index.ts` | `familyCoreRegistry` in `families/index.ts` | Holds only the core fields |
| `registerFamily<T>(def)` in `families/index.ts` | `registerFamilyCore<T>(def)` in `families/index.ts` | |
| `SlotDefinition<T>` in `families/util/slot.ts` | `SlotSchemaDefinition<T>` in `families/util/slot.ts` | Drops `renderer` field |
| (new) | `FamilyRendererDefinition<T>` in `families/renderer.tsx` | Renderer + slot-renderer map |
| (new) | `familyRendererRegistry` in `families/renderer.tsx` | |
| (new) | `registerFamilyRenderer<T>(def)` in `families/renderer.tsx` | |
| (new) | `SlotRendererMap` in `families/renderer.tsx` | Keyed by `SlotSchemaDefinition.type` |

Plan 3 file-structure delta (vs the plan's currently-written shape):

| Plan 3 file (as written) | Becomes |
|---|---|
| `families/lecture/index.ts` (T3) | `families/lecture/core.ts` (T3) — registers core; React-free |
| `families/lecture/renderer.tsx` (T11) | unchanged path; T11 now also calls `registerFamilyRenderer` |

The Plan 3 plan file (`docs/superpowers/plans/2026-05-27-v2-plan-3-lecture-pipeline.md`)
references `family: 'lecture'`, `prompts: { default, v1 }`, `requiresDiarization: false`,
and `familyRegistry.get('lecture')`. Plan 2 actually landed `id: 'lecture'`,
`prompts: ReadonlyArray<PromptVariant>`, `defaultPromptVariant: string`,
no `requiresDiarization` field, and `familyRegistry['lecture']` (Partial
Record). The Plan 3 implementer subagents must read the actual landed code
before writing the registration, not the plan's draft snippets. This memo
is the canonical reference for the post-split shape.

## Plan 2 carry-forward (a) — barrel re-exports

Alongside the split, `families/index.ts` re-exports the convenience
symbols Plan 2's final reviewer requested so downstream Plans don't need
3-path imports:

```ts
export type { PromptVariant } from './util/prompts';
export { selectPromptVariant } from './util/prompts';
export type { SlotSchemaDefinition } from './util/slot';
```

`PromptVariant` and `selectPromptVariant` are still pure-data /
pure-function so they live in the core barrel. `SlotSchemaDefinition`
likewise — the renderer-side `SlotRendererMap` is re-exported from
`families/renderer.tsx`.

## Implementation note for Plan 3

Plan 3 Task 3 registers the core; Plan 3 Task 11 (renderer-lane work
post-fork-checkpoint) registers the renderer. Stub renderer registration
in Task 3's commit is unnecessary under Option A — the absence of a
renderer-registry entry is naturally handled by the renderer process
reading both registries and matching by `id`.

## Forward-compat

If a future family wants a *streaming* renderer (`partial: Partial<T>`
during chunk-by-chunk note generation), it lives in
`FamilyRendererDefinition.streamingRenderer` next to the static
`renderer`. No core changes required.

If a future family wants headless server-side rendering (e.g. backend
emitting Markdown without a browser), introduce a third registry —
`familyServerRendererRegistry` — without disturbing core or renderer.
The split-registry pattern already accommodates this.
