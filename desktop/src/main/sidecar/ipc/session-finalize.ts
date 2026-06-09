/**
 * session/finalize IPC handler — Task 10 (Plan 3).
 *
 * Registers the `session/finalize` channel on ipcMain. Routes by `family`:
 *   - 'lecture' / 'meeting' / 'interview' / 'brainstorm'
 *                  → delegates to the matching finalize* in orchestrator.ts
 *   - unknown      → throws UNKNOWN_FAMILY:<family>
 *
 * No session/stop is modified. This is an additive new channel.
 * The renderer migration (calling this instead of session/stop for v2 flows)
 * is Tasks 11-12 in the app-design worktree.
 */
import path from 'node:path';
import { ipcMain } from 'electron';
import type { TranscriptSegment as LegacySegment } from '@shared/types';
import { adaptToV2Transcript } from '@shared/note-schema';
import type { NoteBase, NoteFamily } from '@shared/note-schema';
import type { GrammarCapableSidecar } from '../grammar-call';
import {
  finalizeLecture,
  finalizeMeeting,
  finalizeInterview,
  finalizeBrainstorm,
  type FinalizeTelemetryEvent,
} from '../orchestrator';
import { modelProfiles } from '@shared/models/profiles';

// Side-effect imports: register family cores so familyCoreRegistry is populated
// at app boot. All four families (lecture / meeting / interview / brainstorm)
// are routable below; registration also lets the family picker + loadNote()
// read each family's schema / picker / migrations. This is the natural wiring
// point — no production caller imported these cores before this file.
import '@shared/families/lecture/core';
import '@shared/families/meeting/core';
import '@shared/families/interview/core';
import '@shared/families/brainstorm/core';

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

  /**
   * Called once after every finalize attempt settles. `result.ok` discriminates
   * success vs failure so the caller can decide whether to clear session state.
   *
   * The v2 Stop flow ends at this channel and never calls `session/stop`, so
   * finalize is the ONLY place that returns the main-side session FSM to idle
   * on success. On failure (P0-3, 2026-06-09) the caller MUST PRESERVE the
   * SessionOrchestrator so the renderer's ErrorView retry can re-invoke
   * `session/finalize` against the same accumulated transcript — discarding
   * the orchestrator on every failed attempt is the bug this signature fixes.
   */
  onSessionSettled?: (result: { ok: boolean }) => void;

  /**
   * Optional telemetry sink — production wires this to `sessionLog.finalize*`
   * (in `main/ipc.ts`) so per-attempt latency / parse pass+fail / fresh-seed
   * trigger breadcrumbs land in `~/Library/Logs/Lisna/main.log`. Tests
   * typically omit this; when omitted the underlying finalize*'s
   * onTelemetry callback is undefined and the orchestrator emits nothing.
   *
   * Decouples session-finalize.ts from `../log` (its only dep on the main-
   * process log facility would be this one call) — same DI shape as
   * `onSessionSettled`.
   */
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
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

    let ok = false;
    try {
      // ── Family routing ────────────────────────────────────────────────────
      let result: SessionFinalizeResult;
      if (family === 'lecture') result = await routeLecture(deps, promptVariant);
      else if (family === 'meeting') result = await routeMeeting(deps, promptVariant);
      else if (family === 'interview') result = await routeInterview(deps, promptVariant);
      else if (family === 'brainstorm') result = await routeBrainstorm(deps, promptVariant);
      // TypeScript exhaustiveness guard — 'family' is typed but callers can
      // send anything over IPC (un-typed JSON), so the runtime check matters.
      else throw new Error(`UNKNOWN_FAMILY:${family as string}`);
      ok = true;
      return result;
    } finally {
      // Always notify — the caller (main/ipc.ts) uses `ok` to decide whether
      // to clear the orchestrator. On failure (ok=false) the orchestrator is
      // PRESERVED so the renderer's ErrorView retry can re-invoke finalize
      // against the same accumulated transcript (P0-3, 2026-06-09).
      deps.onSessionSettled?.({ ok });
    }
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
    onTelemetry: deps.onTelemetry,
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
    onTelemetry: deps.onTelemetry,
  });

  return { noteId: result.telemetry.noteId, note: result.note };
}

// ─── interview route ───────────────────────────────────────────────────────────

async function routeInterview(
  deps: SessionFinalizeDeps,
  promptVariantId: string | undefined,
): Promise<SessionFinalizeResult> {
  // 1. Read live session (this awaits the spec §9 LLM-load step)
  const session = await deps.getCurrentSession();
  if (!session) throw new Error('NO_ACTIVE_SESSION');

  const transcript = adaptToV2Transcript(session.segments, session.sessionId);

  const basename = path.basename(session.llmModelPath);
  const modelProfile = Object.values(modelProfiles).find((p) => p.filename === basename);
  if (!modelProfile) throw new Error('UNKNOWN_MODEL_PROFILE');

  // diarizationStatus: 'disabled' — same alpha rationale as routeMeeting: Plan 4
  // Phase B native diarization is not yet plumbed into SessionContext, so the
  // interview path collapses to single-speaker and emits SINGLE_SPEAKER_WARNING.
  const result = await finalizeInterview({
    sessionId: session.sessionId,
    transcript,
    sidecar: session.sidecar,
    modelProfile,
    promptVariantId,
    diarizationStatus: 'disabled',
    onTelemetry: deps.onTelemetry,
  });

  return { noteId: result.telemetry.noteId, note: result.note };
}

// ─── brainstorm route ──────────────────────────────────────────────────────────

async function routeBrainstorm(
  deps: SessionFinalizeDeps,
  promptVariantId: string | undefined,
): Promise<SessionFinalizeResult> {
  // 1. Read live session (this awaits the spec §9 LLM-load step)
  const session = await deps.getCurrentSession();
  if (!session) throw new Error('NO_ACTIVE_SESSION');

  const transcript = adaptToV2Transcript(session.segments, session.sessionId);

  const basename = path.basename(session.llmModelPath);
  const modelProfile = Object.values(modelProfiles).find((p) => p.filename === basename);
  if (!modelProfile) throw new Error('UNKNOWN_MODEL_PROFILE');

  // Brainstorm requiresDiarization=false → no diarizationStatus (treated single-speaker).
  const result = await finalizeBrainstorm({
    sessionId: session.sessionId,
    transcript,
    sidecar: session.sidecar,
    modelProfile,
    promptVariantId,
    onTelemetry: deps.onTelemetry,
  });

  return { noteId: result.telemetry.noteId, note: result.note };
}
