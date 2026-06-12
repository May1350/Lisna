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
