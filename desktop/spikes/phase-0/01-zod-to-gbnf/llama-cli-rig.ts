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
    '-p', opts.prompt,
    '--no-display-prompt',
    '--no-warmup',
  ];
  if (opts.seed !== undefined) args.push('-s', String(opts.seed));

  const t0 = Date.now();
  return await new Promise((resolveP, rejectP) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => rejectP(e));
    proc.on('close', (code) => {
      const elapsedMs = Date.now() - t0;
      const stderrTail = err.slice(-4000);
      if (code !== 0) {
        rejectP(new Error(`llama-completion exit ${code}\nstderr tail:\n${stderrTail}`));
        return;
      }
      const json = extractJsonObject(out);
      resolveP({
        text: json ?? out.trim(),
        rawStdout: out,
        stderrTail,
        elapsedMs,
      });
    });
  });
}
