import { ChunkAccumulator, SAMPLE_RATE } from './chunker';
import type { ChunkPayload, RecordingSource } from '@shared/ipc-protocol';

export type { ChunkPayload, RecordingSource };

/**
 * Capturer abstracts the audio source (mic / system / fake-for-test).
 * `start` registers an onSamples callback that fires with Float32 PCM batches
 * at SAMPLE_RATE (16kHz). `stop` releases the underlying MediaStream/Worklet.
 */
export interface Capturer {
  start(onSamples: (s: Float32Array) => void): Promise<{ sampleRate: number }>;
  stop(): Promise<void>;
}

export interface OrchestratorOptions {
  sender: (chunk: ChunkPayload) => void;
  capturerFactory: (source: RecordingSource) => Capturer;
  firstChunkSec?: number;
  chunkSec?: number;
}

/**
 * Coordinates: Capturer → ChunkAccumulator → sender (IPC bridge).
 * Tracks emitted sample count so each chunk carries accurate [startMs, endMs).
 *
 * Critical: timestamps are derived from `samplesEmitted` (total samples already
 * shipped in finalized chunks), NOT from the running input counter. A single
 * push from the capturer may straddle a chunk boundary, so the input counter
 * can advance past the chunk's true end before `emitChunk` runs.
 */
export class RecordingOrchestrator {
  private readonly sender: (chunk: ChunkPayload) => void;
  private readonly capturerFactory: (source: RecordingSource) => Capturer;
  private readonly firstChunkSec: number;
  private readonly chunkSec: number;

  private capturer: Capturer | null = null;
  private acc: ChunkAccumulator | null = null;
  private source: RecordingSource | null = null;
  private samplesEmitted = 0;
  private chunkIndex = 0;

  constructor(opts: OrchestratorOptions) {
    this.sender = opts.sender;
    this.capturerFactory = opts.capturerFactory;
    this.firstChunkSec = opts.firstChunkSec ?? 2;
    this.chunkSec = opts.chunkSec ?? 10;
  }

  async start(source: RecordingSource): Promise<void> {
    if (this.capturer) return; // already running
    this.source = source;
    this.samplesEmitted = 0;
    this.chunkIndex = 0;
    this.acc = new ChunkAccumulator({
      firstChunkSec: this.firstChunkSec,
      chunkSec: this.chunkSec,
      onChunk: (chunk) => this.emitChunk(chunk),
    });
    this.capturer = this.capturerFactory(source);
    await this.capturer.start((s) => this.onSamples(s));
  }

  async stop(): Promise<void> {
    const cap = this.capturer;
    const acc = this.acc;
    this.capturer = null;
    this.acc = null;
    // Stop the capturer first so no further onSamples fires while flushing.
    if (cap) await cap.stop();
    if (acc) acc.flush();
    this.source = null;
  }

  private onSamples(s: Float32Array): void {
    if (!this.acc) return;
    this.acc.push(s);
  }

  private emitChunk(chunk: Float32Array): void {
    const source = this.source;
    if (!source) return;
    const startSamples = this.samplesEmitted;
    this.samplesEmitted += chunk.length;
    const startMs = Math.round((startSamples / SAMPLE_RATE) * 1000);
    const endMs = Math.round((this.samplesEmitted / SAMPLE_RATE) * 1000);
    const payload: ChunkPayload = {
      index: this.chunkIndex++,
      source,
      startMs,
      endMs,
      samples: chunk,
    };
    this.sender(payload);
  }
}
