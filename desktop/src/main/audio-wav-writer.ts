import fs from 'node:fs';

const SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Streaming 16 kHz mono PCM16 WAV writer. Opens the file, reserves a 44-byte
 * header, appends Float32 samples as they arrive (one recording chunk at a
 * time), and patches the RIFF/data sizes into the header on close().
 *
 * Used by the audio-save hook (LISNA_SAVE_AUDIO=1) to persist a whole-session
 * WAV for the diarization DER spike + the offline-at-Stop production path.
 * 2h @ 16kHz mono PCM16 is about 230 MB on disk — streamed, never buffered.
 */
export class WavWriter {
  private fd: number;
  private dataBytes = 0;
  private closed = false;
  // Track write position explicitly: fs.writeSync with an explicit position
  // argument uses pwrite() and does NOT advance the fd's file offset, so we
  // must manage the cursor ourselves.
  private pos = 0;

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'w');
    fs.writeSync(this.fd, this.header(0), 0, 44, 0);
    this.pos = 44;
  }

  append(samples: Float32Array): void {
    if (this.closed) throw new Error('WavWriter: append after close');
    const buf = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
    }
    fs.writeSync(this.fd, buf, 0, buf.length, this.pos);
    this.pos += buf.length;
    this.dataBytes += buf.length;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.writeSync(this.fd, this.header(this.dataBytes), 0, 44, 0); // patch header
    fs.closeSync(this.fd);
  }

  private header(dataBytes: number): Buffer {
    const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
    const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(36 + dataBytes, 4);
    h.write('WAVE', 8, 'ascii');
    h.write('fmt ', 12, 'ascii');
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(NUM_CHANNELS, 22);
    h.writeUInt32LE(SAMPLE_RATE, 24);
    h.writeUInt32LE(byteRate, 28);
    h.writeUInt16LE(blockAlign, 32);
    h.writeUInt16LE(BITS_PER_SAMPLE, 34);
    h.write('data', 36, 'ascii');
    h.writeUInt32LE(dataBytes, 40);
    return h;
  }
}
