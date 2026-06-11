/**
 * Finalize debug dump — per-finalize on-disk diagnosis artifacts (2026-06-11).
 *
 * Session artifacts were memory-only; when a founder 13-min JA lecture
 * produced a note covering only the first ~20 s, nothing existed to tell
 * whether STT delivered a thin transcript or the LLM collapsed. Now every
 * finalize (success or failure) writes under `<userData>/sessions/<ts>/`:
 * transcript.json · llm-calls.ndjson (exact prompt + raw output per call,
 * appended as each call settles so a mid-finalize crash keeps completed
 * calls) · grammar-N.gbnf (content-deduped) · result.json · note.json
 * (success only). No audio. Local-disk persistence matches the on-device
 * privacy model — log.ts's PII contract governs the shared main.log, not
 * these per-session files. Opt out: LISNA_DISABLE_SESSION_DUMP=1.
 * Retention keeps the newest N timestamp-named dirs (foreign content under
 * sessions/ survives pruning). Every write is best-effort — a dump failure
 * must never break a finalize. Electron-free (baseDir injected) so unit
 * tests run on plain tmp dirs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log';
import type { GrammarCapableSidecar } from './sidecar/grammar-call';

const DEFAULT_MAX_SESSIONS = 20;

/** `2026-06-11T03-00-00-000Z` (+ optional `-N` collision suffix). */
const DUMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

export interface SessionDumpOptions {
  /** Parent dir for dump dirs — production passes `<userData>/sessions`. */
  baseDir: string;
  /** Retention: newest N dump dirs kept (default 20). */
  maxSessions?: number;
  /** Clock injection for tests. */
  now?: () => Date;
}

export interface TranscriptDumpPayload {
  sessionId: string;
  language: string;
  /** Model file basename — full paths stay out so dumps are shareable as-is. */
  llmModel: string;
  segments: readonly { startSec: number; endSec: number; text: string; noSpeechProb?: number }[];
}

export type ResultDumpPayload =
  | { ok: true; family: string; note: unknown }
  | { ok: false; family: string; error: string };

export interface SessionDump {
  readonly dir: string;
  writeTranscript(payload: TranscriptDumpPayload): void;
  /** Wrap the finalize sidecar so every LLM call lands in llm-calls.ndjson. */
  wrapSidecar(inner: GrammarCapableSidecar): GrammarCapableSidecar;
  writeResult(result: ResultDumpPayload): void;
}

/**
 * Create the dump dir for one finalize invocation and prune old dumps.
 * Returns null when disabled via env or when the dir cannot be created —
 * callers treat null as "no dump" and proceed.
 */
export function createSessionDump(opts: SessionDumpOptions): SessionDump | null {
  if (process.env.LISNA_DISABLE_SESSION_DUMP === '1') return null;
  try {
    const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
    let dir = path.join(opts.baseDir, stamp);
    for (let n = 2; fs.existsSync(dir); n++) {
      dir = path.join(opts.baseDir, `${stamp}-${n}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    pruneOldDumps(opts.baseDir, opts.maxSessions ?? DEFAULT_MAX_SESSIONS);
    return new SessionDumpImpl(dir);
  } catch (err) {
    log.warn('[dump] disabled — could not create dump dir', err);
    return null;
  }
}

/** Delete the oldest timestamp-named dirs so at most `keep` remain. */
function pruneOldDumps(baseDir: string, keep: number): void {
  const dumps = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DUMP_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();  // timestamp names sort chronologically
  for (const name of dumps.slice(0, Math.max(0, dumps.length - keep))) {
    fs.rmSync(path.join(baseDir, name), { recursive: true, force: true });
  }
}

class SessionDumpImpl implements SessionDump {
  private callIndex = 0;
  private grammarFiles = new Map<string, string>();
  private warned = false;

  constructor(readonly dir: string) {}

  writeTranscript(payload: TranscriptDumpPayload): void {
    this.writeJson('transcript.json', {
      sessionId: payload.sessionId,
      language: payload.language,
      llmModel: payload.llmModel,
      segmentCount: payload.segments.length,
      durationSec: payload.segments.at(-1)?.endSec ?? 0,
      segments: payload.segments,
    });
  }

  wrapSidecar(inner: GrammarCapableSidecar): GrammarCapableSidecar {
    return {
      generateWithGrammar: async (req) => {
        const index = this.callIndex++;
        const grammarFile = this.grammarFileFor(req.grammar);
        const base = {
          index,
          at: new Date().toISOString(),
          seed: req.seed,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          promptChars: (req.system?.length ?? 0) + req.prompt.length,
          grammarFile,
          system: req.system,
          prompt: req.prompt,
        };
        const t0 = Date.now();
        try {
          const r = await inner.generateWithGrammar(req);
          this.appendCall({
            ...base,
            ok: true,
            latencyMs: Date.now() - t0,
            rawText: r.text,
            tokensOut: r.stats?.tokensOut,
            genMs: r.stats?.genMs,
          });
          return r;
        } catch (err) {
          this.appendCall({
            ...base,
            ok: false,
            latencyMs: Date.now() - t0,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
    };
  }

  writeResult(result: ResultDumpPayload): void {
    if (result.ok) this.writeJson('note.json', result.note);
    this.writeJson('result.json', {
      ok: result.ok,
      family: result.family,
      ...(result.ok ? {} : { error: result.error }),
      finishedAt: new Date().toISOString(),
    });
  }

  /** Write each distinct grammar once; return its filename for the call line. */
  private grammarFileFor(grammar: string): string {
    const existing = this.grammarFiles.get(grammar);
    if (existing) return existing;
    const name = `grammar-${this.grammarFiles.size}.gbnf`;
    this.grammarFiles.set(grammar, name);
    this.tryWrite(name, () => grammar);
    return name;
  }

  private writeJson(name: string, value: unknown): void {
    this.tryWrite(name, () => JSON.stringify(value, null, 2));
  }

  private appendCall(line: Record<string, unknown>): void {
    try {
      fs.appendFileSync(path.join(this.dir, 'llm-calls.ndjson'), `${JSON.stringify(line)}\n`);
    } catch (err) {
      this.warnOnce(err);
    }
  }

  private tryWrite(name: string, content: () => string): void {
    try {
      fs.writeFileSync(path.join(this.dir, name), content());
    } catch (err) {
      this.warnOnce(err);
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    log.warn('[dump] write failed — finalize continues undumped', err);
  }
}
