// Spike 0.1 runner — drives a single grammar-constrained completion via the
// `llama-completion` binary built from desktop/sidecar/deps/llama.cpp/build-spike.
//
// Why llama-completion (not llama-cli)?
//   `llama-cli` in our pinned llama.cpp build (b1-856c3ad) is hard-wired to
//   conversation mode and prints a TUI banner even with --no-display-prompt;
//   `-no-cnv` was removed ("not supported by llama-cli — please use
//   llama-completion instead", verified live 2026-05-26). `llama-completion`
//   accepts the same flag surface (--grammar-file, -p, -n, --temp, -m, -s,
//   --no-display-prompt, --no-warmup) and is non-interactive when `-p` is
//   set AND stdin is closed. We pipe stdin from /dev/null via `ignore`.
//
// Why we strip trailing junk:
//   `llama-completion` writes the grammar-constrained generation to stdout,
//   then emits a single trailing `> EOF by user\n\n\n` line when stdin
//   closes. The JSON body is intact; we trim by slicing from the first `{`
//   to the matching closing `}` (matched via brace-depth scanner, NOT
//   `lastIndexOf('}')` — JSON values themselves contain `}` inside arrays).
//   Smoke-verified 2026-05-26: 2326-byte stdout → 2310-byte JSON → parses.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const DEFAULT_LLAMA_COMPLETION = resolve(
  REPO_ROOT,
  'desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion',
);
const DEFAULT_MODEL =
  process.env.SPIKE_LLM_MODEL_PATH ??
  '/Users/guntak/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf';

export interface RunLlamaOptions {
  prompt: string;
  grammarPath: string;
  maxTokens: number;
  temperature: number;
  seed?: number;
  modelPath?: string;
  binPath?: string;
  /**
   * When true, apply the model's embedded chat template via `--jinja`:
   * `prompt` is the USER message and `systemPrompt` the system message.
   * Mirrors the production sidecar and keeps the instruct model
   * in-distribution (emits <|eot_id|> → terminates instead of running on
   * until maxTokens truncates the JSON). When false/undefined, `prompt` is
   * sent raw via `-p` (legacy phase-0 behavior).
   */
  chatTemplate?: boolean;
  /** System message; used only when chatTemplate is true. */
  systemPrompt?: string;
}

export interface RunLlamaResult {
  /** JSON body extracted from stdout (post-strip), ready to JSON.parse. */
  text: string;
  /** Raw stdout, useful for debugging. */
  rawStdout: string;
  /** Tail of stderr (last 4 KB), useful for timing / grammar-error context. */
  stderrTail: string;
  /** Wall-clock elapsed in ms. */
  elapsedMs: number;
}

/**
 * Decode a full stdout/stderr byte stream as UTF-8 in ONE pass.
 * Concatenating raw Buffers BEFORE decoding is mandatory: calling
 * `chunk.toString('utf8')` per `data` event emits U+FFFD whenever a multi-byte
 * character straddles a chunk boundary — rampant on CJK output (seed-3000
 * chunk-0 mangled 決断 → ��断, 8× U+FFFD). See llama-cli-rig.test.ts.
 */
export function decodeStreamChunks(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Slice from the first `{` to the matching closing `}` via brace-depth scan,
 * skipping braces inside JSON strings (those preceded by an unescaped `"`).
 * Returns null if no balanced object found.
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export async function runLlamaCli(opts: RunLlamaOptions): Promise<RunLlamaResult> {
  const bin = opts.binPath ?? DEFAULT_LLAMA_COMPLETION;
  const args = [
    '-m', opts.modelPath ?? DEFAULT_MODEL,
    '--grammar-file', opts.grammarPath,
    '-n', String(opts.maxTokens),
    '--temp', String(opts.temperature),
    '--no-display-prompt',
    '--no-warmup',
  ];
  // chatTemplate: wrap via the model's embedded template (--jinja) so the
  // instruct model stays in-distribution and stops at <|eot_id|>. Verified that
  // --no-display-prompt still suppresses the templated prompt echo, so
  // extractJsonObject is not confused by `{` inside the prompt.
  if (opts.chatTemplate) {
    args.push('--jinja');
    if (opts.systemPrompt !== undefined) args.push('-sys', opts.systemPrompt);
  }
  args.push('-p', opts.prompt);
  if (opts.seed !== undefined) args.push('-s', String(opts.seed));

  const t0 = Date.now();
  return await new Promise((resolveP, rejectP) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    // Collect raw Buffers and decode ONCE at close (decodeStreamChunks).
    // Per-chunk `d.toString()` splits multi-byte UTF-8 at chunk boundaries.
    proc.stdout.on('data', (d: Buffer) => outChunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('error', (e) => rejectP(e));
    proc.on('close', (code) => {
      const elapsedMs = Date.now() - t0;
      const out = decodeStreamChunks(outChunks);
      const stderrTail = decodeStreamChunks(errChunks).slice(-4000);
      if (code !== 0) {
        rejectP(new Error(`llama-completion exit ${code}\nstderr tail:\n${stderrTail}`));
        return;
      }
      // Strip llama-completion's trailing `> EOF by user` epilogue BEFORE
      // extraction. On a truncated (unterminated-string) generation the
      // epilogue newline lands inside the still-open string and JSON.parse
      // reports a misleading "Bad control character"; stripping it surfaces the
      // honest "Unexpected end of JSON input" (truncation). rawStdout keeps the
      // full output for debugging.
      const eofIdx = out.lastIndexOf('> EOF by user');
      const body = eofIdx >= 0 ? out.slice(0, eofIdx) : out;
      const json = extractJsonObject(body);
      resolveP({
        text: json ?? body.trim(),
        rawStdout: out,
        stderrTail,
        elapsedMs,
      });
    });
  });
}
