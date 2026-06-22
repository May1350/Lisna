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
import type { SessionTranscribeResult } from '@shared/ipc-protocol';
import type { GrammarCapableSidecar } from '../grammar-call';
import {
  finalizeLecture,
  finalizeMeeting,
  finalizeInterview,
  finalizeBrainstorm,
  type FinalizeTelemetryEvent,
} from '../orchestrator';
import { modelProfiles } from '@shared/models/profiles';
import { languageCapabilities } from '@shared/language-capabilities';

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
  | { ok: false; family: NoteFamily; error: string }
  // Raw-transcript output mode (session/transcribe, 2026-06-19): no note, no
  // family. Carries no payload — the dump's transcript.json was already
  // written, and there is no result.json for a transcript run. ipc.ts's
  // onSessionSettled narrows on `'family' in result` before any family-typed
  // dump write, and runs the same live-session clear-on-success as a note.
  | { ok: true; kind: 'transcript' }
  | { ok: false; kind: 'transcript'; error: string };

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

  /**
   * F2 history viewer — resolve a dump-sourced SessionContext (ipc.ts wires
   * buildDumpSessionContext). THROWS its guard errors (SESSION_ACTIVE /
   * INVALID_DUMP_ID / DUMP_NOT_FOUND / DUMP_UNREADABLE / MODELS_NOT_CONFIGURED
   * / SIDECAR_DOWN / UNSUPPORTED_LANGUAGE) rather than returning null — unlike
   * getCurrentSession, "no such context" is always a caller error here.
   *
   * When omitted, session/finalize-from-dump rejects with DUMP_FINALIZE_UNAVAILABLE.
   */
  getDumpSession?: (id: string) => Promise<SessionContext>;

  /**
   * Raw-transcript output mode — transcribe the whole captured WAV and return
   * the raw segments with NO note generation. Reuses the same whole-WAV
   * transcription + transcript cache + debug dump as getCurrentSession, but
   * STOPS before the LLM load. When omitted, `session/transcribe` rejects with
   * TRANSCRIBE_UNAVAILABLE.
   */
  getTranscript?: () => Promise<SessionTranscribeResult>;
}

// ─── channel constants (mirrors CHANNELS in ipc.ts) ──────────────────────────
export const SESSION_FINALIZE_CHANNEL = 'session/finalize' as const;
export const SESSION_FINALIZE_FROM_DUMP_CHANNEL = 'session/finalize-from-dump' as const;
export const SESSION_TRANSCRIBE_CHANNEL = 'session/transcribe' as const;

export interface SessionFinalizeFromDumpArgs {
  /** Dump dir name under <userData>/sessions — validated main-side. */
  id: string;
  family: NoteFamily;
  promptVariant?: string;
}

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
  // Phase-1 backstop: ko (and any non-notes language) must not generate a
  // structured note. The picker UX (renderer) already restricts ko to
  // transcript; this is the server-side guard for direct-IPC / future callers.
  if (!languageCapabilities(session.language).notes) {
    throw new Error('NOTES_NOT_SUPPORTED_FOR_LANGUAGE');
  }

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
 * Register the `session/finalize` and `session/finalize-from-dump` ipcMain
 * handlers with the given deps.
 * Call once from registerIpc() in main/ipc.ts.
 *
 * Both channels share a single `finalizeInFlight` flag (closure-scoped, fresh
 * per registration call so test re-registrations each get a clean flag).
 * Review P1-1: SESSION_ACTIVE only checked the live `current`; nothing
 * prevented two concurrent finalizes (renderer double-fire, or live-vs-dump)
 * from racing two generate streams over the single-threaded sidecar. One flag
 * covers both channels registered by this call.
 */
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  let finalizeInFlight = false;

  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<SessionFinalizeResult> => {
    const { family, promptVariant } = args;

    if (finalizeInFlight) throw new Error('FINALIZE_IN_FLIGHT');
    finalizeInFlight = true;

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
      finalizeInFlight = false;
      // Always notify — the caller (main/ipc.ts) uses `ok` to decide whether
      // to clear the orchestrator. On failure (ok=false) the orchestrator is
      // PRESERVED so the renderer's ErrorView retry can re-invoke finalize
      // against the same accumulated transcript (P0-3, 2026-06-09). The note /
      // error ride along for the per-finalize debug dump.
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
      // Same family gate as the live channel — before getDumpSession so a
      // garbage family can't trigger an LLM load.
      if (!KNOWN_FAMILIES.has(family)) throw new Error(`UNKNOWN_FAMILY:${family as string}`);
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

  // Raw-transcript output mode (2026-06-19): LLM-free whole-WAV transcription.
  // Shares the single `finalizeInFlight` flag with both finalize channels so a
  // transcribe can't race a note finalize over the single-threaded sidecar.
  ipcMain.handle(SESSION_TRANSCRIBE_CHANNEL, async (): Promise<SessionTranscribeResult> => {
    const getTranscript = deps.getTranscript;
    if (!getTranscript) throw new Error('TRANSCRIBE_UNAVAILABLE');
    if (finalizeInFlight) throw new Error('FINALIZE_IN_FLIGHT');
    finalizeInFlight = true;

    let settle: SessionSettleResult = { ok: false, kind: 'transcript', error: 'FINALIZE_NOT_RUN' };
    try {
      const r = await getTranscript();
      settle = { ok: true, kind: 'transcript' };
      return r;
    } catch (err) {
      settle = { ok: false, kind: 'transcript', error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      finalizeInFlight = false;
      // Same settle sink as note finalize: ipc.ts clears the live session on
      // success + idle-unloads the LLM (a no-op here — none was loaded) and
      // PRESERVES the session on failure. No note result.json is written.
      deps.onSessionSettled?.(settle);
    }
  });
}
