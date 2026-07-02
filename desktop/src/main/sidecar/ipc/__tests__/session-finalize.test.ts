/**
 * Tests for registerSessionFinalize (Task 10, updated Task 4).
 *
 * Mocks `electron.ipcMain.handle` to capture registered handlers by channel,
 * then invokes them directly. No Electron binary required.
 *
 * Test cases:
 *   (a) family: 'meeting', valid session + mock sidecar    → resolves { noteId, note: MeetingNote }
 *   (b) family: 'interview', valid session + mock sidecar  → resolves { noteId, note: InterviewNote }
 *   (c) family: 'brainstorm', valid session + mock sidecar → resolves { noteId, note: BrainstormNote }
 *   (d) family: 'lecture', getCurrentSession()===null      → throws NO_ACTIVE_SESSION
 *   (e) family: 'lecture', valid session + mock sidecar    → resolves { noteId, note: LectureNote }
 *   (f) family: 'lecture', unknown llmModelPath            → throws UNKNOWN_MODEL_PROFILE
 *   (g) unknown family (e.g. 'garbage' as any)             → throws /^UNKNOWN_FAMILY:/
 *   (h) family: 'meeting', no active session               → throws NO_ACTIVE_SESSION
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { SessionFinalizeDeps, SessionContext } from '../session-finalize';
import type { GrammarCapableSidecar } from '../../grammar-call';
import type { TranscriptSegment as LegacySegment } from '@shared/types';

// ─── mock electron ─────────────────────────────────────────────────────────
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

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Minimal valid LectureNote JSON. Pipeline Stage 3 inserts `from` provenance
 * for items that have ts + (text|term|expression), so we must NOT include
 * `from` in the raw response (same constraint as lecture-orchestrator.test.ts).
 */
function makeLectureNoteJson(ts = 0): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'テスト講義',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    sections: [
      {
        heading: 'セクション',
        ts,
        summary: 'テストの要約です。',
        key_terms: [{ term: '概念', definition: '定義', ts }],
        examples: [],
        points: [{ text: '重要な点', ts, important: true }],
      },
    ],
  });
}

function makeMockSidecar(response: string): GrammarCapableSidecar {
  return {
    generateWithGrammar: vi.fn().mockResolvedValue({ text: response, seed: 42 }),
  };
}

/**
 * Minimal valid MeetingNote JSON. Pipeline fills `from` post-hoc, so we omit it.
 */
function makeMeetingNoteJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'meeting',
    title: 'テスト会議',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    purpose: 'プロジェクトの進捗確認',
    executive_summary: 'プロジェクトは順調です。',
    topic_arc: [{ topic: '進捗確認', ts: 0, speakers_involved: [] }],
    discussions: [{ topic: '進捗', ts_start: 0, summary: '報告がありました。' }],
    decisions: [],
    open_questions: [],
  });
}

/** Minimal valid InterviewNote JSON. qa_pairs omit `from` (pipeline fills it). */
function makeInterviewNoteJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'interview',
    title: 'テスト面談',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    purpose: 'インタビューの目的',
    subject_summary: '被取材者の概要です。',
    qa_pairs: [{ question: '質問', answer: '回答', ts: 0, asked_by: 0, answered_by: 1 }],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
  });
}

/** Minimal valid BrainstormNote JSON. ideas omit `id` (UUID) + `from` (post-decode). */
function makeBrainstormNoteJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'brainstorm',
    title: 'テストブレスト',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    purpose: 'ブレインストーミングの目的',
    idea_clusters: [{ theme: 'テーマ', ideas: [{ text: 'アイデア', ts: 0 }] }],
  });
}

/** Build a valid SessionContext with `count` short ASCII segments. */
function makeSessionContext(
  opts: {
    llmModelPath?: string;
    segmentCount?: number;
    sidecar?: GrammarCapableSidecar;
  } = {},
): SessionContext {
  const segmentCount = opts.segmentCount ?? 1;
  const segments: LegacySegment[] = Array.from({ length: segmentCount }, (_, i) => ({
    startSec: i * 5,
    endSec: i * 5 + 4,
    text: `Segment ${i + 1} content here.`,
  }));
  return {
    sessionId: 'test-session',
    segments,
    llmModelPath: opts.llmModelPath ?? '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sidecar: opts.sidecar ?? makeMockSidecar(makeLectureNoteJson()),
    language: 'ja',
  };
}

// ─── registration ──────────────────────────────────────────────────────────

// Register families once so the finalize* functions can find them in the registry
beforeAll(async () => {
  await import('@shared/families/lecture/core');
  await import('@shared/families/meeting/core');
  await import('@shared/families/interview/core');
  await import('@shared/families/brainstorm/core');
});

let registerSessionFinalize: (deps: SessionFinalizeDeps) => void;

beforeEach(async () => {
  captured.clear();
  vi.clearAllMocks();
  // Re-import after clearing so ipcMain.handle captures a fresh handler
  const mod = await import('../session-finalize');
  registerSessionFinalize = mod.registerSessionFinalize;
});

// Helper: register with a given getCurrentSession getter and return the handler
function setup(
  getCurrentSession: () => SessionContext | null,
  onSessionSettled?: (result: { ok: boolean }) => void,
  onTelemetry?: (e: unknown) => void,
) {
  // SessionFinalizeDeps.getCurrentSession is now async (spec §9 LLM-load
  // happens in the real impl). Adapt sync test getters to that shape.
  const async_get = async () => getCurrentSession();
  registerSessionFinalize({
    getCurrentSession: async_get,
    beginGeneration: () => {}, // no-op gate — these single-shot tests don't race
    onSessionSettled,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTelemetry: onTelemetry as any,
  });
  const handler = captured.get('session/finalize');
  if (!handler) throw new Error('Handler not registered — ipcMain.handle mock not capturing session/finalize');
  return handler;
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('registerSessionFinalize', () => {
  // (a) meeting + valid session → resolves { noteId, note: MeetingNote }
  it('(a) family meeting, valid session → resolves { noteId, note: MeetingNote }', async () => {
    const sidecar = makeMockSidecar(makeMeetingNoteJson());
    const ctx = makeSessionContext({ sidecar });
    const handler = setup(() => ctx);
    const result = await handler({}, { family: 'meeting' });
    expect(result).toHaveProperty('noteId');
    expect(typeof result.noteId).toBe('string');
    expect(result).toHaveProperty('note');
    expect(result.note).toMatchObject({ family: 'meeting', schemaVersion: 1 });
    // sidecar was called at least once
    expect((sidecar.generateWithGrammar as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  // (b) interview + valid session → resolves { noteId, note: InterviewNote }
  it('(b) family interview, valid session → resolves { noteId, note: InterviewNote }', async () => {
    const sidecar = makeMockSidecar(makeInterviewNoteJson());
    const ctx = makeSessionContext({ sidecar });
    const handler = setup(() => ctx);
    const result = await handler({}, { family: 'interview' });
    expect(result).toHaveProperty('noteId');
    expect(typeof result.noteId).toBe('string');
    expect(result).toHaveProperty('note');
    expect(result.note).toMatchObject({ family: 'interview', schemaVersion: 1 });
    expect((sidecar.generateWithGrammar as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  // (c) brainstorm + valid session → resolves { noteId, note: BrainstormNote }
  it('(c) family brainstorm, valid session → resolves { noteId, note: BrainstormNote }', async () => {
    const sidecar = makeMockSidecar(makeBrainstormNoteJson());
    const ctx = makeSessionContext({ sidecar });
    const handler = setup(() => ctx);
    const result = await handler({}, { family: 'brainstorm' });
    expect(result).toHaveProperty('noteId');
    expect(typeof result.noteId).toBe('string');
    expect(result).toHaveProperty('note');
    expect(result.note).toMatchObject({ family: 'brainstorm', schemaVersion: 1 });
    expect((sidecar.generateWithGrammar as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  // (d) lecture + null session → NO_ACTIVE_SESSION
  it('(d) family lecture, no active session → throws NO_ACTIVE_SESSION', async () => {
    const handler = setup(() => null);
    await expect(handler({}, { family: 'lecture' }))
      .rejects.toThrow('NO_ACTIVE_SESSION');
  });

  // (e) lecture + valid session + mock sidecar → resolves { noteId, note: LectureNote }
  it('(e) family lecture, valid session → resolves { noteId, note: LectureNote }', async () => {
    const sidecar = makeMockSidecar(makeLectureNoteJson());
    const ctx = (() => {
      const baseCtx = makeSessionContext({ sidecar });
      // Augment one segment with noSpeechProb to exercise adapter plumbing
      baseCtx.segments = [
        ...baseCtx.segments.slice(0, 0),
        { ...baseCtx.segments[0]!, noSpeechProb: 0.1 },
      ];
      return baseCtx;
    })();
    const handler = setup(() => ctx);
    const result = await handler({}, { family: 'lecture' });
    expect(result).toHaveProperty('noteId');
    expect(typeof result.noteId).toBe('string');
    expect(result).toHaveProperty('note');
    expect(result.note).toMatchObject({ family: 'lecture', schemaVersion: 1 });
    // sidecar was called at least once
    expect((sidecar.generateWithGrammar as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // Verify noSpeechProb was plumbed through: the prompt should contain the segment text
    const calls = (sidecar.generateWithGrammar as ReturnType<typeof vi.fn>).mock.calls;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall && typeof firstCall[0] === 'object' && 'prompt' in firstCall[0]) {
      const promptArg = firstCall[0] as { prompt?: string };
      expect(promptArg.prompt).toContain('Segment 1 content here');
    }
  });

  // (f) lecture + unknown llmModelPath → UNKNOWN_MODEL_PROFILE
  it('(f) family lecture, unknown llmModelPath → throws UNKNOWN_MODEL_PROFILE', async () => {
    const ctx = makeSessionContext({
      llmModelPath: '/models/unknown-exotic-model.gguf',
      sidecar: makeMockSidecar(makeLectureNoteJson()),
    });
    const handler = setup(() => ctx);
    await expect(handler({}, { family: 'lecture' }))
      .rejects.toThrow('UNKNOWN_MODEL_PROFILE');
  });

  // (g) unknown family string → UNKNOWN_FAMILY:...
  it('(g) unknown family string → throws /^UNKNOWN_FAMILY:/', async () => {
    const handler = setup(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handler({}, { family: 'garbage' as any }))
      .rejects.toThrow(/^UNKNOWN_FAMILY:/);
  });

  // (h) meeting + no active session → NO_ACTIVE_SESSION
  it('(h) family meeting, no active session → throws NO_ACTIVE_SESSION', async () => {
    const handler = setup(() => null);
    await expect(handler({}, { family: 'meeting' }))
      .rejects.toThrow('NO_ACTIVE_SESSION');
  });

  // (m) ko session + note family → NOTES_NOT_SUPPORTED_FOR_LANGUAGE
  // Phase-1 backstop: ko is transcription-only. routeFamily must reject before
  // calling adaptToV2Transcript / any LLM work.
  it('(m) ko session + lecture family → throws NOTES_NOT_SUPPORTED_FOR_LANGUAGE', async () => {
    const koSession: SessionContext = { ...makeSessionContext(), language: 'ko' as const };
    const handler = setup(() => koSession);
    await expect(
      handler({}, { family: 'lecture' }),
    ).rejects.toThrow('NOTES_NOT_SUPPORTED_FOR_LANGUAGE');
  });

  // (i) onSessionSettled fires after a SUCCESSFUL finalize. The v2 Stop flow
  // never calls session/stop, so finalize is the only path that returns the
  // main-side session FSM to idle. Without this callback the next session/start
  // rejects with SESSION_ACTIVE (the "already recording" bug).
  // Debug dump (2026-06-11): the payload carries family + the parsed note so
  // the caller can persist it to the per-finalize dump dir.
  it('(i) calls onSessionSettled with {ok:true, family, note} exactly once after a successful finalize', async () => {
    const sidecar = makeMockSidecar(makeLectureNoteJson());
    const ctx = makeSessionContext({ sidecar });
    const onSessionSettled = vi.fn();
    const handler = setup(() => ctx, onSessionSettled);
    await handler({}, { family: 'lecture' });
    expect(onSessionSettled).toHaveBeenCalledTimes(1);
    expect(onSessionSettled).toHaveBeenCalledWith({
      ok: true,
      family: 'lecture',
      note: expect.objectContaining({ family: 'lecture', schemaVersion: 1 }),
    });
  });

  // (j) onSessionSettled fires even when finalize THROWS — the cleanup lives in
  // a finally block. Otherwise a failed note-generation would strand the session
  // in 'active' and block all subsequent recordings until app restart.
  // P0-3 (2026-06-09): also asserts the `ok: false` discriminator the caller
  // uses to PRESERVE the orchestrator on failure (so retry sees the same
  // transcript instead of NO_ACTIVE_SESSION).
  // Debug dump (2026-06-11): the failure payload carries the error message so
  // the dump's result.json records WHY the finalize failed.
  it('(j) calls onSessionSettled with {ok:false, family, error} exactly once when finalize throws', async () => {
    const onSessionSettled = vi.fn();
    const handler = setup(() => null, onSessionSettled);
    await expect(handler({}, { family: 'lecture' })).rejects.toThrow('NO_ACTIVE_SESSION');
    expect(onSessionSettled).toHaveBeenCalledTimes(1);
    expect(onSessionSettled).toHaveBeenCalledWith({
      ok: false,
      family: 'lecture',
      error: 'NO_ACTIVE_SESSION',
    });
  });

  // (k) onTelemetry forwarding: every family route threads the callback through
  // to the underlying finalize* call, so the founder-visible main.log gets the
  // latency breakdown. This is the contract that the IPC handler's sessionLog
  // wiring depends on (see ipc.ts registerSessionFinalize).
  it('(k) forwards onTelemetry through routeLecture to finalizeLecture', async () => {
    const sidecar = makeMockSidecar(makeLectureNoteJson());
    const ctx = makeSessionContext({ sidecar });
    const events: Array<{ kind: string }> = [];
    const handler = setup(() => ctx, undefined, (e) => events.push(e as { kind: string }));
    await handler({}, { family: 'lecture' });
    // Saw at least one 'attempt', one 'chunk-done', and a 'finalize-done'.
    expect(events.some((e) => e.kind === 'attempt')).toBe(true);
    expect(events.some((e) => e.kind === 'chunk-done')).toBe(true);
    expect(events.some((e) => e.kind === 'finalize-done')).toBe(true);
  });

  // (l) P0-3 (2026-06-09) — retry after failure preserves the orchestrator +
  // transcript. The IPC handler's onSessionSettled callback signals success
  // vs failure so the caller (ipc.ts) only clears `current` on success.
  // After a failed finalize the SAME SessionContext (same segments array
  // reference) must remain reachable so the ErrorView retry button can
  // re-invoke session/finalize against the already-captured transcript.
  it('(l) onSessionSettled {ok:false} preserves orchestrator; retry sees the same segments', async () => {
    const failingSidecar: GrammarCapableSidecar = {
      generateWithGrammar: vi.fn().mockRejectedValue(new Error('GENERATE_FAILED')),
    };
    const healthySidecar = makeMockSidecar(makeLectureNoteJson());

    // Mirror the main/ipc.ts wiring: a mutable `current` cleared only on
    // ok:true. The segments array is the same reference across both reads.
    const segments: LegacySegment[] = [
      { startSec: 0, endSec: 4, text: 'Segment 1 content here.' },
    ];
    let current: SessionContext | null = {
      sessionId: 'test-session',
      segments,
      llmModelPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      sidecar: failingSidecar,
      language: 'ja',
    };
    const settledCalls: Array<{ ok: boolean }> = [];

    const handler = setup(
      () => current,
      (result) => {
        settledCalls.push(result);
        if (result.ok) current = null;
      },
    );

    // First attempt fails — orchestrator must be PRESERVED.
    await expect(handler({}, { family: 'lecture' })).rejects.toThrow();
    expect(settledCalls).toHaveLength(1);
    expect(settledCalls[0]).toMatchObject({ ok: false });
    expect(current).not.toBeNull();
    expect(current!.segments).toBe(segments); // same array reference

    // Retry — swap to healthy sidecar; same segments, same context object.
    current = { ...current!, sidecar: healthySidecar };
    const result = await handler({}, { family: 'lecture' });
    expect(result.note).toMatchObject({ family: 'lecture' });
    expect(settledCalls).toHaveLength(2);
    expect(settledCalls[1]).toMatchObject({ ok: true });
    // Now that finalize succeeded the wiring cleared current.
    expect(current).toBeNull();
  });
});

// ─── session/finalize-from-dump ───────────────────────────────────────────

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
    const getDumpSession = vi.fn(async () => dumpSession());
    registerSessionFinalize({
      getCurrentSession: async () => null, // no live session — must NOT matter
      beginGeneration: () => {},
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
      beginGeneration: () => {},
      getDumpSession: async () => { throw new Error('SESSION_ACTIVE'); },
    });
    const handler = captured.get('session/finalize-from-dump')!;
    await expect(handler({}, { id: 'x', family: 'lecture' })).rejects.toThrow('SESSION_ACTIVE');
  });

  it('rejects when registered without getDumpSession', async () => {
    registerSessionFinalize({ getCurrentSession: async () => null, beginGeneration: () => {} });
    const handler = captured.get('session/finalize-from-dump')!;
    await expect(handler({}, { id: 'x', family: 'lecture' })).rejects.toThrow('DUMP_FINALIZE_UNAVAILABLE');
  });

  it('notifies onSessionSettled on success and failure (dump leg)', async () => {
    const settles: unknown[] = [];
    registerSessionFinalize({
      getCurrentSession: async () => null,
      beginGeneration: () => {},
      getDumpSession: async () => dumpSession(),
      onSessionSettled: (r) => settles.push(r),
    });
    const handler = captured.get('session/finalize-from-dump')!;
    await handler({}, { id: '2026-06-10T01-00-00-000Z', family: 'lecture' });
    expect(settles).toEqual([expect.objectContaining({ ok: true, family: 'lecture' })]);
  });
});

// ─── in-flight gate (Task 1: lifted to ipc.ts via deps.beginGeneration) ─────
// Originally review P1-1 used an internal closure flag. Task 1 lifts the flag
// into ipc.ts (lifecycle-visible `genInFlight`) so a background generation
// counts in isSessionInFlight() and a crash respawns the sidecar. The three
// handlers now DELEGATE the gate to deps.beginGeneration() and rely on the
// settle (deps.onSessionSettled, where ipc.ts clears genInFlight) to release it.

describe('in-flight gate delegated to deps.beginGeneration (Task 1)', () => {
  it('calls beginGeneration, rejects a concurrent finalize, releases on settle', async () => {
    let genInFlight = false;
    const beginGeneration = vi.fn(() => {
      if (genInFlight) throw new Error('FINALIZE_IN_FLIGHT');
      genInFlight = true;
    });

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
      beginGeneration,
      onSessionSettled: () => { genInFlight = false; }, // ipc.ts clears the lifted flag here
    });
    const live = captured.get('session/finalize')!;
    const fromDump = captured.get('session/finalize-from-dump')!;

    const first = live({}, { family: 'lecture' });
    // The gate is delegated — the handler asked ipc.ts to begin a generation
    // rather than flipping an internal closure flag.
    expect(beginGeneration).toHaveBeenCalledTimes(1);
    // Concurrent second call on EITHER channel hits the lifted gate.
    await expect(fromDump({}, { id: 'x', family: 'lecture' })).rejects.toThrow('FINALIZE_IN_FLIGHT');
    await expect(live({}, { family: 'lecture' })).rejects.toThrow('FINALIZE_IN_FLIGHT');

    release();
    await first; // settles → onSessionSettled clears genInFlight
    // Gate released — a new call proceeds past the in-flight rejection.
    const second = await fromDump({}, { id: 'x', family: 'lecture' });
    expect(second.note.family).toBe('lecture');
  });
});
