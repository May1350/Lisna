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
// Type-only — no runtime coupling to the connector (which pulls in the Anthropic
// SDK + keytar). The real generateCloudNote is INJECTED via SessionFinalizeDeps
// and wired in main/ipc.ts; these types just shape that dep + its events.
import type {
  CloudGenerateArgs,
  CloudNoteDeps,
  CloudNoteEvent,
  CloudNoteTelemetry,
} from '../../connector/claude-notes';
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
  /**
   * Which pipeline generates the note (Task 6). Absent or `'ondevice'` = the
   * on-device sidecar path (byte-identical to legacy behavior — every existing
   * caller keeps working unchanged). `'claude'` = the user's own Claude
   * subscription: STT still runs, but no local LLM loads; the transcript is sent
   * to `generateCloudNote`.
   */
  target?: 'ondevice' | 'claude';
}

/**
 * Transcript-only session context for the cloud (Claude) finalize branch: STT
 * ran (dump dir created, transcript.json written) but NO local LLM was loaded.
 * Distinct from SessionContext, which carries the sidecar + llmModelPath the
 * on-device family finalizers need — the cloud path needs neither.
 */
export interface TranscriptOnlyContext {
  sessionId: string;
  segments: readonly LegacySegment[];
  language: NoteLanguage;
  /** Source dump dir id, when one backs this generation (live path sets it from
   *  the created dump; from-dump sets it to the input id). */
  dumpId?: string;
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
  /** Source dump dir id (title.json is keyed by it) so the renderer's NoteView
   *  can offer inline title editing at note-creation time. Undefined when no
   *  dump dir backed the generation (e.g. dump creation failed). */
  dumpId?: string;
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
  /** Source dump dir id, when one backs this generation. Live path
   * (runGenerationContext) sets it from `_activeDump.dir`; the from-dump leg
   * (buildDumpSessionContext) sets it to the input id. Passed through to
   * SessionFinalizeResult so NoteView can edit title.json by this id. */
  dumpId?: string;
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
   * Mark a generation as in flight, or throw FINALIZE_IN_FLIGHT if one already
   * is. The flag lives in ipc.ts lifecycle state (`genInFlight`) — lifted out of
   * this module (Task 1) so a background generation counts in isSessionInFlight()
   * and a sidecar crash respawns. Cleared by ipc.ts inside `onSessionSettled`.
   * All three handlers (finalize / finalize-from-dump / transcribe) call it so
   * no two generations race the single-threaded sidecar.
   */
  beginGeneration: () => void;

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

  /**
   * Quick-transcript slice (Phase 2, spec §4.3): transcribe a [startSec,endSec)
   * span of the LIVE recording's WAV WITHOUT stopping it — a background
   * generation that shares the beginGeneration gate and does NOT free the
   * capture lane. When omitted, session/transcribe-span rejects with
   * TRANSCRIBE_SPAN_UNAVAILABLE.
   */
  getTranscriptSpan?: (args: TranscribeSpanArgs) => Promise<SessionTranscribeResult>;

  // ── Cloud (Claude connector) target — Task 6 ─────────────────────────────

  /**
   * Anthropic key presence check for the cloud target. Called BEFORE the
   * in-flight gate and BEFORE any STT work — a `null` result throws
   * CONNECTOR_NO_KEY so a keyless cloud finalize never transcribes. Wired to
   * `main/connector/claude-auth`'s `loadApiKey`. Omitted ⇒ treated as no key.
   */
  loadApiKey?: () => Promise<string | null>;

  /**
   * Cloud LIVE path: whole-WAV STT context WITHOUT an LLM load (steps A–D of
   * ipc.ts's generation lane — dump dir, transcribe, EMPTY_RECORDING guard,
   * transcript.json write). Returns null ⇒ NO_ACTIVE_SESSION (parity with
   * getCurrentSession). When omitted, a live cloud finalize rejects with
   * CLOUD_FINALIZE_UNAVAILABLE.
   */
  getCurrentSessionTranscriptOnly?: () => Promise<TranscriptOnlyContext | null>;

  /**
   * Cloud FROM-DUMP path: dump transcript context WITHOUT an LLM load
   * (buildDumpTranscriptContext). Creates no dump (P0-1). When omitted, a
   * from-dump cloud finalize rejects with DUMP_FINALIZE_UNAVAILABLE.
   */
  getDumpTranscriptOnly?: (id: string) => Promise<TranscriptOnlyContext>;

  /**
   * The cloud note generator (Task 5 `generateCloudNote`). Injected rather than
   * imported so this module stays free of the Anthropic SDK / keytar graph and
   * tests mock it directly. ipc.ts wires the real one.
   */
  generateCloudNote?: (
    args: CloudGenerateArgs,
    deps?: CloudNoteDeps,
  ) => Promise<{ note: NoteBase; telemetry: CloudNoteTelemetry }>;

  /**
   * Forward cloud progress events ({ kind: 'cloud-start' | 'cloud-retry' }) to
   * the renderer over the SAME session/finalize-progress channel the on-device
   * kinds use. ipc.ts wires this to `safeSend(CHANNELS.sessionFinalizeProgress)`.
   */
  emitCloudProgress?: (e: CloudNoteEvent) => void;
}

// ─── channel constants (mirrors CHANNELS in ipc.ts) ──────────────────────────
export const SESSION_FINALIZE_CHANNEL = 'session/finalize' as const;
export const SESSION_FINALIZE_FROM_DUMP_CHANNEL = 'session/finalize-from-dump' as const;
export const SESSION_TRANSCRIBE_CHANNEL = 'session/transcribe' as const;
export const SESSION_TRANSCRIBE_SPAN_CHANNEL = 'session/transcribe-span' as const;

/** Quick-transcript slice bounds (seconds, relative to the live recording). */
export interface TranscribeSpanArgs {
  startSec: number;
  endSec: number;
}

export interface SessionFinalizeFromDumpArgs {
  /** Dump dir name under <userData>/sessions — validated main-side. */
  id: string;
  family: NoteFamily;
  promptVariant?: string;
  /** See SessionFinalizeArgs.target. `'claude'` uses the skip-LLM dump context. */
  target?: 'ondevice' | 'claude';
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

  return { noteId: result.telemetry.noteId, note: result.note, dumpId: session.dumpId };
}

/**
 * Cloud (Claude) counterpart to routeFamily: adapt the transcript-only context
 * with the SAME adapter routeFamily uses and hand it to generateCloudNote. NO
 * language notes-gate here — Claude handles ko/en natively (that gate exists
 * only because the on-device 3B can't). durationSec is derived exactly as the
 * on-device family finalizers derive it (last segment endTs). cloud-start /
 * cloud-retry flow out via onEvent → emitCloudProgress.
 */
async function routeCloud(
  ctx: TranscriptOnlyContext,
  family: NoteFamily,
  generateCloudNote: NonNullable<SessionFinalizeDeps['generateCloudNote']>,
  emitCloudProgress: SessionFinalizeDeps['emitCloudProgress'],
): Promise<SessionFinalizeResult> {
  const transcript = adaptToV2Transcript(ctx.segments, ctx.sessionId);
  const durationSec = transcript.transcriptSegments.at(-1)?.endTs ?? 0;
  const { note } = await generateCloudNote(
    { family, transcript, language: ctx.language, durationSec },
    { onEvent: (e) => emitCloudProgress?.(e) },
  );
  // noteId mirrors the on-device placeholder (finalize*.telemetry.noteId =
  // sessionId); real note-id assignment is Plan 3 Task 13.
  return { noteId: ctx.sessionId, note, dumpId: ctx.dumpId };
}

/**
 * Strip a trailing `:dump=<id>` routing suffix (C-1) from an error message. The
 * suffix is appended only on the cloud LIVE failure path so the renderer can
 * route the on-device retry through session/finalize-from-dump; it is NOT part
 * of the error's diagnostic identity, so settle/result.json records the clean
 * code. Dump ids are ISO stamps with `:`→`-` (no colon), so the anchored
 * `[^:]+$` match is unambiguous. No suffix ⇒ no-op (on-device path unchanged).
 */
function stripDumpSuffix(message: string): string {
  return message.replace(/:dump=[^:]+$/, '');
}

// ─── registration ────────────────────────────────────────────────────────────

/**
 * Register the `session/finalize` and `session/finalize-from-dump` ipcMain
 * handlers with the given deps.
 * Call once from registerIpc() in main/ipc.ts.
 *
 * The single-generation gate lives in ipc.ts (`genInFlight`, via
 * deps.beginGeneration / cleared in deps.onSessionSettled) — Task 1 lifted it
 * out of a closure flag so it's lifecycle-visible (counts in isSessionInFlight,
 * survives a respawn). All three channels (finalize / finalize-from-dump /
 * transcribe) delegate to it so no two generations race the single-threaded
 * sidecar (review P1-1: SESSION_ACTIVE only checked the live `current`).
 */
export function registerSessionFinalize(deps: SessionFinalizeDeps): void {
  ipcMain.handle(SESSION_FINALIZE_CHANNEL, async (_e, args: SessionFinalizeArgs): Promise<SessionFinalizeResult> => {
    const { family, promptVariant } = args;
    const target = args.target === 'claude' ? 'claude' : 'ondevice';

    // No-key guard precedes the in-flight gate AND any STT work (contract item
    // 2): a keyless cloud finalize must never transcribe or engage the gate.
    if (target === 'claude' && (await deps.loadApiKey?.()) == null) {
      throw new Error('CONNECTOR_NO_KEY');
    }

    deps.beginGeneration(); // throws FINALIZE_IN_FLIGHT if a generation is already running

    let settle: SessionSettleResult = { ok: false, family, error: 'FINALIZE_NOT_RUN' };
    try {
      // ── Family routing ────────────────────────────────────────────────────
      // Family gate FIRST: preserves the pre-consolidation ordering where
      // UNKNOWN_FAMILY beats NO_ACTIVE_SESSION — test (g) sends 'garbage'
      // with a NULL session and expects UNKNOWN_FAMILY:.
      if (!KNOWN_FAMILIES.has(family)) throw new Error(`UNKNOWN_FAMILY:${family as string}`);
      if (target === 'claude') {
        const getCtx = deps.getCurrentSessionTranscriptOnly;
        if (!getCtx || !deps.generateCloudNote) throw new Error('CLOUD_FINALIZE_UNAVAILABLE');
        const ctx = await getCtx();
        if (!ctx) throw new Error('NO_ACTIVE_SESSION');
        let result;
        try {
          result = await routeCloud(ctx, family, deps.generateCloudNote, deps.emitCloudProgress);
        } catch (err) {
          // C-1: getCtx() already FROZE the capture lane (snapshotAndFreeCapture
          // nulls `current`), so the error chip's on-device retry via
          // getCurrentSession would hit NO_ACTIVE_SESSION — yet the transcript
          // survives in THIS attempt's dump dir (transcript.json was written in
          // getCtx step D, and onSessionSettled writes result.json{ok:false}).
          // Append the dump id with the codebase's structured-suffix convention
          // (cf. `CHUNK_FAILED:<i>` in orchestrator.ts) so the renderer can route
          // the on-device retry through session/finalize-from-dump. Only when a
          // dump backs this attempt (LISNA_DISABLE_SESSION_DUMP=1 / dump-create
          // disk failure ⇒ no id ⇒ raw error rethrown; the renderer then hides the
          // retry rather than promising a dead one). Dump ids carry no `:`, and the
          // suffix is stripped for settle/result.json (stripDumpSuffix) so on-device
          // errors stay byte-identical and the code recorded on disk stays clean.
          if (ctx.dumpId) {
            throw new Error(`${err instanceof Error ? err.message : String(err)}:dump=${ctx.dumpId}`);
          }
          throw err;
        }
        settle = { ok: true, family, note: result.note };
        return result;
      }
      const session = await deps.getCurrentSession();
      if (!session) throw new Error('NO_ACTIVE_SESSION');
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
    } catch (err) {
      // The C-1 dump-routing suffix is a renderer hint, not part of the error's
      // identity — strip it so the debug dump's result.json records the clean code
      // (no-op for the on-device path, which never carries the suffix).
      settle = { ok: false, family, error: stripDumpSuffix(err instanceof Error ? err.message : String(err)) };
      throw err;
    } finally {
      // genInFlight is cleared by ipc.ts inside onSessionSettled (Task 1).
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
    const target = args.target === 'claude' ? 'claude' : 'ondevice';

    // No-key guard precedes the gate + dump read (contract item 2), same as the
    // live channel.
    if (target === 'claude' && (await deps.loadApiKey?.()) == null) {
      throw new Error('CONNECTOR_NO_KEY');
    }

    // Per-target dep availability. The on-device check stays exactly as before
    // (byte-identical) — `getDumpSession` loads the LLM; the cloud path uses the
    // skip-LLM `getDumpTranscriptOnly`.
    const getDumpSession = deps.getDumpSession;
    const getDumpTranscriptOnly = deps.getDumpTranscriptOnly;
    if (target === 'ondevice' && !getDumpSession) throw new Error('DUMP_FINALIZE_UNAVAILABLE');
    if (target === 'claude' && (!getDumpTranscriptOnly || !deps.generateCloudNote)) {
      throw new Error('DUMP_FINALIZE_UNAVAILABLE');
    }
    deps.beginGeneration(); // throws FINALIZE_IN_FLIGHT if a generation is already running

    let settle: SessionSettleResult = { ok: false, family, error: 'FINALIZE_NOT_RUN' };
    try {
      // Same family gate as the live channel — before the dump read so a
      // garbage family can't trigger an LLM load.
      if (!KNOWN_FAMILIES.has(family)) throw new Error(`UNKNOWN_FAMILY:${family as string}`);
      if (target === 'claude') {
        const ctx = await getDumpTranscriptOnly!(id);
        const result = await routeCloud(ctx, family, deps.generateCloudNote!, deps.emitCloudProgress);
        settle = { ok: true, family, note: result.note };
        return result;
      }
      const session = await getDumpSession!(id);
      const result = await routeFamily(session, family, promptVariant, deps.onTelemetry);
      settle = { ok: true, family, note: result.note };
      return result;
    } catch (err) {
      settle = { ok: false, family, error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      // genInFlight is cleared by ipc.ts inside onSessionSettled (Task 1).
      // Shared settle sink: ipc.ts unloads the LLM + re-arms idle-stop. The
      // live-FSM mutations in there are no-ops for dump runs (`current` is
      // null — the SESSION_ACTIVE guard in getDumpSession ensures it) and
      // `_activeDump` is null (no dump created — P0-1), so reuse is safe.
      deps.onSessionSettled?.(settle);
    }
  });

  // Raw-transcript output mode (2026-06-19): LLM-free whole-WAV transcription.
  // Shares the single ipc.ts generation gate (deps.beginGeneration) with both
  // finalize channels so a transcribe can't race a note finalize over the
  // single-threaded sidecar.
  ipcMain.handle(SESSION_TRANSCRIBE_CHANNEL, async (): Promise<SessionTranscribeResult> => {
    const getTranscript = deps.getTranscript;
    if (!getTranscript) throw new Error('TRANSCRIBE_UNAVAILABLE');
    deps.beginGeneration(); // throws FINALIZE_IN_FLIGHT if a generation is already running

    let settle: SessionSettleResult = { ok: false, kind: 'transcript', error: 'FINALIZE_NOT_RUN' };
    try {
      const r = await getTranscript();
      settle = { ok: true, kind: 'transcript' };
      return r;
    } catch (err) {
      settle = { ok: false, kind: 'transcript', error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      // genInFlight is cleared by ipc.ts inside onSessionSettled (Task 1).
      // Same settle sink as note finalize: ipc.ts clears the live session on
      // success + idle-unloads the LLM (a no-op here — none was loaded) and
      // PRESERVES the session on failure. No note result.json is written.
      deps.onSessionSettled?.(settle);
    }
  });

  // Quick-transcript slice (Phase 2, spec §4.3): transcribe a span of the LIVE
  // recording WITHOUT stopping it. Same generation gate + settle sink as the
  // other channels; ipc.ts's getTranscriptSpan slices the live WAV and runs the
  // transcript generation without freeing the capture lane.
  ipcMain.handle(SESSION_TRANSCRIBE_SPAN_CHANNEL, async (_e, args: TranscribeSpanArgs): Promise<SessionTranscribeResult> => {
    const getTranscriptSpan = deps.getTranscriptSpan;
    if (!getTranscriptSpan) throw new Error('TRANSCRIBE_SPAN_UNAVAILABLE');
    deps.beginGeneration(); // throws FINALIZE_IN_FLIGHT if a generation is already running

    let settle: SessionSettleResult = { ok: false, kind: 'transcript', error: 'FINALIZE_NOT_RUN' };
    try {
      const r = await getTranscriptSpan(args);
      settle = { ok: true, kind: 'transcript' };
      return r;
    } catch (err) {
      settle = { ok: false, kind: 'transcript', error: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      // genInFlight cleared by ipc.ts onSessionSettled; the capture lane is
      // untouched (the long recording keeps running).
      deps.onSessionSettled?.(settle);
    }
  });
}
