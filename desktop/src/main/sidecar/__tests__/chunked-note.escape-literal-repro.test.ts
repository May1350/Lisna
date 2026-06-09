/**
 * Failing repro for the founder-smoke 2026-06-09 "literal escape sequences
 * in note" symptom. Full hypothesis + context in the memory entry
 * `v2_track2_escape_literal_phase1_2026-06-09`.
 *
 * Path under test: session/finalize → finalizeLecture → callWithGrammar
 * → grammar-constrained generate → raw text (this test spies HERE before
 * JSON.parse). The plain-text `chunked-note.ts` path used by the legacy
 * `SessionOrchestrator.stop()` has no JSON.parse, so bug class is not
 * applicable there — filename keeps the founder-smoke anchor name.
 *
 * Filename kept ("chunked-note.…") to anchor against the founder-smoke
 * memo wording; actual path tested is the grammar-JSON path above.
 *
 * Run with explicit file path (pitfalls.md vitest-scope rule):
 *   LISNA_TEST_LLM_MODEL=~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
 *     pnpm --filter @lisna/desktop vitest run \
 *     src/main/sidecar/__tests__/chunked-note.escape-literal-repro.test.ts
 *
 * Per pitfalls.md (spike-llm): env-gated, sidecar SIGTERM + pkill cleanup.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeLecture, type FinalizeLectureResult } from '../orchestrator';
import {
  findEscapeLiteralInStrings,
  makeGrammarSidecar,
  type GrammarCapableSidecar,
} from '../grammar-call';
import { SidecarClient } from '../client';
import { LlamaCppLLM } from '../../engines/llama-cpp-llm';
import { modelProfiles } from '@shared/models/profiles';
import type { SessionTranscript } from '@shared/note-schema/transcript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarBin = resolvePath(__dirname, '../../../../resources/sidecar');
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const diagnosticDir = resolvePath(__dirname, '../../../../docs');
const diagnosticPath = resolvePath(diagnosticDir, 'escape-literal-repro-raw.txt');

// Matches 2 consecutive ASCII backslashes at runtime — the JSON escape for a
// literal backslash, which has no legitimate place in JA note string content.
// Catches the founder's `\\u4eca` shape (raw text contains 2 backslashes + u
// + hex) AND this run's `\\'`/`\\n` shapes (raw text contains 4 backslashes +
// quote/letter for an inner-quoted Python-LOOKING substring).
const ESCAPE_LITERAL_RE = /\\\\/;

// Founder smoke 2026-06-09: ~30 s JA monologue about 就職活動 (job hunting).
// Exact words unrecoverable — no raw audio persisted (memo §3). Topic + length
// + utterance count reconstructed to match the founder's described shape.
const FOUNDER_LIKE_TRANSCRIPT: SessionTranscript = {
  sessionId: 'escape-literal-repro',
  speakers: [{ id: 0 }],
  transcriptSegments: [
    { ts: 0.0, endTs: 7.5, text: '今日は就職活動について少し話してみたいと思います。', speakerId: 0 },
    { ts: 7.5, endTs: 15.0, text: '私が興味を持っているのは、新しい技術をうまく活用している会社です。', speakerId: 0 },
    { ts: 15.0, endTs: 22.5, text: '具体的には、AIや機械学習を業務に取り入れているところを見ています。', speakerId: 0 },
    { ts: 22.5, endTs: 30.0, text: '個人的な成長と会社の方向性が一致する場所を探していきたいです。', speakerId: 0 },
  ],
};

interface CapturedCall {
  prompt: string;
  text: string;
  seed: number;
}

function makeSpyingSidecar(real: GrammarCapableSidecar): {
  spy: GrammarCapableSidecar;
  captured: CapturedCall[];
} {
  const captured: CapturedCall[] = [];
  const spy: GrammarCapableSidecar = {
    async generateWithGrammar(req) {
      const r = await real.generateWithGrammar(req);
      captured.push({ prompt: req.prompt, text: r.text, seed: r.seed });
      return r;
    },
  };
  return { spy, captured };
}

beforeAll(async () => {
  // Register lecture family core (same pattern as lecture-orchestrator.test.ts).
  await import('@shared/families/lecture/core');
});

describe('escape-literal regex sanity (unit, fast)', () => {
  it('matches 2 ASCII backslashes (the founder shape: raw "\\\\u4eca")', () => {
    // Source `'\\\\u4eca'` = runtime `\\u4eca` (2 backslashes + u + hex).
    expect(ESCAPE_LITERAL_RE.test('\\\\u4eca')).toBe(true);
    // This run's shape: raw `\\\\'` (4 backslashes + apostrophe) — 4 chars in
    // a row trivially contains the 2-backslash pattern.
    expect(ESCAPE_LITERAL_RE.test('\\\\\\\\\'')).toBe(true);
  });

  it('does NOT match real CJK or a lone backslash', () => {
    expect(ESCAPE_LITERAL_RE.test('hello 今 world')).toBe(false);
    expect(ESCAPE_LITERAL_RE.test('【今のれんいしすてしたち】')).toBe(false);
    // Source `'\\u4eca'` = runtime `今` (1 backslash + u + hex) — only
    // ONE backslash, regex needs TWO consecutive.
    expect(ESCAPE_LITERAL_RE.test('\\u4eca')).toBe(false);
  });
});

const describeIf = llmModel && existsSync(sidecarBin) ? describe : describe.skip;

describeIf('real-3B finalizeLecture escape-literal repro (env-gated, ~1-3 min)', () => {
  afterAll(() => {
    try {
      execSync('pkill -9 -f llama-completion', { stdio: 'ignore' });
    } catch {
      /* no survivor */
    }
  });

  it(
    'finalizeLecture returns and the resulting note has no backslash in any decoded string',
    async () => {
      const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      let captured: CapturedCall[] = [];
      let result: FinalizeLectureResult | undefined;
      let runErr: unknown = undefined;
      try {
        await client.waitForReady(10_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(llmModel);

        const real = makeGrammarSidecar(client);
        const { spy, captured: cap } = makeSpyingSidecar(real);
        captured = cap;
        try {
          result = await finalizeLecture({
            sessionId: 'real-3b-repro',
            transcript: FOUNDER_LIKE_TRANSCRIPT,
            sidecar: spy,
            modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
          });
        } catch (e) {
          // CHUNK_FAILED:0:ESCAPE_LITERAL_AT_$.…:"…" means the fresh-seed
          // retry budget (3 inner attempts) exhausted without recovery. The
          // captured raw texts in the diagnostic show what the model kept
          // emitting — useful for tuning attempts up or escalating to the
          // grammar-edit option.
          runErr = e;
        }
      } finally {
        if (!existsSync(diagnosticDir)) mkdirSync(diagnosticDir, { recursive: true });
        const escapeAttempts = captured.filter((c) => ESCAPE_LITERAL_RE.test(c.text)).length;
        const lines: string[] = [
          `# Founder escape-literal repro (grammar path) — ${new Date().toISOString()}`,
          `# Model: ${llmModel}`,
          `# Captured ${captured.length} grammar call(s) — ${escapeAttempts} contained 2-backslash mode-collapse shape`,
          ...(runErr ? [`# finalizeLecture error: ${String(runErr)}`] : []),
        ];
        captured.forEach((c, i) => {
          lines.push('');
          lines.push(`--- Call ${i} (seed=${c.seed}, ${c.text.length} chars) ---`);
          lines.push(c.text);
        });
        writeFileSync(diagnosticPath, lines.join('\n') + '\n', 'utf8');
        proc.kill('SIGTERM');
      }

      // Fix verification (layered defense, 2026-06-09):
      //  (1) finalizeLecture returned (sanitize recovered OR retries broke
      //      out of the mode-collapse basin within budget).
      //  (2) The resulting note has no backslash in any decoded string slot.
      //      Raw text from the model may STILL contain escape literals
      //      (see diagnostic file — that's the pre-sanitize spy capture);
      //      what matters is that callWithGrammar's sanitize stage cleaned
      //      them before Zod, so the renderer-visible note is healthy.
      //  (3) Captured at least 1 call so we know the test path ran.
      expect(runErr, `finalizeLecture threw: ${runErr}`).toBeUndefined();
      expect(result).toBeDefined();
      expect(captured.length).toBeGreaterThan(0);

      const leak = findEscapeLiteralInStrings(result!.note);
      expect(
        leak,
        leak
          ? `escape-literal leak at ${leak.path}: ${JSON.stringify(leak.sample)} — full raw text history in ${diagnosticPath}`
          : 'unreachable',
      ).toBeNull();
    },
    300_000, // 5 min — wide enough for ≤3 inner retries on cold-cache 8 GB M3
  );
});
