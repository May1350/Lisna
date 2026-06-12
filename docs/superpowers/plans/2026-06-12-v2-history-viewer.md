# Recording History Viewer (F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse past recordings' transcripts inside the app and regenerate a note from any of them — no re-recording (founder repeat-test loop; spec `docs/superpowers/specs/2026-06-12-v2-history-viewer-design.md`).

**Architecture:** Read the existing #113 dump tree (`<userData>/sessions/<ts>/`) via a new Electron-free reader module; build a dump-sourced `SessionContext` through a new injectable context builder that shares the live path's LLM-load + recovering-sidecar machinery; route through the SAME family dispatch in `session-finalize.ts` via a consolidated `routeFamily`. Regen runs write NO dump (P0-1). Renderer: History list in the idle Recording view → History detail route → existing `curatingV2 → note`/`error` flow with an origin-aware retry edge (P0-3).

**Tech Stack:** Electron (main/preload/renderer), React 18, TypeScript, vitest (renderer tests = `renderToStaticMarkup`, no DOM env; main tests = mocked `electron.ipcMain`).

**Execution context:** Branch `feat/v2-history-viewer` off `main`, in an isolated worktree (superpowers:using-git-worktrees). Verify command for every task: `pnpm --filter @lisna/desktop verify` is the FULL gate (build+test+lint) — per-task steps use scoped `pnpm --filter @lisna/desktop exec vitest run <file>` for speed, but Task 10 runs the full verify. NEVER run vitest with a bare directory filter (pitfalls.md vitest-scope).

**Hard rules for the implementer:**
- Work ONLY inside the assigned worktree. `pwd` before every git command; it must end in the worktree path. Never `git checkout`/`pull`/`branch -D`/`reset` against shared branches. On unexpected git state: report BLOCKED.
- Do not report back until the task's commit lands. Early status = BLOCKED escalation.
- Run `pnpm --filter @lisna/desktop exec eslint <changed files>` (or full `pnpm --filter @lisna/desktop lint`) before every commit — tsc+vitest alone miss unused imports (pitfalls.md pre-push-lint).

---

### Task 1: Shared dump types + dump reader module

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts` (append after `AuthState`, line ~197)
- Modify: `desktop/src/main/session-debug-dump.ts:27` (export `DUMP_DIR_RE`)
- Create: `desktop/src/main/session-dump-reader.ts`
- Create: `desktop/src/main/__tests__/session-dump-reader.test.ts`

- [ ] **Step 1: Add shared types**

Append to `desktop/src/shared/ipc-protocol.ts` (file ends at `AuthState`; add below it):

```ts
// --- F2 history viewer (spec 2026-06-12-v2-history-viewer-design) ---

/**
 * One row of the History list. Derived from a #113 dump dir:
 * `recordedAt` from the dir name; `language/llmModel/segmentCount/durationSec`
 * from transcript.json's precomputed top-level fields; `family/ok` from
 * result.json when present. `unreadable: true` rows render unselectable.
 */
export interface DumpSummary {
  /** Dump dir name, e.g. `2026-06-11T03-00-00-000Z` (+ optional `-N`). */
  id: string;
  /** ISO timestamp parsed from the dir name. */
  recordedAt: string;
  language?: string;
  llmModel?: string;
  segmentCount?: number;
  durationSec?: number;
  family?: string;
  ok?: boolean;
  unreadable?: boolean;
}

/** Full transcript.json payload of one dump (see session-debug-dump.ts). */
export interface DumpTranscript {
  sessionId: string;
  language: string;
  llmModel: string;
  segmentCount?: number;
  durationSec?: number;
  segments: TranscriptSegment[];
}
```

- [ ] **Step 2: Export DUMP_DIR_RE**

In `desktop/src/main/session-debug-dump.ts:27`, change:

```ts
const DUMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;
```

to:

```ts
/** Exported for session-dump-reader.ts — single source of the dir-name shape. */
export const DUMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;
```

- [ ] **Step 3: Write the failing tests**

Create `desktop/src/main/__tests__/session-dump-reader.test.ts`:

```ts
/**
 * Tests for session-dump-reader — Electron-free (injected baseDir on tmp
 * dirs), mirroring the session-debug-dump lifecycle test pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDumps, loadDumpTranscript } from '../session-dump-reader';

let base: string;

function writeDump(
  id: string,
  transcript: unknown | null,
  result?: unknown,
): void {
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  if (transcript !== null) {
    fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(transcript));
  }
  if (result !== undefined) {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
  }
}

const T1 = {
  sessionId: 'live',
  language: 'ja',
  llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  segmentCount: 2,
  durationSec: 5,
  segments: [
    { startSec: 0, endSec: 2, text: 'こんにちは' },
    { startSec: 2, endSec: 5, text: 'テストです' },
  ],
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-reader-'));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('listDumps', () => {
  it('returns newest-first summaries with precomputed fields + result meta', () => {
    writeDump('2026-06-10T01-00-00-000Z', T1, { ok: true, family: 'lecture', finishedAt: 'x' });
    writeDump('2026-06-11T01-00-00-000Z', { ...T1, language: 'en' });
    const rows = listDumps(base);
    expect(rows.map((r) => r.id)).toEqual([
      '2026-06-11T01-00-00-000Z',
      '2026-06-10T01-00-00-000Z',
    ]);
    expect(rows[1]).toMatchObject({
      language: 'ja',
      llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      segmentCount: 2,
      durationSec: 5,
      family: 'lecture',
      ok: true,
    });
    expect(rows[0]!.recordedAt).toBe('2026-06-11T01:00:00.000Z');
    expect(rows[0]!.ok).toBeUndefined(); // no result.json
  });

  it('marks a dump with missing/corrupt transcript.json unreadable instead of dropping it', () => {
    writeDump('2026-06-10T01-00-00-000Z', null); // no transcript.json
    const dir = path.join(base, '2026-06-11T01-00-00-000Z');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.json'), '{not json');
    const rows = listDumps(base);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unreadable)).toBe(true);
  });

  it('returns [] for a missing base dir and ignores non-dump dirs/files', () => {
    expect(listDumps(path.join(base, 'nope'))).toEqual([]);
    writeDump('2026-06-10T01-00-00-000Z', T1);
    fs.mkdirSync(path.join(base, 'not-a-dump'));
    fs.writeFileSync(path.join(base, 'stray.txt'), 'x');
    expect(listDumps(base).map((r) => r.id)).toEqual(['2026-06-10T01-00-00-000Z']);
  });

  it('falls back to segments when precomputed fields are absent', () => {
    const { segmentCount: _c, durationSec: _d, ...noPrecomputed } = T1;
    writeDump('2026-06-10T01-00-00-000Z', noPrecomputed);
    const row = listDumps(base)[0]!;
    expect(row.segmentCount).toBe(2);
    expect(row.durationSec).toBe(5);
  });
});

describe('loadDumpTranscript', () => {
  it('returns the full transcript payload', () => {
    writeDump('2026-06-10T01-00-00-000Z', T1);
    const t = loadDumpTranscript(base, '2026-06-10T01-00-00-000Z');
    expect(t.segments).toHaveLength(2);
    expect(t.language).toBe('ja');
  });

  it('rejects ids that do not match the dump dir shape (traversal guard)', () => {
    for (const bad of ['../../etc', 'x', '2026-06-10', '2026-06-10T01-00-00-000Z/../x']) {
      expect(() => loadDumpTranscript(base, bad)).toThrow('INVALID_DUMP_ID');
    }
  });

  it('rejects a valid-shaped id that resolves outside base (parent-equality guard)', () => {
    // A symlinked dump dir pointing elsewhere must fail realpath parent equality.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    fs.writeFileSync(path.join(outside, 'transcript.json'), JSON.stringify(T1));
    fs.symlinkSync(outside, path.join(base, '2026-06-10T01-00-00-000Z'));
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('INVALID_DUMP_ID');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('throws DUMP_NOT_FOUND for an absent dump and DUMP_UNREADABLE for corrupt json', () => {
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('DUMP_NOT_FOUND');
    const dir = path.join(base, '2026-06-10T01-00-00-000Z');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.json'), '{nope');
    expect(() => loadDumpTranscript(base, '2026-06-10T01-00-00-000Z')).toThrow('DUMP_UNREADABLE');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/session-dump-reader.test.ts`
Expected: FAIL — `Cannot find module '../session-dump-reader'`.

- [ ] **Step 5: Implement the reader**

Create `desktop/src/main/session-dump-reader.ts`:

```ts
/**
 * Read-side of the #113 finalize debug dumps — powers the F2 history viewer
 * (spec 2026-06-12-v2-history-viewer-design section 3).
 *
 * Electron-free (baseDir injected) like session-debug-dump.ts, so unit tests
 * run on plain tmp dirs. This module owns NO writes — the viewer must never
 * mutate dumps (P0-1: regen runs don't write dumps either).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DumpSummary, DumpTranscript } from '@shared/ipc-protocol';
import { DUMP_DIR_RE } from './session-debug-dump';

/** `2026-06-11T03-00-00-000Z(-N)` → ISO `2026-06-11T03:00:00.000Z`. */
function recordedAtFromId(id: string): string {
  const stamp = id.replace(/Z-\d+$/, 'Z');
  return stamp.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1:$2:$3.$4Z',
  );
}

/**
 * Traversal guard (review P1-2): id must match the dump dir shape AND the
 * realpath-resolved target's PARENT must equal the realpath of baseDir —
 * resolve-and-compare equality, not string prefix. Throws INVALID_DUMP_ID.
 * Returns the resolved dump dir path.
 */
function resolveDumpDir(baseDir: string, id: string): string {
  if (!DUMP_DIR_RE.test(id)) throw new Error('INVALID_DUMP_ID');
  const dir = path.join(baseDir, id);
  if (!fs.existsSync(dir)) throw new Error('DUMP_NOT_FOUND');
  const real = fs.realpathSync(dir);
  if (path.dirname(real) !== fs.realpathSync(baseDir)) {
    throw new Error('INVALID_DUMP_ID');
  }
  return real;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Newest-first summaries of every dump dir under baseDir. Never throws. */
export function listDumps(baseDir: string): DumpSummary[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && DUMP_DIR_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse(); // timestamp names sort chronologically → reverse = newest first
  } catch {
    return []; // base dir missing = no history yet
  }
  return names.map((id) => {
    const summary: DumpSummary = { id, recordedAt: recordedAtFromId(id) };
    try {
      const t = readJson(path.join(baseDir, id, 'transcript.json')) as DumpTranscript;
      summary.language = t.language;
      summary.llmModel = t.llmModel;
      summary.segmentCount = t.segmentCount ?? t.segments.length;
      summary.durationSec = t.durationSec ?? t.segments.at(-1)?.endSec ?? 0;
    } catch {
      summary.unreadable = true;
      return summary;
    }
    try {
      const r = readJson(path.join(baseDir, id, 'result.json')) as {
        ok?: boolean;
        family?: string;
      };
      summary.family = r.family;
      summary.ok = r.ok;
    } catch {
      // result.json absent (finalize crashed before settle) — list it anyway.
    }
    return summary;
  });
}

/** Full transcript payload of one dump. Throws INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE. */
export function loadDumpTranscript(baseDir: string, id: string): DumpTranscript {
  const dir = resolveDumpDir(baseDir, id);
  try {
    return readJson(path.join(dir, 'transcript.json')) as DumpTranscript;
  } catch {
    throw new Error('DUMP_UNREADABLE');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/session-dump-reader.test.ts`
Expected: PASS (8 tests). Also run the dump writer's own suite to prove the `DUMP_DIR_RE` export broke nothing:
`pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/session-debug-dump.test.ts src/main/__tests__/session-debug-dump-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/main/session-dump-reader.ts src/main/__tests__/session-dump-reader.test.ts src/shared/ipc-protocol.ts src/main/session-debug-dump.ts
git add desktop/src/shared/ipc-protocol.ts desktop/src/main/session-debug-dump.ts desktop/src/main/session-dump-reader.ts desktop/src/main/__tests__/session-dump-reader.test.ts
git commit -m "feat(desktop): session dump reader for F2 history viewer"
```

---

### Task 2: Dump-sourced finalize context builder

**Files:**
- Create: `desktop/src/main/dump-finalize-context.ts`
- Create: `desktop/src/main/__tests__/dump-finalize-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `desktop/src/main/__tests__/dump-finalize-context.test.ts`:

```ts
/**
 * buildDumpSessionContext — fully injected (no Electron). Covers review
 * defects: SESSION_ACTIVE guard, lazy sidecar respawn, language gate, and
 * P0-1 (NO dump dir is created by a from-dump run — fs dir count unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDumpSessionContext, type DumpFinalizeDeps } from '../dump-finalize-context';
import type { GrammarCapableSidecar } from '../sidecar/grammar-call';

const ID = '2026-06-10T01-00-00-000Z';
let base: string;

const SIDECAR: GrammarCapableSidecar = {
  generateWithGrammar: vi.fn(),
};

function writeDump(language = 'ja'): void {
  const dir = path.join(base, ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'transcript.json'),
    JSON.stringify({
      sessionId: 'live',
      language,
      llmModel: 'whatever.gguf',
      segments: [{ startSec: 0, endSec: 2, text: 'こんにちは' }],
    }),
  );
}

function makeDeps(over: Partial<DumpFinalizeDeps<string>> = {}): DumpFinalizeDeps<string> {
  return {
    baseDir: base,
    isLiveSessionActive: () => false,
    getClient: () => 'client',
    startClient: vi.fn(async () => 'fresh-client'),
    getModelPaths: () => ({ sttPath: '/m/stt.bin', llmPath: '/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
    loadLlm: vi.fn(async () => {}),
    makeSidecar: () => SIDECAR,
    ...over,
  };
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-ctx-'));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('buildDumpSessionContext', () => {
  it('builds a SessionContext from the dump with the CURRENT llm path and writes NO new dump dir', async () => {
    writeDump();
    const before = fs.readdirSync(base).length;
    const deps = makeDeps();
    const ctx = await buildDumpSessionContext(ID, deps);
    expect(ctx.sessionId).toBe(`dump:${ID}`);
    expect(ctx.segments).toHaveLength(1);
    expect(ctx.language).toBe('ja');
    expect(ctx.llmModelPath).toBe('/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
    expect(ctx.sidecar).toBe(SIDECAR); // raw sidecar — NOT dump-wrapped (P0-1)
    expect(deps.loadLlm).toHaveBeenCalledWith('client', '/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf');
    expect(fs.readdirSync(base).length).toBe(before); // P0-1: no dir created
  });

  it('rejects while a live session is active', async () => {
    writeDump();
    await expect(
      buildDumpSessionContext(ID, makeDeps({ isLiveSessionActive: () => true })),
    ).rejects.toThrow('SESSION_ACTIVE');
  });

  it('lazily respawns the sidecar when idle-stopped', async () => {
    writeDump();
    const deps = makeDeps({ getClient: () => null });
    await buildDumpSessionContext(ID, deps);
    expect(deps.startClient).toHaveBeenCalledOnce();
    expect(deps.loadLlm).toHaveBeenCalledWith('fresh-client', expect.any(String));
  });

  it('maps a respawn failure to SIDECAR_DOWN', async () => {
    writeDump();
    await expect(
      buildDumpSessionContext(ID, makeDeps({
        getClient: () => null,
        startClient: vi.fn(async () => { throw new Error('spawn fail'); }),
      })),
    ).rejects.toThrow('SIDECAR_DOWN');
  });

  it('rejects MODELS_NOT_CONFIGURED and unsupported dump language', async () => {
    writeDump('ko');
    await expect(buildDumpSessionContext(ID, makeDeps())).rejects.toThrow('UNSUPPORTED_LANGUAGE');
    writeDump('ja');
    await expect(
      buildDumpSessionContext(ID, makeDeps({ getModelPaths: () => null })),
    ).rejects.toThrow('MODELS_NOT_CONFIGURED');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/dump-finalize-context.test.ts`
Expected: FAIL — `Cannot find module '../dump-finalize-context'`.

- [ ] **Step 3: Implement**

Create `desktop/src/main/dump-finalize-context.ts`:

```ts
/**
 * Build a SessionContext from a #113 dump dir — the from-dump leg of the F2
 * history viewer (spec section 3 item 3, corrected per review P0-2).
 *
 * NOT a reuse of ipc.ts getCurrentSession: that closure is hard-wired to the
 * live orchestrator (`current`). This builder is fully injected so the shared
 * machinery (LLM load sequence, recovering sidecar) comes in as functions and
 * the whole thing unit-tests on tmp dirs without Electron.
 *
 * P0-1 by construction: this module creates NO SessionDump — a regen run
 * leaves the dump tree untouched, so repeated regens cannot evict the source
 * dump via the newest-20 prune.
 */
import type { NoteLanguage } from '@shared/note-schema';
import type { GrammarCapableSidecar } from './sidecar/grammar-call';
import type { SessionContext } from './sidecar/ipc/session-finalize';
import { loadDumpTranscript } from './session-dump-reader';

export interface DumpFinalizeDeps<C> {
  /** `<userData>/sessions` in production. */
  baseDir: string;
  /** Live session / recording in progress? (ipc.ts `current`/`recording`.) */
  isLiveSessionActive(): boolean;
  getClient(): C | null;
  /** Spawn + waitForReady; used when the idle-stop policy killed the sidecar. */
  startClient(): Promise<C>;
  getModelPaths(): { sttPath: string; llmPath: string } | null;
  /** The shared unload-STT → load-LLM finalize prep (ipc.ts loadLlmForFinalize). */
  loadLlm(client: C, llmPath: string): Promise<void>;
  /** The shared recovering-sidecar factory (ipc.ts makeRecoveringSidecarFor). */
  makeSidecar(llmPath: string): GrammarCapableSidecar;
}

export async function buildDumpSessionContext<C>(
  id: string,
  deps: DumpFinalizeDeps<C>,
): Promise<SessionContext> {
  if (deps.isLiveSessionActive()) throw new Error('SESSION_ACTIVE');
  const paths = deps.getModelPaths();
  if (!paths) throw new Error('MODELS_NOT_CONFIGURED');

  // Throws INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE (reader guards).
  const dump = loadDumpTranscript(deps.baseDir, id);
  if (dump.language !== 'ja' && dump.language !== 'en') {
    throw new Error('UNSUPPORTED_LANGUAGE');
  }

  let client = deps.getClient();
  if (!client) {
    try {
      client = await deps.startClient();
    } catch {
      throw new Error('SIDECAR_DOWN');
    }
  }
  await deps.loadLlm(client, paths.llmPath);

  return {
    sessionId: `dump:${id}`,
    segments: dump.segments,
    // Regens run against the CURRENTLY configured model — the dump's
    // `llmModel` is display metadata only (dumps store basenames, not paths).
    llmModelPath: paths.llmPath,
    language: dump.language as NoteLanguage,
    sidecar: deps.makeSidecar(paths.llmPath),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/dump-finalize-context.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/main/dump-finalize-context.ts src/main/__tests__/dump-finalize-context.test.ts
git add desktop/src/main/dump-finalize-context.ts desktop/src/main/__tests__/dump-finalize-context.test.ts
git commit -m "feat(desktop): dump-sourced finalize context builder (no dump write on regen)"
```

---

### Task 3: Consolidate family routing in session-finalize.ts (behavior-preserving)

The four `route*` functions in `desktop/src/main/sidecar/ipc/session-finalize.ts:166-310` are 4× near-identical (DRY trigger per `.claude/rules/architecture.md`). Consolidating them is the seam the from-dump channel needs (Task 4). ZERO behavior change — the existing 11-case test file is the gate and must not be edited in this task.

**Files:**
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts`
- Test (existing, unchanged): `desktop/src/main/sidecar/ipc/__tests__/session-finalize.test.ts`

- [ ] **Step 1: Replace the four route* functions with routeFamily**

Delete `routeLecture`, `routeMeeting`, `routeInterview`, `routeBrainstorm` (lines 164-310) and add:

```ts
// ─── family routing (consolidated — was 4 near-identical route* fns) ────────

/**
 * Adapt a SessionContext (live OR dump-sourced) and dispatch to the family
 * finalizer. Lecture takes no diarizationStatus; the other three run the
 * alpha 'disabled' collapse (see the per-family rationale that lived on the
 * old route* fns: Plan 4 Phase B diarization is not yet plumbed into
 * SessionContext, so multi-speaker families collapse to single-speaker and
 * emit SINGLE_SPEAKER_WARNING).
 */
async function routeFamily(
  session: SessionContext,
  family: NoteFamily,
  promptVariantId: string | undefined,
  onTelemetry: SessionFinalizeDeps['onTelemetry'],
): Promise<SessionFinalizeResult> {
  const transcript = adaptToV2Transcript(session.segments, session.sessionId);
  const basename = path.basename(session.llmModelPath);
  const modelProfile = Object.values(modelProfiles).find((p) => p.filename === basename);
  if (!modelProfile) throw new Error('UNKNOWN_MODEL_PROFILE');

  const common = {
    sessionId: session.sessionId,
    transcript,
    sidecar: session.sidecar,
    modelProfile,
    promptVariantId,
    language: session.language,
    onTelemetry,
  };

  let result;
  if (family === 'lecture') result = await finalizeLecture(common);
  else if (family === 'meeting') result = await finalizeMeeting({ ...common, diarizationStatus: 'disabled' });
  else if (family === 'interview') result = await finalizeInterview({ ...common, diarizationStatus: 'disabled' });
  else if (family === 'brainstorm') result = await finalizeBrainstorm({ ...common, diarizationStatus: 'disabled' });
  // Runtime check matters: callers send un-typed JSON over IPC.
  else throw new Error(`UNKNOWN_FAMILY:${family as string}`);

  return { noteId: result.telemetry.noteId, note: result.note };
}
```

- [ ] **Step 2: Rewire the handler body**

Inside `registerSessionFinalize`, replace the family-routing block (the `if (family === 'lecture') ... routeLecture(deps, promptVariant)` chain) with:

```ts
      // ── Family routing ────────────────────────────────────────────────────
      const session = await deps.getCurrentSession();
      if (!session) throw new Error('NO_ACTIVE_SESSION');
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
```

(The `UNKNOWN_FAMILY` throw now lives inside `routeFamily`. NOTE the ordering nuance: previously the UNKNOWN_FAMILY check ran BEFORE `getCurrentSession`; now an unknown family with no active session throws NO_ACTIVE_SESSION first. Check the existing test (g): it passes a valid session mock with an unknown family, so it still sees `UNKNOWN_FAMILY:` — behavior preserved for every existing case.)

- [ ] **Step 3: Run the existing suite to verify behavior preservation**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts`
Expected: PASS, zero test-file edits. If (g) fails on ordering, STOP and re-check Step 2 — do not edit the test.

- [ ] **Step 4: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/main/sidecar/ipc/session-finalize.ts
git add desktop/src/main/sidecar/ipc/session-finalize.ts
git commit -m "refactor(desktop): consolidate 4 route* fns into routeFamily (no behavior change)"
```

---

### Task 4: from-dump finalize channel + in-flight guard

**Files:**
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts`
- Modify: `desktop/src/main/sidecar/ipc/__tests__/session-finalize.test.ts`

- [ ] **Step 1: Extend the test file's electron mock to capture BOTH channels**

In `session-finalize.test.ts`, replace the `capturedHandler` mock block with:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (e: unknown, args: any) => Promise<any>;
const captured = new Map<string, AnyHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      captured.set(channel, handler as AnyHandler);
    }),
  },
}));
```

and update every existing use of `capturedHandler` to `captured.get('session/finalize')!` (the `beforeEach` that resets it becomes `captured.clear()` before each `registerSessionFinalize(...)` call — follow the file's existing reset pattern).

- [ ] **Step 2: Add the failing from-dump + guard tests**

Append to the test file (reuse the file's existing `makeLectureNoteJson`, `makeMockSidecar`, and session helpers):

```ts
describe('session/finalize-from-dump', () => {
  function dumpSession(): SessionContext {
    return {
      sessionId: 'dump:2026-06-10T01-00-00-000Z',
      segments: [
        { startSec: 0, endSec: 2, text: 'こんにちは', noSpeechProb: 0.01 } as LegacySegment,
      ],
      llmModelPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      sidecar: makeMockSidecar(makeLectureNoteJson()),
      language: 'ja' as const,
    };
  }

  it('routes a dump session through the same family dispatch (shape parity)', async () => {
    const getDumpSession = vi.fn(async (_id: string) => dumpSession());
    registerSessionFinalize({
      getCurrentSession: async () => null, // no live session — must NOT matter
      getDumpSession,
    });
    const handler = captured.get('session/finalize-from-dump')!;
    const res = await handler({}, { id: '2026-06-10T01-00-00-000Z', family: 'lecture' });
    expect(getDumpSession).toHaveBeenCalledWith('2026-06-10T01-00-00-000Z');
    expect(res.note.family).toBe('lecture');
    expect(typeof res.noteId).toBe('string'); // shape parity with session/finalize
  });

  it('propagates getDumpSession guard errors (SESSION_ACTIVE)', async () => {
    registerSessionFinalize({
      getCurrentSession: async () => null,
      getDumpSession: async () => { throw new Error('SESSION_ACTIVE'); },
    });
    const handler = captured.get('session/finalize-from-dump')!;
    await expect(handler({}, { id: 'x', family: 'lecture' })).rejects.toThrow('SESSION_ACTIVE');
  });

  it('rejects when registered without getDumpSession', async () => {
    registerSessionFinalize({ getCurrentSession: async () => null });
    const handler = captured.get('session/finalize-from-dump')!;
    await expect(handler({}, { id: 'x', family: 'lecture' })).rejects.toThrow('DUMP_FINALIZE_UNAVAILABLE');
  });

  it('notifies onSessionSettled on success and failure (dump leg)', async () => {
    const settles: unknown[] = [];
    registerSessionFinalize({
      getCurrentSession: async () => null,
      getDumpSession: async () => dumpSession(),
      onSessionSettled: (r) => settles.push(r),
    });
    const handler = captured.get('session/finalize-from-dump')!;
    await handler({}, { id: '2026-06-10T01-00-00-000Z', family: 'lecture' });
    expect(settles).toEqual([expect.objectContaining({ ok: true, family: 'lecture' })]);
  });
});

describe('finalize in-flight guard (review P1-1)', () => {
  it('rejects a concurrent finalize while one is in flight, allows after settle', async () => {
    // A session whose sidecar never resolves until released.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowSidecar: GrammarCapableSidecar = {
      generateWithGrammar: vi.fn(async () => {
        await gate;
        return { text: makeLectureNoteJson(), seed: 42 };
      }),
    };
    const session: SessionContext = {
      sessionId: 'live',
      segments: [{ startSec: 0, endSec: 2, text: 'テスト', noSpeechProb: 0.01 } as LegacySegment],
      llmModelPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      sidecar: slowSidecar,
      language: 'ja',
    };
    registerSessionFinalize({
      getCurrentSession: async () => session,
      getDumpSession: async () => session,
    });
    const live = captured.get('session/finalize')!;
    const fromDump = captured.get('session/finalize-from-dump')!;

    const first = live({}, { family: 'lecture' });
    // Concurrent second call on EITHER channel rejects synchronously-fast.
    await expect(fromDump({}, { id: 'x', family: 'lecture' })).rejects.toThrow('FINALIZE_IN_FLIGHT');
    await expect(live({}, { family: 'lecture' })).rejects.toThrow('FINALIZE_IN_FLIGHT');

    release();
    await first; // settles fine
    // Guard released — a new call proceeds past the in-flight rejection.
    const second = await fromDump({}, { id: 'x', family: 'lecture' });
    expect(second.note.family).toBe('lecture');
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts`
Expected: existing cases PASS (after the mock refactor); new describe blocks FAIL (`captured.get('session/finalize-from-dump')` is undefined; FINALIZE_IN_FLIGHT not thrown).

- [ ] **Step 4: Implement channel + guard**

In `session-finalize.ts`:

(a) Add after `SESSION_FINALIZE_CHANNEL`:

```ts
export const SESSION_FINALIZE_FROM_DUMP_CHANNEL = 'session/finalize-from-dump' as const;

export interface SessionFinalizeFromDumpArgs {
  /** Dump dir name under <userData>/sessions — validated main-side. */
  id: string;
  family: NoteFamily;
  promptVariant?: string;
}
```

(b) Add to `SessionFinalizeDeps`:

```ts
  /**
   * F2 history viewer — resolve a dump-sourced SessionContext (ipc.ts wires
   * buildDumpSessionContext). THROWS its guard errors (SESSION_ACTIVE /
   * INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE / MODELS_NOT_CONFIGURED
   * / SIDECAR_DOWN / UNSUPPORTED_LANGUAGE) rather than returning null — unlike
   * getCurrentSession, "no such context" is always a caller error here.
   */
  getDumpSession?: (id: string) => Promise<SessionContext>;
```

(c) Rewrite `registerSessionFinalize` so both handlers share one in-flight flag (closure-scoped — fresh per registration, so tests that re-register get a clean flag):

```ts
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  // Review P1-1: SESSION_ACTIVE only checks the live `current`; nothing
  // stopped two concurrent finalizes (live double-fire, or live-vs-dump)
  // from racing two generate streams over the single-threaded sidecar.
  // One flag covers both channels registered by this call.
  let finalizeInFlight = false;

  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<SessionFinalizeResult> => {
    const { family, promptVariant } = args;
    if (finalizeInFlight) throw new Error('FINALIZE_IN_FLIGHT');
    finalizeInFlight = true;

    let settle: SessionSettleResult = { ok: false, family, error: 'FINALIZE_NOT_RUN' };
    try {
      const session = await deps.getCurrentSession();
      if (!session) throw new Error('NO_ACTIVE_SESSION');
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
    } catch (err) {
      settle = { ok: false, family, error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      finalizeInFlight = false;
      // Always notify — the caller (main/ipc.ts) uses `ok` to decide whether
      // to clear the orchestrator (P0-3 preservation on failure unchanged).
      deps.onSessionSettled?.(settle);
    }
  });

  ipcMain.handle(SESSION_FINALIZE_FROM_DUMP_CHANNEL, async (_e, args: SessionFinalizeFromDumpArgs): Promise<SessionFinalizeResult> => {
    const { id, family, promptVariant } = args;
    const getDumpSession = deps.getDumpSession;
    if (!getDumpSession) throw new Error('DUMP_FINALIZE_UNAVAILABLE');
    if (finalizeInFlight) throw new Error('FINALIZE_IN_FLIGHT');
    finalizeInFlight = true;

    let settle: SessionSettleResult = { ok: false, family, error: 'FINALIZE_NOT_RUN' };
    try {
      const session = await getDumpSession(id);
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
    } catch (err) {
      settle = { ok: false, family, error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      finalizeInFlight = false;
      // Shared settle sink: ipc.ts unloads the LLM + re-arms idle-stop. The
      // live-FSM mutations in there are no-ops for dump runs (`current` is
      // null — the SESSION_ACTIVE guard in getDumpSession ensures it) and
      // `_activeDump` is null (no dump created — P0-1), so reuse is safe.
      deps.onSessionSettled?.(settle);
    }
  });
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts`
Expected: PASS (existing 11 + new 6).

- [ ] **Step 6: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/main/sidecar/ipc/session-finalize.ts src/main/sidecar/ipc/__tests__/session-finalize.test.ts
git add desktop/src/main/sidecar/ipc/session-finalize.ts desktop/src/main/sidecar/ipc/__tests__/session-finalize.test.ts
git commit -m "feat(desktop): session/finalize-from-dump channel + finalize in-flight guard"
```

---

### Task 5: ipc.ts wiring — shared helpers, getDumpSession, list/load handlers

**Files:**
- Modify: `desktop/src/main/ipc.ts`

No new unit test file — the logic lives in Tasks 1/2/4 modules; this task is thin wiring verified by typecheck + the full main-process suite staying green.

- [ ] **Step 1: Add CHANNELS entries**

In the `CHANNELS` const (after `sessionFinalize`):

```ts
  /** renderer → main: F2 history viewer — list #113 dump summaries. */
  sessionListDumps: 'session/list-dumps',
  /** renderer → main: F2 — full transcript of one dump. */
  sessionLoadDump: 'session/load-dump',
  /** renderer → main: F2 — regenerate a note from a dump transcript.
   *  Registered in session-finalize.ts (SESSION_FINALIZE_FROM_DUMP_CHANNEL). */
  sessionFinalizeFromDump: 'session/finalize-from-dump',
```

- [ ] **Step 2: Add imports**

```ts
import type { GrammarCapableSidecar } from './sidecar/grammar-call';
import { buildDumpSessionContext } from './dump-finalize-context';
import { listDumps, loadDumpTranscript } from './session-dump-reader';
```

(`makeGrammarSidecar`, `makeRecoveringGrammarSidecar`, `WhisperCppSTT`, `LlamaCppLLM` are already imported.)

- [ ] **Step 3: Extract the two shared helpers (review P0-2)**

Add at module scope (below `unloadLlmIdle`):

```ts
type SidecarClientLike = NonNullable<ReturnType<SidecarSupervisor['getClient']>>;

/** Where finalize reads + the viewer lists dumps. Single source for the path. */
function sessionsBaseDir(): string {
  return path.join(app.getPath('userData'), 'sessions');
}

/**
 * Spec §9 finalize prep, shared by the live path (getCurrentSession) and the
 * from-dump path: unload STT (idempotent) → load LLM, with the phase
 * breadcrumbs the founder-visible main.log timing decomposition relies on.
 */
async function loadLlmForFinalize(client: SidecarClientLike, llmPath: string): Promise<void> {
  const stt = new WhisperCppSTT(client);
  const llm = new LlamaCppLLM(client);
  const sttT0 = Date.now();
  await stt.unloadModel().catch(() => {
    // STT may not have been loaded (no recording happened, or already
    // unloaded by a prior finalize). Either way, proceed to LLM load.
  });
  sessionLog.phase('stt-unload-finalize', Date.now() - sttT0);
  const llmT0 = Date.now();
  await llm.loadModel(llmPath);
  sessionLog.phase('llm-load-finalize', Date.now() - llmT0);
}

/**
 * Wedged-retry recovery wrapper (2026-06-10 RCA in recovering-grammar-sidecar
 * .ts), shared by live + from-dump finalize paths. Resolves the client LAZILY
 * per generate call; on a no-progress stall restarts the sidecar + reloads
 * the LLM so fresh-seed retries hit a live process.
 */
function makeRecoveringSidecarFor(llmPath: string): GrammarCapableSidecar {
  return makeRecoveringGrammarSidecar({
    getSidecar: () => {
      const c = _depsRef?.supervisor.getClient();
      return c ? makeGrammarSidecar(c) : null;
    },
    recover: async () => {
      log.warn('[finalize] generate stalled (no progress) — restarting sidecar + reloading LLM');
      const t0 = Date.now();
      try {
        const fresh = await _depsRef!.supervisor.restart();
        await fresh.waitForReady(5000);
        await new LlamaCppLLM(fresh).loadModel(llmPath);
        sessionLog.phase('llm-reload-recovery', Date.now() - t0);
      } catch (e) {
        // Force the next finalize to re-run the full prep instead of trusting
        // the cache.
        _llmLoadedForCurrent = null;
        throw e;
      }
    },
  });
}
```

- [ ] **Step 4: Rewire getCurrentSession to use the helpers**

Inside `registerSessionFinalize({ getCurrentSession: ... })`, replace the inline LLM-load block (`if (_llmLoadedForCurrent !== current) { ... }`) with:

```ts
      if (_llmLoadedForCurrent !== current) {
        await loadLlmForFinalize(client, paths.llmPath);
        _llmLoadedForCurrent = current;
      }
```

and replace the inline `const recoveringSidecar = makeRecoveringGrammarSidecar({ ... })` block with:

```ts
      const recoveringSidecar = makeRecoveringSidecarFor(paths.llmPath);
```

Also replace the `_activeDump = createSessionDump({ baseDir: path.join(app.getPath('userData'), 'sessions') })` call's baseDir argument with `sessionsBaseDir()`. Keep everything else (dump creation, writeTranscript, cache semantics, SessionContext shape) byte-identical.

- [ ] **Step 5: Wire getDumpSession into registerSessionFinalize deps**

Add to the `registerSessionFinalize({ ... })` deps object, after `getCurrentSession`:

```ts
    // F2 history viewer — from-dump finalize context. NO dump is created for
    // regen runs (P0-1; buildDumpSessionContext never calls createSessionDump).
    getDumpSession: async (id: string) => {
      cancelIdleStop(); // regen is "in use" — settle re-arms via onSessionSettled
      return buildDumpSessionContext(id, {
        baseDir: sessionsBaseDir(),
        isLiveSessionActive: () => current !== null || recording,
        getClient: () => deps.supervisor.getClient(),
        startClient: async () => {
          const c = deps.supervisor.start();
          await c.waitForReady(5000);
          return c;
        },
        getModelPaths: () => deps.getModelPaths(),
        loadLlm: loadLlmForFinalize,
        makeSidecar: makeRecoveringSidecarFor,
      });
    },
```

- [ ] **Step 6: Register list/load handlers**

Add next to the `sessionDiscard` handler:

```ts
  // ── F2 history viewer: dump list + transcript (read-only) ────────────────
  ipcMain.handle(CHANNELS.sessionListDumps, async () => listDumps(sessionsBaseDir()));
  ipcMain.handle(CHANNELS.sessionLoadDump, async (_e, payload: { id: string }) =>
    loadDumpTranscript(sessionsBaseDir(), payload.id));
```

- [ ] **Step 7: Typecheck + full main suite**

Run: `pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: clean.
Run: `pnpm --filter @lisna/desktop exec vitest run src/main/`
Expected: PASS (no main-process regression — getCurrentSession refactor is behavior-preserving).

- [ ] **Step 8: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/main/ipc.ts
git add desktop/src/main/ipc.ts
git commit -m "feat(desktop): wire dump list/load/finalize-from-dump IPC + factor shared finalize helpers"
```

---

### Task 6: Preload bridges

**Files:**
- Modify: `desktop/src/preload/index.ts`

- [ ] **Step 1: Add bridges**

Imports: add `DumpSummary, DumpTranscript` to the `@shared/ipc-protocol` type import and `SessionFinalizeFromDumpArgs` to the `session-finalize` type import.

In the `contextBridge.exposeInMainWorld('lisna', { ... })` object, after `finalize`:

```ts
  // --- F2 history viewer ---

  /** Newest-first summaries of past finalize dumps (#113 tree). */
  listDumps: (): Promise<DumpSummary[]> =>
    ipcRenderer.invoke(CHANNELS.sessionListDumps),

  /** Full transcript of one dump. Throws INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE. */
  loadDump: (id: string): Promise<DumpTranscript> =>
    ipcRenderer.invoke(CHANNELS.sessionLoadDump, { id }),

  /**
   * Regenerate a note from a dump transcript. Same result shape as
   * `finalize`. Rejects with SESSION_ACTIVE while recording, and with
   * FINALIZE_IN_FLIGHT when another finalize is running.
   */
  finalizeFromDump: (args: SessionFinalizeFromDumpArgs): Promise<SessionFinalizeResult> =>
    ipcRenderer.invoke(CHANNELS.sessionFinalizeFromDump, args),
```

In the `declare global` Window decl, after `finalize(...)`:

```ts
      listDumps(): Promise<DumpSummary[]>;
      loadDump(id: string): Promise<DumpTranscript>;
      finalizeFromDump(args: SessionFinalizeFromDumpArgs): Promise<SessionFinalizeResult>;
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
pnpm --filter @lisna/desktop exec tsc --noEmit
pnpm --filter @lisna/desktop exec eslint src/preload/index.ts
git add desktop/src/preload/index.ts
git commit -m "feat(desktop): preload bridges for history viewer (listDumps/loadDump/finalizeFromDump)"
```

---

### Task 7: HistoryList component (presentational)

Renderer tests in this repo are STATIC (`renderToStaticMarkup`, no DOM env, no effects) — so list rendering is a pure prop-driven component; the data fetch lives in Recording.tsx (Task 9).

**Files:**
- Create: `desktop/src/renderer/components/HistoryList.tsx`
- Create: `desktop/src/renderer/components/__tests__/HistoryList.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * Static structural tests (renderToStaticMarkup — vitest config has no DOM
 * env; click wiring is verified via the live app per CLAUDE.md UI guidance).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryList } from '../HistoryList';
import type { DumpSummary } from '@shared/ipc-protocol';

const ROWS: DumpSummary[] = [
  {
    id: '2026-06-11T01-00-00-000Z',
    recordedAt: '2026-06-11T01:00:00.000Z',
    language: 'ja',
    llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    segmentCount: 12,
    durationSec: 95,
    family: 'interview',
    ok: false,
  },
  { id: '2026-06-10T01-00-00-000Z', recordedAt: '2026-06-10T01:00:00.000Z', unreadable: true },
];

describe('HistoryList', () => {
  it('renders nothing for an empty list', () => {
    expect(renderToStaticMarkup(<HistoryList dumps={[]} onOpen={() => {}} />)).toBe('');
  });

  it('renders a button row per readable dump with duration + status badge', () => {
    const html = renderToStaticMarkup(<HistoryList dumps={ROWS} onOpen={() => {}} />);
    expect(html).toContain('history-row-2026-06-11T01-00-00-000Z');
    expect(html).toContain('1:35');        // 95s formatted m:ss
    expect(html).toContain('interview');
    expect(html).toContain('失敗');         // ok:false badge
  });

  it('renders unreadable dumps as unselectable text, not buttons', () => {
    const html = renderToStaticMarkup(<HistoryList dumps={ROWS} onOpen={() => {}} />);
    expect(html).toContain('読み込み不可');
    expect(html).not.toContain('history-row-2026-06-10T01-00-00-000Z');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/__tests__/HistoryList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/renderer/components/HistoryList.tsx`:

```tsx
import type { DumpSummary } from '@shared/ipc-protocol';

/**
 * F2 history viewer — list of past finalize dumps, shown in the idle
 * Recording view. Pure/presentational (static-markup testable); the parent
 * fetches via window.lisna.listDumps(). Work-surface rules: tokens only,
 * no decoration (web-design.md scope-boundary).
 */
interface Props {
  dumps: DumpSummary[];
  onOpen: (id: string) => void;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatRecordedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function HistoryList({ dumps, onOpen }: Props) {
  if (dumps.length === 0) return null;
  return (
    <div data-testid="history-section">
      <h3>History</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {dumps.map((d) => (
          <li key={d.id} style={{ marginBottom: '0.25em' }}>
            {d.unreadable ? (
              <span style={{ color: '#999' }}>
                {formatRecordedAt(d.recordedAt)} — 読み込み不可
              </span>
            ) : (
              <button
                data-testid={`history-row-${d.id}`}
                onClick={() => onOpen(d.id)}
                style={{
                  background: 'transparent',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {formatRecordedAt(d.recordedAt)} · {formatDuration(d.durationSec ?? 0)} ·{' '}
                {d.language ?? '?'}
                {d.family ? ` · ${d.family}` : ''}
                {d.ok === true ? ' · ✓' : d.ok === false ? ' · 失敗' : ''}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/__tests__/HistoryList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/renderer/components/HistoryList.tsx src/renderer/components/__tests__/HistoryList.test.tsx
git add desktop/src/renderer/components/HistoryList.tsx desktop/src/renderer/components/__tests__/HistoryList.test.tsx
git commit -m "feat(desktop): HistoryList component"
```

---

### Task 8: History route (detail view: transcript + family picker)

Split per the static-test constraint: `HistoryDetail` (pure, exported, tested) + `History` (container that fetches via `window.lisna.loadDump` and handles loading/error states).

**Files:**
- Create: `desktop/src/renderer/routes/History.tsx`
- Create: `desktop/src/renderer/routes/__tests__/History.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/** Static structural tests for the pure HistoryDetail (container fetch is
 *  live-app-verified, consistent with ErrorView.test.tsx's approach). */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryDetail } from '../History';
import type { DumpTranscript } from '@shared/ipc-protocol';

const TRANSCRIPT: DumpTranscript = {
  sessionId: 'live',
  language: 'ja',
  llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  segments: [
    { startSec: 0, endSec: 2, text: 'こんにちは', noSpeechProb: 0.01 },
    { startSec: 2, endSec: 5, text: 'テストです', noSpeechProb: 0.01 },
  ] as DumpTranscript['segments'],
};

describe('HistoryDetail', () => {
  it('renders transcript segments, meta line, back button, and the family picker', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={TRANSCRIPT}
        onBack={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(html).toContain('history-detail');
    expect(html).toContain('history-back');
    expect(html).toContain('こんにちは');
    expect(html).toContain('テストです');
    expect(html).toContain('2 segments');
    // FamilyPickerStep is embedded for re-pickable family (F1 parity).
    expect(html).toContain('family-picker');
    expect(html).toContain('family-continue');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/routes/__tests__/History.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `desktop/src/renderer/routes/History.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { DumpTranscript } from '@shared/ipc-protocol';
import type { NoteFamily } from '@shared/note-schema';
import type { TranscriptSegment } from '@shared/types';
import { FamilyPickerStep } from '../components/FamilyPickerStep';
import { Spinner } from '../components/Spinner';

/**
 * F2 history viewer — detail route. Read-only transcript + family picker +
 * regenerate (spec section 4). The picker's 続行 fires onRegenerate; its
 * built-in `submitting` guard gives the double-fire protection (review P1-1
 * renderer leg). ノートを作らずに戻る doubles as back.
 */
interface DetailProps {
  id: string;
  transcript: DumpTranscript;
  onBack: () => void;
  onRegenerate: (family: NoteFamily, segments: TranscriptSegment[]) => void;
}

/** Pure detail view — exported for static-markup tests. */
export function HistoryDetail({ id, transcript, onBack, onRegenerate }: DetailProps) {
  return (
    <section data-testid="history-detail">
      <button data-testid="history-back" onClick={onBack}>← 戻る</button>
      <h2>録音履歴</h2>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        {id} · {transcript.language} · {transcript.segments.length} segments · {transcript.llmModel}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '40vh', overflowY: 'auto' }}>
        {transcript.segments.map((seg, i) => (
          <li key={i} style={{ fontFamily: 'monospace', marginBottom: '0.25em' }}>
            [{seg.startSec.toFixed(1)}] {seg.text}
          </li>
        ))}
      </ul>
      <FamilyPickerStep
        onPick={(family) => onRegenerate(family, transcript.segments)}
        onDiscard={onBack}
      />
    </section>
  );
}

interface Props {
  id: string;
  onBack: () => void;
  onRegenerate: (family: NoteFamily, segments: TranscriptSegment[]) => void;
}

/** Container: fetches the dump transcript, then renders HistoryDetail. */
export function History({ id, onBack, onRegenerate }: Props) {
  const [transcript, setTranscript] = useState<DumpTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.lisna
      .loadDump(id)
      .then((t) => { if (active) setTranscript(t); })
      .catch((err) => { if (active) setError(String((err as Error)?.message ?? err)); });
    return () => { active = false; };
  }, [id]);

  if (error) {
    return (
      <section data-testid="history-detail-error">
        <p>履歴を読み込めませんでした ({error})</p>
        <button onClick={onBack}>← 戻る</button>
      </section>
    );
  }
  if (!transcript) {
    return (
      <section>
        <Spinner /> 読み込み中…
      </section>
    );
  }
  return <HistoryDetail id={id} transcript={transcript} onBack={onBack} onRegenerate={onRegenerate} />;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/routes/__tests__/History.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/renderer/routes/History.tsx src/renderer/routes/__tests__/History.test.tsx
git add desktop/src/renderer/routes/History.tsx desktop/src/renderer/routes/__tests__/History.test.tsx
git commit -m "feat(desktop): History route (dump transcript + regenerate picker)"
```

---

### Task 9: App FSM + Recording entry point + origin-aware retry

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/routes/Recording.tsx`
- Create: `desktop/src/renderer/__tests__/retry-view.test.ts`

- [ ] **Step 1: Write the failing test (P0-3 named case)**

Create `desktop/src/renderer/__tests__/retry-view.test.ts`:

```ts
/**
 * Review P0-3: a from-dump finalize failure must NOT retry through the live
 * `session/finalize` (current === null → guaranteed NO_ACTIVE_SESSION).
 * retryViewFor routes dump-origin errors back to the History detail (family
 * re-pickable there); live-origin errors keep the F1 familyPicking edge.
 */
import { describe, it, expect } from 'vitest';
import { retryViewFor } from '../App';
import type { TranscriptSegment } from '@shared/types';

const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'x', noSpeechProb: 0 }] as TranscriptSegment[];

describe('retryViewFor', () => {
  it('routes live-origin (and origin-less legacy) errors to familyPicking with preserved segments', () => {
    expect(retryViewFor({ segments: SEGMENTS })).toEqual({ kind: 'familyPicking', segments: SEGMENTS });
    expect(retryViewFor({ origin: { kind: 'live' }, segments: SEGMENTS })).toEqual({
      kind: 'familyPicking',
      segments: SEGMENTS,
    });
  });

  it('routes dump-origin errors back to the History detail', () => {
    expect(
      retryViewFor({ origin: { kind: 'dump', id: '2026-06-11T01-00-00-000Z' }, segments: SEGMENTS }),
    ).toEqual({ kind: 'history', id: '2026-06-11T01-00-00-000Z' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/__tests__/retry-view.test.ts`
Expected: FAIL — `retryViewFor` is not exported.

- [ ] **Step 3: App.tsx changes**

(a) Imports: add `import { History } from './routes/History';` and `import type { NoteFamily } from '@shared/note-schema';` (NoteFamily is already imported — keep single import).

(b) View union (`App.tsx:12-19`) becomes:

```ts
export type ErrorOrigin = { kind: 'live' } | { kind: 'dump'; id: string };

type View =
  | { kind: 'booting' }
  | { kind: 'setup'; initialStep: 'stt' | 'llm'; initialError?: string }
  | { kind: 'recording'; segments: TranscriptSegment[] }
  | { kind: 'history'; id: string }
  | { kind: 'familyPicking'; segments: TranscriptSegment[] }
  | { kind: 'curatingV2'; segments: TranscriptSegment[]; progress: ProgressState | null }
  | { kind: 'note'; note: Note | NoteBase }
  | { kind: 'error'; message: string; segments: TranscriptSegment[]; permanent?: boolean; origin?: ErrorOrigin };
```

(c) Add the exported pure retry router (module scope, near `inFlightSegments`):

```ts
/**
 * Review P0-3: ErrorView's retry edge is origin-aware. Live-origin (or
 * legacy origin-less) failures keep the F1 edge — familyPicking against the
 * preserved live transcript (`current` survives failure, ipc.ts P0-3). A
 * from-dump failure has NO live session, so retry routes back to the History
 * detail where the family is re-pickable and regenerate re-dispatches
 * finalizeFromDump.
 */
export function retryViewFor(error: {
  origin?: ErrorOrigin;
  segments: TranscriptSegment[];
}): View {
  return error.origin?.kind === 'dump'
    ? { kind: 'history', id: error.origin.id }
    : { kind: 'familyPicking', segments: error.segments };
}
```

(Export `type View` is NOT needed; `retryViewFor`'s declared return type makes tsc check the literal shapes. Keep `View` unexported.)

(d) `renderView` — add the `history` case after `recording`:

```tsx
    case 'history':
      return (
        <History
          id={view.id}
          onBack={() => setView({ kind: 'recording', segments: [] })}
          onRegenerate={(family, segments) => {
            // Mirror the live picker flow: mount progress synchronously,
            // then run the from-dump finalize.
            setView({ kind: 'curatingV2', segments: [...segments], progress: { phase: 'loading' } });
            void runFinalizeFromDump(view.id, family, setView);
          }}
        />
      );
```

(e) `recording` case — pass the new prop:

```tsx
          onOpenHistory={(id) => setView({ kind: 'history', id })}
```

(f) `error` case — replace `onRetry={() => setView({ kind: 'familyPicking', segments: view.segments })}` (keep the existing F1 comment above it) with:

```tsx
          onRetry={() => setView(retryViewFor(view))}
```

(g) Add `runFinalizeFromDump` next to `runFinalize`:

```ts
/**
 * From-dump twin of runFinalize. Failure carries `origin: {kind:'dump', id}`
 * so the ErrorView retry edge routes back to History (review P0-3) instead
 * of the live finalize (which would deterministically NO_ACTIVE_SESSION).
 */
async function runFinalizeFromDump(
  id: string,
  family: NoteFamily,
  setView: (next: View | ((p: View) => View)) => void,
): Promise<void> {
  try {
    const result = await window.lisna.finalizeFromDump({ id, family });
    setView({ kind: 'note', note: result.note });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (message.includes('APP_QUIT')) return;
    setView((prev) => {
      if (prev.kind === 'error') return prev;
      return {
        kind: 'error',
        message,
        segments: inFlightSegments(prev),
        origin: { kind: 'dump', id },
      };
    });
  }
}
```

- [ ] **Step 4: Recording.tsx changes**

(a) Props gain the entry point:

```ts
interface Props {
  segments: TranscriptSegment[];
  onStop: () => void;
  onError: (message: string) => void;
  /** F2: open the History detail for a dump id (parent owns the FSM). */
  onOpenHistory: (id: string) => void;
}
```

and the signature: `export function Recording({ segments, onStop, onError, onOpenHistory }: Props) {`.

(b) Imports: add

```ts
import type { DumpSummary } from '@shared/ipc-protocol';
import { HistoryList } from '../components/HistoryList';
```

(c) State + fetch (after the `capabilities` effect): the list shows only in the not-recording state (`running === false` — review P2-1) and refreshes when a recording ends:

```ts
  const [dumps, setDumps] = useState<DumpSummary[]>([]);
  useEffect(() => {
    if (running || starting) return;
    let cancelled = false;
    void window.lisna
      .listDumps()
      .then((d) => { if (!cancelled) setDumps(d); })
      .catch(() => { /* history is best-effort; an IPC error just hides it */ });
    return () => { cancelled = true; };
  }, [running, starting]);
```

(d) Render — append inside the root `<section>`, after the live-captions block:

```tsx
      {!running && !starting && <HistoryList dumps={dumps} onOpen={onOpenHistory} />}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/__tests__/retry-view.test.ts`
Expected: PASS.
Run: `pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: clean (this catches the Recording props change at its App.tsx call site).

- [ ] **Step 6: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/renderer/App.tsx src/renderer/routes/Recording.tsx src/renderer/__tests__/retry-view.test.ts
git add desktop/src/renderer/App.tsx desktop/src/renderer/routes/Recording.tsx desktop/src/renderer/__tests__/retry-view.test.ts
git commit -m "feat(desktop): history FSM + idle entry point + origin-aware error retry"
```

---

### Task 10: Full verify + version bump

**Files:**
- Modify: `desktop/package.json` (version `0.1.8` → `0.1.9`)

- [ ] **Step 1: Full gate**

Run: `pnpm --filter @lisna/desktop verify`
Expected: build + ALL tests + lint green. Fix anything red before proceeding (report BLOCKED if a failure is outside this plan's files).

- [ ] **Step 2: Version bump**

In `desktop/package.json`, change `"version": "0.1.8"` → `"version": "0.1.9"` (artifact-version-bump rule: the dist that ships carries the version as build identifier; this PR is a user-facing feature).

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json
git commit -m "chore(desktop): bump version to 0.1.9 (history viewer)"
```

---

### Task 11: Controller follow-ups (NOT for the implementer subagent)

- [ ] Push branch, open PR titled `feat(desktop): recording history viewer (F2)` — body references the spec + this plan, test plan = Task 10 verify + the acceptance gates below.
- [ ] Founder/dev-machine acceptance (spec section 8 — needs real dumps + real 3B, hardware-gated):
  1. Dev app shows existing real dumps in History.
  2. Dump → transcript → family → regenerate → NoteView end-to-end.
  3. Regen failure lands in ErrorView; retry returns to History detail (not live finalize).
  4. Repeated regens leave the source dump intact (`ls <userData>/sessions` count unchanged).

---

## Self-review notes (writing-plans checklist)

- **Spec coverage**: section 2 (data source, retention untouched, env opt-out) → Tasks 1/2; section 3 items 1-3 (listDumps/loadDump/finalizeFromDump, guards, dump-skip, factored helper, in-flight) → Tasks 1/2/4/5; section 4 (entry point, History route, FamilyPickerStep reuse, origin-aware retry, submitting guard) → Tasks 7/8/9; section 5 (unreadable rows, error path) → Tasks 1/7/9; section 7 named test cases (i)-(iv) → Task 2 (context-without-current + no-dump-write), Task 4 (re-entrancy), Task 1 (id guard), Task 9 (origin retry); section 8 gates → Tasks 10/11.
- **Known intentional deviations**: none.
- **Type consistency**: `DumpSummary`/`DumpTranscript` defined once (Task 1) and imported everywhere; `SessionContext` reused from session-finalize.ts; `ErrorOrigin` defined in App.tsx and used only there.
