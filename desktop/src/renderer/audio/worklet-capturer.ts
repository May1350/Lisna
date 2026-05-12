import { SAMPLE_RATE } from './chunker';
import { startMicCapture, stopMicCapture } from './mic-capture';
import { startSystemAudioCapture, stopSystemAudioCapture } from './system-capture';
import type { Capturer, RecordingSource } from './orchestrator';

// Vite/electron-vite resolves this URL to a static asset served alongside the
// renderer bundle. If electron-vite ever stops serving raw .js inside src,
// move this file under `public/` and switch to a `/pcm-worklet.js` string URL.
const WORKLET_URL = new URL('./pcm-worklet.js', import.meta.url);

interface WorkletCapturerState {
  stream: MediaStream;
  audioCtx: AudioContext;
  node: AudioWorkletNode;
  src: MediaStreamAudioSourceNode;
  source: RecordingSource;
}

async function buildStream(source: RecordingSource): Promise<MediaStream> {
  if (source === 'mic') return startMicCapture();
  return startSystemAudioCapture();
}

async function releaseStream(state: WorkletCapturerState): Promise<void> {
  if (state.source === 'mic') {
    await stopMicCapture();
  } else {
    stopSystemAudioCapture(state.stream);
  }
}

/**
 * Factory used by RecordingOrchestrator. Builds an AudioContext at the target
 * SAMPLE_RATE (16kHz) so the browser's resampler does the SR conversion for us,
 * loads the PCM worklet, and routes the chosen MediaStream into it. The
 * worklet emits ~100ms Float32 batches back to the main thread via port.
 */
export function createCapturer(source: RecordingSource): Capturer {
  let state: WorkletCapturerState | null = null;

  return {
    async start(onSamples: (s: Float32Array) => void) {
      const stream = await buildStream(source);
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await audioCtx.audioWorklet.addModule(WORKLET_URL.toString());
      const src = audioCtx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioCtx, 'pcm-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => onSamples(ev.data);
      src.connect(node);
      state = { stream, audioCtx, node, src, source };
      return { sampleRate: audioCtx.sampleRate };
    },
    async stop() {
      const s = state;
      state = null;
      if (!s) return;
      try { s.src.disconnect(); } catch { /* ignore */ }
      try { s.node.disconnect(); } catch { /* ignore */ }
      s.node.port.onmessage = null;
      try { await s.audioCtx.close(); } catch { /* ignore */ }
      await releaseStream(s);
    },
  };
}
