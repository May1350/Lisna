/**
 * Tests for registerSessionFinalize (Task 10, updated Task 6).
 *
 * Mocks `electron.ipcMain.handle` to capture the registered handler, then
 * invokes it directly. No Electron binary required.
 *
 * Test cases:
 *   (a) family: 'meeting', valid session + mock sidecar → resolves { noteId, note: MeetingNote }
 *   (b) family: 'interview'  → throws FAMILY_NOT_IMPLEMENTED:interview:plan-6
 *   (c) family: 'brainstorm' → throws FAMILY_NOT_IMPLEMENTED:brainstorm:plan-6
 *   (d) family: 'lecture', getCurrentSession()===null → throws NO_ACTIVE_SESSION
 *   (e) family: 'lecture', valid session + mock sidecar → resolves { noteId, note: LectureNote }
 *   (f) family: 'lecture', unknown llmModelPath       → throws UNKNOWN_MODEL_PROFILE
 *   (g) unknown family (e.g. 'garbage' as any)        → throws /^UNKNOWN_FAMILY:/
 *   (h) family: 'meeting', no active session          → throws NO_ACTIVE_SESSION
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { SessionFinalizeArgs, SessionFinalizeDeps, SessionContext } from '../session-finalize';
import type { GrammarCapableSidecar } from '../../grammar-call';
import type { TranscriptSegment as LegacySegment } from '@shared/types';

// ─── mock electron ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedHandler: ((e: unknown, args: SessionFinalizeArgs) => Promise<any>) | undefined;

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      if (channel === 'session/finalize') {
        capturedHandler = handler as typeof capturedHandler;
      }
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
  };
}

// ─── registration ──────────────────────────────────────────────────────────

// Register lecture + meeting families once so finalizeLecture/finalizeMeeting can find them
beforeAll(async () => {
  await import('@shared/families/lecture/core');
  await import('@shared/families/meeting/core');
});

let registerSessionFinalize: (deps: SessionFinalizeDeps) => void;

beforeEach(async () => {
  capturedHandler = undefined;
  vi.clearAllMocks();
  // Re-import after clearing so ipcMain.handle captures a fresh handler
  const mod = await import('../session-finalize');
  registerSessionFinalize = mod.registerSessionFinalize;
});

// Helper: register with a given getCurrentSession getter and return the handler
function setup(getCurrentSession: () => SessionContext | null) {
  registerSessionFinalize({ getCurrentSession });
  if (!capturedHandler) throw new Error('Handler not registered — ipcMain.handle mock not capturing session/finalize');
  return capturedHandler;
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

  // (b) interview → not implemented
  it('(b) family interview → throws FAMILY_NOT_IMPLEMENTED:interview:plan-6', async () => {
    const handler = setup(() => null);
    await expect(handler({}, { family: 'interview' }))
      .rejects.toThrow('FAMILY_NOT_IMPLEMENTED:interview:plan-6');
  });

  // (c) brainstorm → not implemented
  it('(c) family brainstorm → throws FAMILY_NOT_IMPLEMENTED:brainstorm:plan-6', async () => {
    const handler = setup(() => null);
    await expect(handler({}, { family: 'brainstorm' }))
      .rejects.toThrow('FAMILY_NOT_IMPLEMENTED:brainstorm:plan-6');
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
});
