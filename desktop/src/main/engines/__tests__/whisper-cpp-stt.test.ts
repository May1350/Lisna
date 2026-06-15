/**
 * Integration test for WhisperCppSTT against the real sidecar binary.
 *
 * Model: ggml-kotoba-whisper-v2.0-q5_0.bin (Q5_0 GGML)
 * SHA256: 4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658
 * Size:   537,819,875 bytes
 *
 * Set LISNA_TEST_STT_MODEL to an absolute path to run this suite.
 * Phase 4 will introduce the full model registry; for now the path is caller-supplied.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { SidecarClient } from '../../sidecar/client';
import { WhisperCppSTT } from '../whisper-cpp-stt';

const __dirname = dirname(fileURLToPath(import.meta.url));

const modelPath = process.env.LISNA_TEST_STT_MODEL ?? '';

const describeIf = modelPath ? describe : describe.skip;

// Paths relative to this file: src/main/engines/__tests__/ → desktop root is 4 up.
const sidecarBin = resolvePath(__dirname, '../../../../resources/sidecar');
const wavPath = resolvePath(__dirname, '../../../../tests/fixtures/audio/ja-30s.wav');
const expectedTranscript = readFileSync(
  resolvePath(__dirname, '../../../../tests/fixtures/transcripts/ja-30s.txt'),
  'utf8',
).trim();

describeIf('WhisperCppSTT (real model)', () => {
  let proc: ChildProcess;
  let stt: WhisperCppSTT;

  afterAll(() => {
    proc?.kill('SIGTERM');
  });

  it(
    'loads model, transcribes JA fixture, first 5 chars appear in result',
    async () => {
      proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      await client.waitForReady(10_000);

      stt = new WhisperCppSTT(client);
      await stt.loadModel(modelPath, 'ja');

      // WAV header is exactly 44 bytes (generated with ffmpeg -map_metadata -1 -bitexact).
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

      const segments = await stt.transcribe(pcmFloat32);
      const joined = segments.map((s) => s.text).join('');

      const first5 = expectedTranscript.slice(0, 5);
      expect(joined).toContain(first5);

      await stt.unloadModel();
    },
    { timeout: 120_000 },
  );

  it(
    'silence fixture produces zero segments after E+F filter',
    async () => {
      // Reload model — the previous test unloads it at its end.
      await stt.loadModel(modelPath, 'ja');

      const silenceWavPath = resolvePath(
        __dirname,
        '../../../../tests/fixtures/audio/ja-silence-30s.wav',
      );
      const wavBuf = readFileSync(silenceWavPath);
      if (wavBuf.subarray(0, 4).toString('ascii') !== 'RIFF') {
        throw new Error('silence fixture is not a RIFF WAV');
      }
      if (wavBuf.subarray(36, 40).toString('ascii') !== 'data') {
        throw new Error('silence fixture header is not exactly 44 bytes');
      }
      const pcmInt16 = new Int16Array(
        wavBuf.buffer,
        wavBuf.byteOffset + 44,
        (wavBuf.byteLength - 44) / 2,
      );
      const pcmFloat32 = new Float32Array(pcmInt16.length);
      for (let i = 0; i < pcmInt16.length; i++) {
        pcmFloat32[i] = (pcmInt16[i] ?? 0) / 32768;
      }

      const segments = await stt.transcribe(pcmFloat32);

      // After all 3 layers (sidecar runs whisper on the raw audio, since D is a
      // renderer-side concern not exercised by this main-side adapter test, then
      // E + F drop everything), expect ZERO segments.
      expect(segments).toHaveLength(0);

      // Note: if this assertion fails, log every dropped segment's noSpeechProb
      // to tune the F.front threshold. Likely raw whisper output for silence
      // includes some 「はい」/「ご視聴ありがとうございました」 with high
      // noSpeechProb — verify they're being dropped.

      await stt.unloadModel();
    },
    { timeout: 120_000 },
  );
});

// Unit coverage (no model, mocked sidecar) for the STT Phase 1 initialPrompt
// wiring — always runs, including in CI where LISNA_TEST_STT_MODEL is unset.
describe('WhisperCppSTT.transcribe — initialPrompt wiring (unit)', () => {
  function fakeClient() {
    return { send: vi.fn().mockResolvedValue({ type: 'segments', segments: [] }) };
  }

  it('includes initialPrompt in the transcribe request when provided', async () => {
    const client = fakeClient();
    const stt = new WhisperCppSTT(client as unknown as SidecarClient);
    await stt.transcribe(new Float32Array(8), { initialPrompt: '明治ホールディングス' });
    expect(client.send.mock.calls[0]![0]).toMatchObject({
      type: 'transcribe',
      initialPrompt: '明治ホールディングス',
    });
  });

  it('omits initialPrompt when absent or whitespace-only', async () => {
    const client = fakeClient();
    const stt = new WhisperCppSTT(client as unknown as SidecarClient);
    await stt.transcribe(new Float32Array(8));
    expect(client.send.mock.calls[0]![0]).not.toHaveProperty('initialPrompt');
    await stt.transcribe(new Float32Array(8), { initialPrompt: '   ' });
    expect(client.send.mock.calls[1]![0]).not.toHaveProperty('initialPrompt');
  });
});
