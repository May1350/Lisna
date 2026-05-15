/**
 * Step 5 §6 — full STT → SessionOrchestrator → LLM → Note end-to-end smoke.
 *
 * **Scope**: validates the model + orchestrator + prompt path with real
 * binaries. Does NOT cover the renderer UI, IPC channel, audio capture,
 * or mic-permission TCC prompt — those need a live Electron session with
 * a human at the keyboard. This is the "headless smoke" the spec §6 says
 * unblocks Phase B prompt tuning.
 *
 * **Env gating**: skips unless BOTH `LISNA_TEST_STT_MODEL` and
 * `LISNA_TEST_LLM_MODEL` are set to absolute paths. On a smoke run:
 *
 *   LISNA_TEST_STT_MODEL=~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin \
 *   LISNA_TEST_LLM_MODEL=~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
 *   pnpm test full-pipeline-smoke
 *
 * **Calibration**: 8GB M1 with kotoba-Whisper Q5_0 + Llama 3.2 3B Q4_K_M
 * is at the upper edge of what fits without swap. Test allots 5min total
 * timeout to absorb cold-load + generate latency.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../sidecar/client';
import { SessionOrchestrator } from '../sidecar/orchestrator';
import { WhisperCppSTT } from '../engines/whisper-cpp-stt';
import { LlamaCppLLM } from '../engines/llama-cpp-llm';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sttModel = process.env.LISNA_TEST_STT_MODEL ?? '';
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const sidecarBin = resolvePath(__dirname, '../../../resources/sidecar');
const wavPath = resolvePath(__dirname, '../../../tests/fixtures/audio/ja-30s.wav');
const observedNotePath = resolvePath(__dirname, '../../../docs/last-smoke-note.txt');

const describeIf = sttModel && llmModel && existsSync(sidecarBin) ? describe : describe.skip;

/** Decode the canonical fixture WAV to Float32Array PCM. Shared with whisper-cpp-stt test. */
function loadFixtureAudio(): Float32Array {
  const wavBuf = readFileSync(wavPath);
  if (wavBuf.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('not a RIFF WAV');
  if (wavBuf.subarray(36, 40).toString('ascii') !== 'data') {
    throw new Error('header is not exactly 44 bytes — regenerate with generate-ja-30s.sh');
  }
  const pcmInt16 = new Int16Array(wavBuf.buffer, wavBuf.byteOffset + 44, (wavBuf.byteLength - 44) / 2);
  const pcmFloat32 = new Float32Array(pcmInt16.length);
  for (let i = 0; i < pcmInt16.length; i++) {
    pcmFloat32[i] = (pcmInt16[i] ?? 0) / 32768;
  }
  return pcmFloat32;
}

describeIf('Full pipeline smoke (STT → Orchestrator → LLM → Note)', () => {
  it(
    'happy path: 30s JA fixture produces a non-empty plain-text Note',
    async () => {
      const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      try {
        await client.waitForReady(10_000);
        const stt = new WhisperCppSTT(client);
        const llm = new LlamaCppLLM(client);
        const orch = new SessionOrchestrator({
          stt, llm,
          sttModelPath: sttModel,
          llmModelPath: llmModel,
          language: 'ja',
        });

        await orch.start();

        const audio = loadFixtureAudio();
        // Feed the whole 30s as one chunk — equivalent to one full recording.
        const segs = await orch.onChunk(audio);
        expect(segs.length).toBeGreaterThan(0);
        // STT should recognize at least one character from the canonical script.
        const joined = segs.map((s) => s.text).join('');
        expect(joined.length).toBeGreaterThan(0);

        const phases: string[] = [];
        const note = await orch.stop((p) => phases.push(p));

        // Capture the actual Note text for the prompt-quality anchor in
        // manual-verification.md — write to a sibling file the human can
        // pick up + paste into the eval-anchor section.
        writeFileSync(
          observedNotePath,
          `# Last smoke run — ${new Date().toISOString()}\n` +
            `# STT segments: ${segs.length}\n` +
            `# Transcript chars: ${joined.length}\n` +
            `# Note chars: ${note.markdown.length}\n` +
            `# Phases observed: ${phases.join(', ')}\n` +
            `\n--- Transcript ---\n${joined}\n` +
            `\n--- Note ---\n${note.markdown}\n`,
          'utf8',
        );

        // Phase sequence matches spec §3.4.
        expect(phases).toEqual(['stt-unloading', 'llm-loading', 'generating']);
        // Note shape: non-empty markdown + correct language + segments preserved.
        expect(note.language).toBe('ja');
        expect(note.transcriptSegments.length).toBeGreaterThan(0);

        // ---- Quality assertions (post-2026-05-15 hardening) ----
        //
        // History:
        // 1. The pre-2026-05-15 `length > 0` assertion passed a degenerate `@`
        //    Note when sidecar llama_decode failed mid-generation.
        // 2. The interim 2026-05-15 morning assertions (length≥30 + diversity≥10
        //    + JA chars) passed a 6588-char infinite-loop catastrophe where the
        //    1B model repeated `【次のアクション】 / 【決定事項】` 226 times.
        //
        // The hardened set below combines structural checks: positive (template
        // produced a real section), upper-bound (runaway detector), token-
        // frequency (loop detector), plus the original instincts (lower bound,
        // diversity, JA chars). Each check has a load-bearing comment so a
        // future regression triages quickly.

        // Positive structural check: at least one canonical section header
        // appeared. If the chat template silently failed, the model would
        // continue the transcript instead of producing structured sections,
        // and none of these would show up.
        expect(
          /【(要点|決定事項|次のアクション)】/.test(note.markdown),
          `no JA section header — chat template may have silently failed: ${JSON.stringify(note.markdown.slice(0, 200))}`,
        ).toBe(true);

        // Upper bound — a 30s fixture should not produce runaway output. The
        // 2026-05-15 1B catastrophe was 6588 chars; a coherent JA summary of
        // ~30s of speech is typically 200-1500 chars. 4000 is generous and
        // unambiguously detects an infinite-loop generation.
        expect(
          note.markdown.length,
          `runaway output (${note.markdown.length} chars) — likely infinite loop`,
        ).toBeLessThan(4000);

        // Loop detector via token frequency: no single ≥8-char substring may
        // appear more than 10 times anywhere in the Note. Why this matters:
        // the founder's proposed `/(.{8,}?)\1{4,}/` regex did NOT catch the
        // 1B catastrophe because the repeats were paragraph-separated
        // permutations (`【決定事項】 / 【次のアクション】 / 【決定事項】` vs
        // `【次のアクション】 / 【決定事項】 / 【決定事項】`), not byte-
        // identical. A token-frequency check is paragraph-invariant.
        //
        // We tokenize on whitespace + slash (the catastrophe's separator
        // pattern) and look at unique tokens of len≥8. A healthy Note may
        // legitimately re-state a section header 2-3 times across rewrites;
        // 226 occurrences (the catastrophe count) clears any sane threshold.
        const tokens = note.markdown.split(/[\s/]+/).filter((t) => t.length >= 8);
        const tokenCounts = new Map<string, number>();
        for (const t of tokens) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
        let maxToken = '';
        let maxCount = 0;
        for (const [k, v] of tokenCounts) if (v > maxCount) { maxCount = v; maxToken = k; }
        expect(
          maxCount,
          `token "${maxToken}" repeats ${maxCount}× — likely loop`,
        ).toBeLessThanOrEqual(10);

        // Lower bound + diversity + JA chars (preserves founder's instincts).
        expect(
          note.markdown.length,
          `degenerate Note (${note.markdown.length} chars): ${JSON.stringify(note.markdown)}`,
        ).toBeGreaterThanOrEqual(30);
        expect(
          new Set(note.markdown).size,
          `low character diversity in Note: ${JSON.stringify(note.markdown.slice(0, 200))}`,
        ).toBeGreaterThanOrEqual(10);
        // Must contain at least one Japanese character (Hiragana/Katakana/CJK).
        // Catches "@", "...", English-only fallback, or empty/whitespace outputs.
        expect(
          /[぀-ヿ一-鿿]/.test(note.markdown),
          `no Japanese characters in Note: ${JSON.stringify(note.markdown.slice(0, 200))}`,
        ).toBe(true);

        // ja-note-v1 prompt instructs the LLM to avoid Markdown syntax tokens.
        // Soft check: no triple-backtick fences, no `# ` headers at line start.
        const lines = note.markdown.split('\n');
        for (const line of lines) {
          expect(line.startsWith('# '), `markdown header leak: ${line}`).toBe(false);
          expect(line.startsWith('## '), `markdown header leak: ${line}`).toBe(false);
        }
        expect(note.markdown.includes('```'), 'triple-backtick leak').toBe(false);
      } finally {
        proc.kill('SIGTERM');
      }
    },
    300_000,  // 5 minutes total
  );

  it(
    'empty transcript: orch.stop without chunks throws EMPTY_TRANSCRIPT',
    async () => {
      const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      try {
        await client.waitForReady(10_000);
        const stt = new WhisperCppSTT(client);
        const llm = new LlamaCppLLM(client);
        const orch = new SessionOrchestrator({
          stt, llm,
          sttModelPath: sttModel,
          llmModelPath: llmModel,
          language: 'ja',
        });
        await orch.start();
        // No onChunk → segments empty.
        await expect(orch.stop()).rejects.toThrow('EMPTY_TRANSCRIPT');
      } finally {
        proc.kill('SIGTERM');
      }
    },
    120_000,
  );
});
