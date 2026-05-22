import { describe, it, expect, vi } from 'vitest';
import { WhisperCppSTT } from '../whisper-cpp-stt';
import type { SidecarClient } from '../../sidecar/client';
import type { TranscriptSegment } from '@shared/engine-interfaces';

function makeMockClient(segments: TranscriptSegment[]): SidecarClient {
  return {
    send: vi.fn(async (req: { type: string }) => {
      if (req.type === 'load') return { type: 'ok' };
      if (req.type === 'unload') return { type: 'ok' };
      if (req.type === 'transcribe') return { type: 'segments', segments };
      return { type: 'error', code: 'unknown', message: 'unknown req' };
    }),
  } as unknown as SidecarClient;
}

describe('WhisperCppSTT transcribe filters hallucinations', () => {
  it('drops 「はい」 with zero-zero timestamp (Layer E marker 2)', async () => {
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい', noSpeechProb: 0.4 },
      { startSec: 1, endSec: 2, text: '今日は', noSpeechProb: 0.05 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('今日は');
  });

  it('drops high-prob unknown text (Layer F.front)', async () => {
    const client = makeMockClient([
      { startSec: 0, endSec: 1, text: 'abc', noSpeechProb: 0.9 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(0);
  });

  it('keeps real speech', async () => {
    const client = makeMockClient([
      { startSec: 5, endSec: 6, text: '元気ですか', noSpeechProb: 0.1 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
  });

  it('switches blocklist on re-loadModel with different language', async () => {
    // Load JA → 「はい」 hallucination is dropped
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい', noSpeechProb: 0.4 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/ja-model.bin', 'ja');
    let out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(0);

    // Re-load with EN → 「はい」 not in EN blocklist, kept
    // (note: F.front prob 0.4 < default threshold 0.6 so prob doesn't drop it either)
    await stt.loadModel('/fake/en-model.bin', 'en');
    out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
  });

  it('returns segments unfiltered if transcribe called before loadModel (defensive)', async () => {
    // Sidecar would normally reject this with 'not_loaded'; this tests the
    // defensive branch in case sidecar behavior changes.
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい' },
    ]);
    const stt = new WhisperCppSTT(client);
    // skip loadModel — language stays null
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);  // not filtered
  });
});
