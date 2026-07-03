import { useEffect, useRef, useState } from 'react';
import type { DumpSummary, RecordingSource } from '@shared/ipc-protocol';
import type { Language } from '@shared/types';
import { RecordingOrchestrator } from '../audio/orchestrator';
import { createCapturer } from '../audio/worklet-capturer';
import { setPreferredMicDevice } from '../audio/mic-capture';
import { HistoryList } from '../components/HistoryList';
import { LevelMeter } from '../components/LevelMeter';
import { SystemAudioUnavailableNotice } from '../components/SystemAudioUnavailableNotice';
import { Spinner } from '../components/Spinner';

/**
 * Step 5 §3.3 — after this many ms of "Loading model…" without resolution,
 * show the "taking longer than usual…" subtext. 8s matches the spec's R2
 * finding — STT cold load is normally 3-10s; >8s suggests TCC permission
 * prompt is stacked or sidecar is slow.
 */
const SLOW_LOAD_HINT_MS = 8_000;

// enumerateDevices() returns nameless / id-less entries until getUserMedia has
// run once in the document. When mic permission is already granted (returning
// user — persists via macOS TCC), one throwaway getUserMedia unlocks the labels
// with NO prompt. Module-scoped so we prime at most once per app launch — not on
// every return to the recording screen (which would re-flash the mic indicator).
let micDevicesPrimed = false;

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
  onOpenTerms: () => void;
  /**
   * Phase 2 quick-transcript slice (scenario 1): the user marks a span
   * [startSec, endSec) of the ONGOING recording; the parent slices the live WAV
   * and runs a background transcript without stopping the recording.
   */
  onQuickTranscript: (startSec: number, endSec: number) => void;
  /** True while a generation is already running — the slice button is disabled
   *  (only one generation at a time; the chip shows the running one). */
  quickTranscriptBusy?: boolean;
}

export function Recording({ onStop, onError, onOpenHistory, onOpenTerms, onQuickTranscript, quickTranscriptBusy }: Props) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  // Flips true SLOW_LOAD_HINT_MS into the `starting=true` window so we can
  // add a "taking longer than usual…" hint. Resets to false on every start
  // attempt and on completion. Step 5 §3.3 task 2.
  const [slowLoad, setSlowLoad] = useState(false);
  const [source, setSource] = useState<RecordingSource>('mic');
  // Auto-detected audio input devices (mics / earphones) + the chosen one
  // ('' = system default). Enumerated on mount + on hot-plug (devicechange).
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  // Supported capture languages: ja/en (full notes) + ko (transcription-only,
  // Phase 1 — see languageCapabilities). zh stays gated (ipc rejects it).
  // Persisted so a lecture-course routine doesn't reset to ja every launch.
  const [language, setLanguage] = useState<Language>(
    () => {
      const v = localStorage.getItem('lisna.language');
      return v === 'en' || v === 'ko' ? v : 'ja';
    },
  );
  // Elapsed-seconds indicator. Counts while `running`; resets on each start.
  const [elapsedSec, setElapsedSec] = useState(0);
  // Phase 2 quick-transcript: the elapsed-second the user marked as the span
  // start, or null when no span is open. Reset when the recording stops.
  const [spanStartSec, setSpanStartSec] = useState<number | null>(null);
  // Live RMS dBFS audio level for the recording-screen meter, fed from the
  // orchestrator's onLevel. Floor (-60) at rest / between recordings so a
  // stale bar doesn't linger.
  const [level, setLevel] = useState(-60);
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

  // Detect connected input devices (built-in mic, AirPods, USB mic…) and refresh
  // on hot-plug. Device LABELS are only populated once mic permission is granted
  // (persists via macOS TCC after the first recording), so on a first-ever launch
  // the list may be name-less until then — the picker falls back to a generic
  // label + "自動" default. mediaDevices is absent in the vitest (no-DOM) env, so
  // guard it; this effect is live-verified in the app.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let live = true;
    const refresh = () => {
      md.enumerateDevices().then((all) => {
        if (!live) return;
        // Keep real inputs only — drop the "default"/"communications" aliases
        // (they duplicate a real device); our '' option IS the system default.
        const inputs = all.filter(
          (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications',
        );
        setMicDevices(inputs);
        // If the chosen device was unplugged, fall back to the system default.
        setMicDeviceId((cur) => (cur && !inputs.some((d) => d.deviceId === cur) ? '' : cur));
      }).catch(() => { /* enumerate can reject without permission — leave empty */ });
    };
    // Prime label access once (if already granted → silent), then enumerate.
    void (async () => {
      try {
        const perm = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        if (perm?.state === 'granted' && !micDevicesPrimed) {
          micDevicesPrimed = true;
          const s = await md.getUserMedia({ audio: true, video: false });
          s.getTracks().forEach((t) => t.stop());
        }
      } catch { /* permissions/getUserMedia unavailable — fall back to enumerate-only */ }
      refresh();
    })();
    md.addEventListener?.('devicechange', refresh);
    return () => { live = false; md.removeEventListener?.('devicechange', refresh); };
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
    if (!running) {
      // Reset the level meter to the floor so a stale bar doesn't linger
      // between recordings (runs on mount and whenever running flips false).
      setLevel(-60);
      return;
    }
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
      // Route the picked input device into the mic capturer ('' → system default);
      // ignored for system-audio source.
      setPreferredMicDevice(source === 'mic' ? (micDeviceId || undefined) : undefined);
      await window.lisna.startRecording(source);
      const orch = new RecordingOrchestrator({
        capturerFactory: (s) => createCapturer(s),
        sender: (chunk) => {
          void window.lisna.sendChunk(chunk);
        },
        onLevel: (db) => setLevel(db),
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
      setSpanStartSec(null); // abandon any open quick-transcript span
    }
    // Hand off to parent. Parent shows FamilyPicker → finalize → NoteView
    // per Plan 3 Task 12; finalize happens in App.tsx where the FSM lives,
    // so Recording.tsx no longer awaits the structured-note pipeline.
    onStop(elapsedSec);
  }

  return (
    <section className="lz-pad" style={{ maxWidth: 620, margin: '0 auto' }}>
      {!running && !starting && (
        <>
          <div style={{ marginBottom: 18 }}>
            <p className="lz-label">ソース</p>
            <fieldset className="lz-seg" disabled={running || starting}>
              <legend>ソース</legend>
              <label>
                <input type="radio" name="source" value="mic" checked={source === 'mic'} onChange={() => setSource('mic')} />
                マイク
              </label>
              <label>
                <input type="radio" name="source" value="system" checked={source === 'system'} disabled={!systemAudioAvailable} onChange={() => setSource('system')} />
                システム音声
              </label>
            </fieldset>

            {/* Plain-language helper — non-tech users don't know what each captures. */}
            <p className="lz-hint" style={{ margin: '8px 2px 0', lineHeight: 1.5 }}>
              {source === 'mic'
                ? 'マイクやイヤホンから、目の前の声・音を録ります（対面の会議・自分の声など）。'
                : 'この端末で再生中の音を録ります（オンライン会議・動画・通話など）。'}
            </p>

            {/* Auto-detected input devices (mic source only). */}
            {source === 'mic' && (
              <div style={{ marginTop: 10 }}>
                <label htmlFor="mic-device" className="lz-label" style={{ display: 'block' }}>入力デバイス</label>
                <select
                  id="mic-device"
                  value={micDeviceId}
                  disabled={running || starting}
                  onChange={(e) => { setMicDeviceId(e.target.value); setPreferredMicDevice(e.target.value || undefined); }}
                  style={{ minWidth: 240, maxWidth: 340 }}
                >
                  <option value="">自動（システムのマイク）</option>
                  {micDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `マイク ${i + 1}`}</option>
                  ))}
                </select>
                {micDevices.length === 0 && (
                  <p className="lz-hint" style={{ marginTop: 5 }}>
                    接続中のマイクを検出中… 一度録音を許可すると、イヤホン・外部マイクを選べます。
                  </p>
                )}
              </div>
            )}
          </div>
          {!systemAudioAvailable && <SystemAudioUnavailableNotice />}
          <div style={{ marginBottom: 26 }}>
            <p className="lz-label">言語</p>
            <fieldset className="lz-seg" disabled={running || starting}>
              <legend>言語</legend>
              <label>
                <input type="radio" name="language" value="ja" checked={language === 'ja'} onChange={() => { setLanguage('ja'); localStorage.setItem('lisna.language', 'ja'); }} />
                日本語
              </label>
              <label>
                <input type="radio" name="language" value="en" checked={language === 'en'} onChange={() => { setLanguage('en'); localStorage.setItem('lisna.language', 'en'); }} />
                English
              </label>
              <label>
                <input type="radio" name="language" value="ko" checked={language === 'ko'} onChange={() => { setLanguage('ko'); localStorage.setItem('lisna.language', 'ko'); }} />
                한국어
              </label>
            </fieldset>
          </div>
        </>
      )}

      {!running ? (
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <button className="lz-record" disabled={starting} onClick={start} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {starting ? (<><Spinner /> 読み込み中…</>) : (<><span style={{ width: 9, height: 9, borderRadius: '50%', background: 'currentColor' }} />録音を開始</>)}
          </button>
          {starting && slowLoad && <p className="lz-hint" style={{ marginTop: 8 }}>(通常より時間がかかっています…)</p>}
        </div>
      ) : (
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18 }}>
            <span className="lz-pulse" />
            <span className="lz-muted" style={{ fontSize: 13 }}>録音中</span>
            <span className="lz-timer" style={{ marginLeft: 'auto' }}>
              {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
            </span>
          </div>
          <div style={{ marginBottom: 22 }}>
            <LevelMeter dbfs={level} deviceName={source === 'system' ? 'システム音声' : (micDevices.find((d) => d.deviceId === micDeviceId)?.label || 'マイク')} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="lz-danger-outline" onClick={stop} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, background: 'currentColor' }} />停止
            </button>
            {spanStartSec === null ? (
              <button disabled={quickTranscriptBusy} onClick={() => setSpanStartSec(elapsedSec)} title={quickTranscriptBusy ? '別の生成が進行中です' : undefined}>
                クイック字幕 開始
              </button>
            ) : (
              <button onClick={() => { onQuickTranscript(spanStartSec, elapsedSec); setSpanStartSec(null); }}>
                クイック字幕 停止 ({Math.max(0, elapsedSec - spanStartSec)}秒)
              </button>
            )}
          </div>
        </div>
      )}

      {!running && !starting && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', margin: '4px 0 6px' }}>
            <p className="lz-label" style={{ margin: 0 }}>履歴</p>
            <button className="lz-icon-btn" onClick={onOpenTerms} style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--lz-text-2)' }}>用語集 ›</button>
          </div>
          <HistoryList dumps={dumps} onOpen={onOpenHistory} />
        </>
      )}
    </section>
  );
}
