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
import type { NoteBase, NoteFamily, NoteLanguage } from '@shared/note-schema';
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
  /** Session language (minimal EN support, 2026-06-10). Drives prompt
   * output-language adaptation + the Note meta. */
  language: NoteLanguage;
}

/**
 * Settle payload for `onSessionSettled`. Beyond the `ok` discriminator the
 * caller uses for FSM cleanup, it carries the parsed note (success) or the
 * error message (failure) so the per-finalize debug dump can persist them
 * (2026-06-11 — the 13-min coverage-collapse incident was undiagnosable
 * because neither the note nor the failure reason ever hit disk).
 */
export type SessionSettleResult =
  | { ok: true; family: NoteFamily; note: NoteBase }
  | { ok: false; family: NoteFamily; error: string };

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
  onSessionSettled?: (result: SessionSettleResult) => void;

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

// ─── family routing (consolidated — was 4 near-identical route* fns) ────────

/** Runtime family gate — IPC payloads are un-typed JSON. Checked BEFORE any
 * session resolution so UNKNOWN_FAMILY precedes NO_ACTIVE_SESSION (the
 * pre-consolidation ordering; existing test case (g) sends family 'garbage'
 * with a NULL session and expects UNKNOWN_FAMILY:). */
const KNOWN_FAMILIES: ReadonlySet<string> = new Set([
  'lecture', 'meeting', 'interview', 'brainstorm',
]);

/**
 * Adapt a SessionContext (live OR dump-sourced) and dispatch to the family
 * finalizer. Lecture takes no diarizationStatus; the other three run the
 * alpha 'disabled' collapse (Plan 4 Phase B diarization is not yet plumbed
 * into SessionContext, so multi-speaker families collapse to single-speaker
 * and emit SINGLE_SPEAKER_WARNING). Brainstorm also disables diarization to
 * stop hallucinated ideas[].contributed_by / next_steps[].owner from
 * rendering phantom 提案者: 話者N tags.
 *
 * Accepts session as a parameter (rather than resolving getCurrentSession()
 * internally) so the same function can be called with a dump-sourced context
 * by the session/finalize-from-dump channel (Task 4).
 */
async function routeFamily(
  session: SessionContext,
  family: NoteFamily,
  promptVariantId: string | undefined,
  onTelemetry: SessionFinalizeDeps['onTelemetry'],
): Promise<SessionFinalizeResult> {
  // 1. Adapt legacy segments → v2 SessionTranscript
  const transcript = adaptToV2Transcript(session.segments, session.sessionId);

  // 2. Look up ModelProfile by llmModelPath filename
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

  // 3. Dispatch to the family finalizer
  let result;
  if (family === 'lecture') result = await finalizeLecture(common);
  else if (family === 'meeting') result = await finalizeMeeting({ ...common, diarizationStatus: 'disabled' });
  else if (family === 'interview') result = await finalizeInterview({ ...common, diarizationStatus: 'disabled' });
  else if (family === 'brainstorm') result = await finalizeBrainstorm({ ...common, diarizationStatus: 'disabled' });
  // Runtime exhaustiveness backstop — callers may send un-typed JSON over IPC.
  // Unreachable through the handler (KNOWN_FAMILIES gate precedes this call)
  // but load-bearing for any direct caller of routeFamily.
  else throw new Error(`UNKNOWN_FAMILY:${family as string}`);

  return { noteId: result.telemetry.noteId, note: result.note };
}

// ─── registration ────────────────────────────────────────────────────────────

/**
 * Register the `session/finalize` ipcMain handler with the given deps.
 * Call once from registerIpc() in main/ipc.ts.
 */
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<SessionFinalizeResult> => {
    const { family, promptVariant } = args;

    let settle: SessionSettleResult = { ok: false, family, error: 'FINALIZE_NOT_RUN' };
    try {
      // ── Family routing ────────────────────────────────────────────────────
      // Family gate FIRST: preserves the pre-consolidation ordering where
      // UNKNOWN_FAMILY beats NO_ACTIVE_SESSION — test (g) sends 'garbage'
      // with a NULL session and expects UNKNOWN_FAMILY:.
      if (!KNOWN_FAMILIES.has(family)) throw new Error(`UNKNOWN_FAMILY:${family as string}`);
      const session = await deps.getCurrentSession();
      if (!session) throw new Error('NO_ACTIVE_SESSION');
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
    } catch (err) {
      settle = { ok: false, family, error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      // Always notify — the caller (main/ipc.ts) uses `ok` to decide whether
      // to clear the orchestrator. On failure (ok=false) the orchestrator is
      // PRESERVED so the renderer's ErrorView retry can re-invoke finalize
      // against the same accumulated transcript (P0-3, 2026-06-09). The note /
      // error ride along for the per-finalize debug dump.
      deps.onSessionSettled?.(settle);
    }
  });
}
