import { describe, it, expect } from 'vitest';
import { ChunkAccumulator } from '../chunker';

const SR = 16000;

describe('ChunkAccumulator (16kHz mono Float32, 2s 초기 / 10s 후속)', () => {
  it('첫 청크는 2초 (32000 샘플) 모이면 emit', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR));            // 1s
    expect(emitted).toHaveLength(0);
    acc.push(new Float32Array(SR));            // +1s = 2s
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.length).toBe(SR * 2);
  });

  it('두 번째 청크부터는 10초 (160000 샘플)', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR * 2));        // 첫 청크 emit
    acc.push(new Float32Array(SR * 9));        // 9s → 아직 모자람
    expect(emitted).toHaveLength(1);
    acc.push(new Float32Array(SR));            // +1s = 10s
    expect(emitted).toHaveLength(2);
    expect(emitted[1]!.length).toBe(SR * 10);
  });

  it('flush() 는 남은 잔여를 마지막 (부분) 청크로 emit', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR * 2));        // 첫 청크
    acc.push(new Float32Array(SR * 3));        // 잔여 3s
    acc.flush();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]!.length).toBe(SR * 3);
  });
});
