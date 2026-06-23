/**
 * Progress UI shown while session/finalize runs. The orchestrator's
 * chunked pipeline can take minutes (up to ~13 min observed on long
 * recordings), so the renderer shows REAL work state — which chunk is
 * generating (N/M), the attempt counter when retrying, and elapsed time —
 * never simulated progress (founder constraint 2026-06-13).
 *
 * State arrives over CHANNELS.sessionFinalizeProgress: main's onTelemetry
 * forwards the orchestrator's attempt-start / chunk-done / finalize-done
 * events (App.tsx::applyFinalizeProgress folds them into ProgressState).
 * The elapsed line ticks renderer-side from `startedAt` — no IPC polling.
 */
import { useEffect, useState } from 'react';

export type ProgressPhase = 'loading' | 'transcribing' | 'chunk' | 'merge' | 'persist';

export interface ProgressState {
  phase: ProgressPhase;
  /** 0..100 STT progress when phase==='transcribing'. Absent until the first sttProgress event. */
  pct?: number;
  /** 0-based chunk index when phase==='chunk'. */
  chunkIndex?: number;
  /** Total chunks when phase==='chunk'. */
  totalChunks?: number;
  /** 1-indexed generation attempt within the current chunk (spans outer
   * fresh-seed blocks). ≥2 means the previous attempt failed → 再試行. */
  attempt?: number;
  /** Worst-case attempts per chunk (outer × inner retry budget). */
  attemptMax?: number;
  /** Renderer-clock epoch ms when finalize began — drives the elapsed line. */
  startedAt?: number;
}

interface Props {
  progress: ProgressState | null;
}

/** Seconds → "m:ss", or "h:mm:ss" from one hour. Negative clamps to 0:00. */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function NoteRenderProgress({ progress }: Props) {
  // Hooks stay above the null early-return (React hook-order rule). The 1 s
  // tick re-renders only the elapsed line; renderToStaticMarkup never runs
  // effects, so static tests stay deterministic via the useState initializer.
  const [now, setNow] = useState(() => Date.now());
  const ticking = progress?.startedAt !== undefined;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!progress) return null;

  const elapsed =
    progress.startedAt !== undefined
      ? ` · 経過 ${formatElapsed((now - progress.startedAt) / 1000)}`
      : '';

  const wrap = {
    maxWidth: 560,
    margin: '0 auto',
    padding: 24,
    fontFamily: 'system-ui',
  } as const;

  if (progress.phase === 'loading') {
    return (
      <div style={wrap} data-testid="progress-loading">
        <p>{`モデルを読み込み中... (初回は最大 30 秒ほどかかります)${elapsed}`}</p>
      </div>
    );
  }
  if (progress.phase === 'transcribing') {
    // Whole-file STT progress (STT Phase 2a). The bar is driven by the REAL
    // sttProgress pct forwarded from the sidecar — never a simulated bar. Until
    // the first progress event arrives, `pct` is undefined: show NO percent and
    // a 0% bar (no-fake-progress founder constraint).
    const { pct } = progress;
    const known = typeof pct === 'number';
    const clamped = known ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
    return (
      <div style={wrap} data-testid="progress-transcribing">
        <div
          style={{
            background: '#eee',
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: `${clamped}%`,
              height: '100%',
              background: '#6e1e1e',
              transition: 'width 200ms ease',
            }}
          />
        </div>
        <p>
          {known
            ? `音声を文字起こし中... ${clamped}%${elapsed}`
            : `音声を文字起こし中...${elapsed}`}
        </p>
      </div>
    );
  }
  if (progress.phase === 'chunk') {
    const { chunkIndex, totalChunks, attempt, attemptMax } = progress;
    const valid = typeof chunkIndex === 'number' && typeof totalChunks === 'number' && totalChunks > 0;
    const pct = valid ? Math.min(100, Math.round(((chunkIndex + 1) / totalChunks) * 100)) : 0;
    const retry =
      typeof attempt === 'number' && typeof attemptMax === 'number' && attempt >= 2
        ? ` · 再試行 ${attempt}/${attemptMax}`
        : '';
    return (
      <div style={wrap} data-testid="progress-chunk">
        <div
          style={{
            background: '#eee',
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: '#6e1e1e',
              transition: 'width 200ms ease',
            }}
          />
        </div>
        <p>
          {valid
            ? `チャンク ${chunkIndex + 1}/${totalChunks} を生成中...${retry}${elapsed}`
            : `チャンクを生成中...${retry}${elapsed}`}
        </p>
      </div>
    );
  }
  if (progress.phase === 'merge') {
    return (
      <div style={wrap} data-testid="progress-merge">
        <p>{`チャンクをマージ中...${elapsed}`}</p>
      </div>
    );
  }
  // phase === 'persist'
  return (
    <div style={wrap} data-testid="progress-persist">
      <p>{`保存中...${elapsed}`}</p>
    </div>
  );
}
