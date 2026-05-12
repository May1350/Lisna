// AudioWorkletProcessor running in the AudioWorkletGlobalScope.
// Posts batches of Float32 PCM samples (the worklet's native sample rate; the
// outer context AudioContext is configured to 16kHz so we don't resample here)
// back to the main thread via this.port.
//
// We average across channels to produce mono. Each render quantum is typically
// 128 frames; we accumulate to ~1600 samples (≈100ms at 16kHz) before
// dispatching to keep the message rate manageable.
//
// Note: must live as a .js file because AudioWorklet.addModule expects a URL
// that the browser can load directly, not a TS source.

const BATCH_SAMPLES = 1600; // ~100ms at 16kHz

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._batch = new Float32Array(BATCH_SAMPLES);
    this._batchFill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Downmix channels to mono by averaging
    const ch0 = input[0];
    if (!ch0) return true;
    const frameCount = ch0.length;
    const channelCount = input.length;

    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < channelCount; c++) {
        const ch = input[c];
        if (ch) sum += ch[i];
      }
      this._batch[this._batchFill++] = sum / channelCount;
      if (this._batchFill === BATCH_SAMPLES) {
        // Transfer ownership of the buffer to the main thread for zero-copy.
        const out = this._batch;
        this._batch = new Float32Array(BATCH_SAMPLES);
        this._batchFill = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorkletProcessor);
