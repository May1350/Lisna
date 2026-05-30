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
import type { NoteBase, NoteFamily } from '@shared/note-schema';
import type { GrammarCapableSidecar } from '../grammar-call';
import { finalizeLecture, finalizeMeeting } from '../orchestrator';
import { modelProfiles } from '@shared/models/profiles';

// Side-effect imports: register family cores so familyCoreRegistry is populated
// when route handlers call finalizeLecture / finalizeMeeting at runtime.
// Note: lecture/core has the same gap — no production caller imported it before
// this file. Both families are registered here as the natural wiring point.
import '@shared/families/lecture/core';
import '@shared/families/meeting/core';

// ─── public types ────────────────────────────────────────────────────────────

export interface SessionFinalizeArgs {
  family: NoteFamily;
  promptVariant?: string;
}

/**
 * Result of a successful session/finalize call. `note` is typed at the IPC
 * boundary as `NoteBase` (which carries the `family` discriminator); the
 * renderer narrows by family via `familyRendererRegistry[note.family]`.
 *
 * Returning the note alongside the id lets the renderer render the structured
 * note immediately without a second IPC round-trip. Persistence (real
 * `noteId` assignment) lands in Plan 3 Task 13; until then `noteId` is the
 * orchestrator's placeholder.
 */
export interface SessionFinalizeResult {
  noteId: string;
  note: NoteBase;
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
   *
   * Async because the implementation in `main/ipc.ts` performs the spec §9
   * model-load step (unload STT, load LLM) on the first invocation per
   * session. Subsequent invocations resolve immediately from the cached
   * "already loaded for this orchestrator" flag.
   */
  getCurrentSession: () => Promise<SessionContext | null>;
}

// ─── channel constant (mirrors CHANNELS in ipc.ts) ───────────────────────────
export const SESSION_FINALIZE_CHANNEL = 'session/finalize' as const;

// ─── registration ────────────────────────────────────────────────────────────

/**
 * Register the `session/finalize` ipcMain handler with the given deps.
 * Call once from registerIpc() in main/ipc.ts.
 */
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<SessionFinalizeResult> => {
    const { family, promptVariant } = args;

    // ── Family routing ────────────────────────────────────────────────────
    if (family === 'lecture') {
      return routeLecture(deps, promptVariant);
    }
    if (family === 'meeting') return routeMeeting(deps, promptVariant);
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
): Promise<SessionFinalizeResult> {
  // 1. Read live session (this awaits the spec §9 LLM-load step)
  const session = await deps.getCurrentSession();
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

  // 5. Return placeholder noteId + the structured note. We thread
  // telemetry.noteId (currently the 'live' placeholder; Task 13 assigns the
  // real persistence ID) and the orchestrator-produced LectureNote so the
  // renderer can render immediately without a second IPC round-trip.
  return { noteId: result.telemetry.noteId, note: result.note };
}

// ─── meeting route ────────────────────────────────────────────────────────────

async function routeMeeting(
  deps: SessionFinalizeDeps,
  promptVariantId: string | undefined,
): Promise<SessionFinalizeResult> {
  // 1. Read live session (this awaits the spec §9 LLM-load step)
  const session = await deps.getCurrentSession();
  if (!session) throw new Error('NO_ACTIVE_SESSION');

  // 2. Adapt legacy segments → v2 SessionTranscript.
  //    adaptToV2Transcript assigns speakerId=0 — fine for the alpha path because
  //    diarizationStatus='disabled' collapses to single-speaker anyway.
  const transcript = adaptToV2Transcript(session.segments, session.sessionId);

  // 3. Look up ModelProfile by llmModelPath filename
  const basename = path.basename(session.llmModelPath);
  const modelProfile = Object.values(modelProfiles).find(
    (p) => p.filename === basename,
  );
  if (!modelProfile) throw new Error('UNKNOWN_MODEL_PROFILE');

  // 4. Delegate to finalizeMeeting.
  //    diarizationStatus: 'disabled' — Plan 4 Phase B native diarization is not
  //    yet plumbed into SessionContext, so the alpha meeting path collapses to
  //    single-speaker and emits SINGLE_SPEAKER_WARNING into validation_warnings.
  //    When Plan 4 B lands, SessionContext gains diarized turns and this flips
  //    to 'ok'.
  const result = await finalizeMeeting({
    sessionId: session.sessionId,
    transcript,
    sidecar: session.sidecar,
    modelProfile,
    promptVariantId,
    diarizationStatus: 'disabled',
  });

  return { noteId: result.telemetry.noteId, note: result.note };
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
