import { ChunkAccumulator, SAMPLE_RATE } from './chunker';

export type RecordingSource = 'mic' | 'system';

/**
 * Payload shape sent from renderer → main for each finalized chunk.
 * `samples` is a Float32Array of 16kHz mono PCM; Electron's structured-clone
 * IPC path preserves it (no manual ArrayBuffer conversion needed).
 */
export interface ChunkPayload {
  index: number;
  source: RecordingSource;
  startMs: number;
  endMs: number;
  samples: Float32Array;
}

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
 * Tracks elapsed sample count so each chunk carries accurate [startMs, endMs).
 */
export class RecordingOrchestrator {
  private readonly sender: (chunk: ChunkPayload) => void;
  private readonly capturerFactory: (source: RecordingSource) => Capturer;
  private readonly firstChunkSec: number;
  private readonly chunkSec: number;

  private capturer: Capturer | null = null;
  private acc: ChunkAccumulator | null = null;
  private source: RecordingSource | null = null;
  private samplesSeen = 0;
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
    this.samplesSeen = 0;
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
    this.samplesSeen += s.length;
    this.acc.push(s);
  }

  private emitChunk(chunk: Float32Array): void {
    const source = this.source;
    if (!source) return;
    const endMs = Math.round((this.samplesSeen / SAMPLE_RATE) * 1000);
    const startMs = Math.round(endMs - (chunk.length / SAMPLE_RATE) * 1000);
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
