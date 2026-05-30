/**
 * Progress UI shown while session/finalize runs. The orchestrator's
 * chunked pipeline can take ~30-120 s on cold-cache 3B + 20 chunks,
 * so the renderer needs a non-spinner state that conveys "I'm
 * working through chunks" and (eventually) per-chunk progress.
 *
 * Today this is a coarse phase indicator (loading / chunk / merge /
 * persist). Orchestrator.finalizeLecture has an onProgress callback
 * surface — wiring per-chunk events through the IPC is a follow-up
 * (see HANDOFF P2 retry-counter item).
 */

export type ProgressPhase = 'loading' | 'chunk' | 'merge' | 'persist';

export interface ProgressState {
  phase: ProgressPhase;
  /** 0-based chunk index when phase==='chunk'. */
  chunkIndex?: number;
  /** Total chunks when phase==='chunk'. */
  totalChunks?: number;
}

interface Props {
  progress: ProgressState | null;
}

export function NoteRenderProgress({ progress }: Props) {
  if (!progress) return null;

  const wrap = {
    maxWidth: 560,
    margin: '0 auto',
    padding: 24,
    fontFamily: 'system-ui',
  } as const;

  if (progress.phase === 'loading') {
    return (
      <div style={wrap} data-testid="progress-loading">
        <p>モデルを読み込み中... (初回は最大 30 秒ほどかかります)</p>
      </div>
    );
  }
  if (progress.phase === 'chunk') {
    const { chunkIndex, totalChunks } = progress;
    const valid = typeof chunkIndex === 'number' && typeof totalChunks === 'number' && totalChunks > 0;
    const pct = valid ? Math.min(100, Math.round(((chunkIndex + 1) / totalChunks) * 100)) : 0;
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
            ? `チャンク ${chunkIndex + 1} / ${totalChunks} を処理中...`
            : 'チャンクを処理中...'}
        </p>
      </div>
    );
  }
  if (progress.phase === 'merge') {
    return (
      <div style={wrap} data-testid="progress-merge">
        <p>チャンクをマージ中...</p>
      </div>
    );
  }
  // phase === 'persist'
  return (
    <div style={wrap} data-testid="progress-persist">
      <p>保存中...</p>
    </div>
  );
}
