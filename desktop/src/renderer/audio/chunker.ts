export const SAMPLE_RATE = 16000;

export interface ChunkAccumulatorOptions {
  onChunk(chunk: Float32Array): void;
  firstChunkSec?: number;   // default 2
  chunkSec?: number;        // default 10
}

export class ChunkAccumulator {
  private buffer: Float32Array[] = [];
  private bufferLen = 0;
  private chunkIndex = 0;
  private readonly firstSamples: number;
  private readonly subsequentSamples: number;
  private readonly onChunk: (c: Float32Array) => void;

  constructor(opts: ChunkAccumulatorOptions) {
    this.firstSamples = (opts.firstChunkSec ?? 2) * SAMPLE_RATE;
    this.subsequentSamples = (opts.chunkSec ?? 10) * SAMPLE_RATE;
    this.onChunk = opts.onChunk;
  }

  push(samples: Float32Array): void {
    this.buffer.push(samples);
    this.bufferLen += samples.length;
    const need = this.chunkIndex === 0 ? this.firstSamples : this.subsequentSamples;
    while (this.bufferLen >= need) {
      this.emit(need);
    }
  }

  flush(): void {
    if (this.bufferLen > 0) this.emit(this.bufferLen);
  }

  private emit(targetLen: number): void {
    const out = new Float32Array(targetLen);
    let written = 0;
    while (written < targetLen) {
      const head = this.buffer[0]!;
      const take = Math.min(head.length, targetLen - written);
      out.set(head.subarray(0, take), written);
      written += take;
      if (take === head.length) this.buffer.shift();
      else this.buffer[0] = head.subarray(take);
    }
    this.bufferLen -= targetLen;
    this.chunkIndex += 1;
    this.onChunk(out);
  }
}
