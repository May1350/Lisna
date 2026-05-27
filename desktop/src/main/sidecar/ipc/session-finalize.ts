/**
 * session/finalize IPC handler — Task 10 (Plan 3).
 *
 * Registers the `session/finalize` channel on ipcMain. Routes by `family`:
 *   - 'lecture'    → delegates to finalizeLecture from orchestrator.ts
 *   - other known  → throws FAMILY_NOT_IMPLEMENTED:<family>:<future-plan>
 *   - unknown      → throws UNKNOWN_FAMILY:<family>
 *
 * No session/stop is modified. This is an additive new channel.
 * The renderer migration (calling this instead of session/stop for v2 flows)
 * is Tasks 11-12 in the app-design worktree.
 */
import path from 'node:path';
import { ipcMain } from 'electron';
import type { TranscriptSegment as LegacySegment } from '@shared/types';
import type { SessionTranscript, TranscriptSegment as V2Segment } from '@shared/note-schema/transcript';
import type { GrammarCapableSidecar } from '../grammar-call';
import { finalizeLecture } from '../orchestrator';
import { modelProfiles } from '@shared/models/profiles';

// ─── public types ────────────────────────────────────────────────────────────

export interface SessionFinalizeArgs {
  family: 'lecture' | 'meeting' | 'interview' | 'brainstorm';
  promptVariant?: string;
}

/**
 * Snapshot of live session data required to drive finalizeLecture.
 * Sourced from the running SessionOrchestrator via exposedSegments getter.
 */
export interface SessionContext {
  sessionId: string;
  segments: readonly LegacySegment[];
  llmModelPath: string;
  sidecar: GrammarCapableSidecar;
}

export interface SessionFinalizeDeps {
  /**
   * Returns the current session context or null if no session is active.
   * Called once per IPC invocation — NOT captured at registration time.
   */
  getCurrentSession: () => SessionContext | null;
}

// ─── channel constant (mirrors CHANNELS in ipc.ts) ───────────────────────────
export const SESSION_FINALIZE_CHANNEL = 'session/finalize' as const;

// ─── registration ────────────────────────────────────────────────────────────

/**
 * Register the `session/finalize` ipcMain handler with the given deps.
 * Call once from registerIpc() in main/ipc.ts.
 */
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<{ noteId: string }> => {
    const { family, promptVariant } = args;

    // ── Family routing ────────────────────────────────────────────────────
    if (family === 'lecture') {
      return routeLecture(deps, promptVariant);
    }
    if (family === 'meeting') throw new Error('FAMILY_NOT_IMPLEMENTED:meeting:plan-5');
    if (family === 'interview') throw new Error('FAMILY_NOT_IMPLEMENTED:interview:plan-6');
    if (family === 'brainstorm') throw new Error('FAMILY_NOT_IMPLEMENTED:brainstorm:plan-6');

    // TypeScript exhaustiveness guard — 'family' is typed but callers can
    // send anything over IPC (un-typed JSON), so the runtime check matters.
    throw new Error(`UNKNOWN_FAMILY:${family as string}`);
  });
}

// ─── lecture route ────────────────────────────────────────────────────────────

async function routeLecture(
  deps: SessionFinalizeDeps,
  promptVariantId: string | undefined,
): Promise<{ noteId: string }> {
  // 1. Read live session
  const session = deps.getCurrentSession();
  if (!session) throw new Error('NO_ACTIVE_SESSION');

  // 2. Adapt legacy segments → v2 SessionTranscript
  //    Lecture is single-speaker (requiresDiarization: false) → speakerId = 0
  const transcript = adaptToV2Transcript(session.segments, session.sessionId);

  // 3. Look up ModelProfile by llmModelPath filename
  const basename = path.basename(session.llmModelPath);
  const modelProfile = Object.values(modelProfiles).find(
    (p) => p.filename === basename,
  );
  if (!modelProfile) throw new Error('UNKNOWN_MODEL_PROFILE');

  // 4. Delegate to finalizeLecture
  const result = await finalizeLecture({
    sessionId: session.sessionId,
    transcript,
    sidecar: session.sidecar,
    modelProfile,
    promptVariantId,
  });

  // 5. Return placeholder noteId (real ID assignment lands in Task 13 / persistence)
  return { noteId: result.note.title };
}

// ─── adapter ──────────────────────────────────────────────────────────────────

/**
 * Convert legacy TranscriptSegment[] (startSec/endSec/text/noSpeechProb?)
 * into a v2 SessionTranscript (ts/endTs/text/speakerId/meta?).
 *
 * Lecture is single-speaker → all segments get speakerId=0.
 */
function adaptToV2Transcript(
  legacySegs: readonly LegacySegment[],
  sessionId: string,
): SessionTranscript {
  const v2Segs: V2Segment[] = legacySegs.map((s) => ({
    ts: s.startSec,
    endTs: s.endSec,
    text: s.text,
    speakerId: 0,
    meta: typeof s.noSpeechProb === 'number' ? { noSpeechProb: s.noSpeechProb } : undefined,
  }));
  return {
    sessionId,
    speakers: [{ id: 0 }],
    transcriptSegments: v2Segs,
  };
}
