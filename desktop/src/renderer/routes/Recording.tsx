import { useEffect, useRef, useState } from 'react';
import type { DumpSummary, RecordingSource } from '@shared/ipc-protocol';
import type { Language } from '@shared/types';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';
import { HistoryList } from '../components/HistoryList';
import { SystemAudioUnavailableNotice } from '../components/SystemAudioUnavailableNotice';
import { Spinner } from '../components/Spinner';

/**
 * Step 5 §3.3 — after this many ms of "Loading model…" without resolution,
 * show the "taking longer than usual…" subtext. 8s matches the spec's R2
 * finding — STT cold load is normally 3-10s; >8s suggests TCC permission
 * prompt is stacked or sidecar is slow.
 */
const SLOW_LOAD_HINT_MS = 8_000;

interface Props {
  /**
   * Fired after the audio orchestrator + main-side recording have torn
   * down cleanly, before any structured-note pipeline runs. Passes the
   * recording's elapsed seconds so the parent can drop a too-short tap
   * (no live segments exist any more — empty detection is by time). The
   * parent decides what comes next (today: show FamilyPicker → finalize
   * per Plan 3 Task 12). Errors during teardown surface via onError.
   */
  onStop: (elapsedSec: number) => void;
  onError: (message: string) => void;
  /**
   * F2 — parent owns the FSM; Recording signals the user's intent to open a
   * history entry and the parent transitions to { kind: 'history', id }.
   */
  onOpenHistory: (id: string) => void;
}

export function Recording({ onStop, onError, onOpenHistory }: Props) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  // Flips true SLOW_LOAD_HINT_MS into the `starting=true` window so we can
  // add a "taking longer than usual…" hint. Resets to false on every start
  // attempt and on completion. Step 5 §3.3 task 2.
  const [slowLoad, setSlowLoad] = useState(false);
  const [source, setSource] = useState<RecordingSource>('mic');
  // Minimal EN support (2026-06-10) — ja/en only; ko/zh stay gated in main
  // (ipc rejects them). Persisted so a lecture-course routine doesn't reset
  // to ja every launch.
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem('lisna.language') === 'en' ? 'en' : 'ja'),
  );
  // Elapsed-seconds indicator. Counts while `running`; resets on each start.
  const [elapsedSec, setElapsedSec] = useState(0);
  // Pessimistic default: assume system audio is unavailable until the
  // capabilities round-trip confirms it. A slow IPC response should NOT
  // let the user click the system radio and then fail downstream.
  const [systemAudioAvailable, setSystemAudioAvailable] = useState(false);
  const [dumps, setDumps] = useState<DumpSummary[]>([]);
  const orchRef = useRef<RecordingOrchestrator | null>(null);
  // Synchronous re-click guard within a single component instance. setState is
  // async — a second click that arrives before the next React render still
  // sees the old `running=false` and slips through. A ref flips synchronously
  // and closes that window. (React Strict Mode creates a new component
  // instance per mount cycle, so refs are recreated, not "preserved" — the
  // guard is per-instance.)
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void window.lisna.capabilities().then((caps) => {
      if (!cancelled) setSystemAudioAvailable(caps.systemAudio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // F2 history list: fetch dump summaries when idle (not running/starting).
  // Refreshes each time a recording ends (running flips false). Best-effort:
  // an IPC error leaves dumps=[] (the empty-state line) — no error banner.
  useEffect(() => {
    if (running || starting) return;
    let cancelled = false;
    void window.lisna
      .listDumps()
      .then((d) => { if (!cancelled) setDumps(d); })
      .catch(() => { /* best-effort; failure leaves the empty state showing */ });
    return () => { cancelled = true; };
  }, [running, starting]);

  // Slow-load hint timer. Schedule once when `starting` flips true; clear
  // on cleanup so a fast resolution doesn't leave a stale flip pending. The
  // setState happens after SLOW_LOAD_HINT_MS only if `starting` is still
  // true at the moment of fire (cleanup runs first on resolution).
  useEffect(() => {
    if (!starting) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), SLOW_LOAD_HINT_MS);
    return () => clearTimeout(t);
  }, [starting]);

  // Recording-elapsed ticker. Interval lives only while running; the start
  // timestamp is captured at flip-true so a re-render can't skew the base.
  useEffect(() => {
    if (!running) return;
    setElapsedSec(0);
    const t0 = Date.now();
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Unmount cleanup. If the component unmounts while a recording is active
  // (Strict Mode dev double-mount, app close), tear down the audio
  // orchestrator + recording/stop. Early-return if orchRef is already null —
  // normal stop() path nulls it before unmount, so this catches only the
  // abnormal teardown.
  useEffect(() => {
    return () => {
      const orch = orchRef.current;
      if (!orch) return;
      orchRef.current = null;
      void orch.stop();
      void window.lisna.stopRecording().catch(() => {
        /* best-effort */
      });
    };
  }, []);

  async function start() {
    if (running || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      // Audio first, session/start last. Three reasons:
      //   1. macOS TCC mic-permission prompt can take up to 30s on first
      //      launch. Loading STT in parallel wastes RSS-time.
      //   2. If audio init fails after session/start succeeded, we'd need a
      //      session/cancel IPC to release STT — extra surface area.
      //   3. Chunks during STT load are dropped server-side (main's
      //      `recording === false`). At 16kHz/2s chunks the lost window is
      //      ≤1 chunk; accepted v2.0.
      await window.lisna.startRecording(source);
      const orch = new RecordingOrchestrator({
        capturerFactory: (s) => createCapturer(s),
        sender: (chunk) => {
          void window.lisna.sendChunk(chunk);
        },
      });
      orchRef.current = orch;
      await orch.start(source);
      // Now mic is capturing. Chunks send but main drops them until session/start completes.
      await window.lisna.startSession({ language });
      setRunning(true);
    } catch (err) {
      // Cleanup: tear down whatever started.
      const orch = orchRef.current;
      orchRef.current = null;
      if (orch) await orch.stop().catch(() => {});
      await window.lisna.stopRecording().catch(() => {});
      console.error('Start failed', err);
      onError(String((err as Error)?.message ?? err));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function stop() {
    try {
      const orch = orchRef.current;
      orchRef.current = null;
      if (orch) await orch.stop();
      await window.lisna.stopRecording();
    } catch (err) {
      onError(String((err as Error)?.message ?? err));
      return;
    } finally {
      setRunning(false);
    }
    // Hand off to parent. Parent shows FamilyPicker → finalize → NoteView
    // per Plan 3 Task 12; finalize happens in App.tsx where the FSM lives,
    // so Recording.tsx no longer awaits the structured-note pipeline.
    onStop(elapsedSec);
  }

  return (
    <section>
      <h2>Recording</h2>
      <fieldset disabled={running || starting}>
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            name="source"
            value="mic"
            checked={source === 'mic'}
            onChange={() => setSource('mic')}
          />
          Microphone
        </label>
        <label>
          <input
            type="radio"
            name="source"
            value="system"
            checked={source === 'system'}
            disabled={!systemAudioAvailable}
            onChange={() => setSource('system')}
          />
          System audio
        </label>
      </fieldset>
      {!systemAudioAvailable && <SystemAudioUnavailableNotice />}
      <fieldset disabled={running || starting}>
        <legend>Language</legend>
        <label>
          <input
            type="radio"
            name="language"
            value="ja"
            checked={language === 'ja'}
            onChange={() => { setLanguage('ja'); localStorage.setItem('lisna.language', 'ja'); }}
          />
          日本語
        </label>
        <label>
          <input
            type="radio"
            name="language"
            value="en"
            checked={language === 'en'}
            onChange={() => { setLanguage('en'); localStorage.setItem('lisna.language', 'en'); }}
          />
          English
        </label>
      </fieldset>
      <button disabled={starting} onClick={running ? stop : start}>
        {running ? 'Stop' : starting ? (
          <>
            <Spinner /> Loading model…
          </>
        ) : 'Start'}
      </button>
      {running && (
        <span style={{ marginLeft: '0.75em', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
          ● {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
        </span>
      )}
      {starting && slowLoad && (
        <p style={{ color: '#888', fontSize: '0.9em', marginTop: '0.25em' }}>
          (taking longer than usual…)
        </p>
      )}
      {!running && !starting && <HistoryList dumps={dumps} onOpen={onOpenHistory} />}
    </section>
  );
}
