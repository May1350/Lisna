import type { DumpSummary } from '@shared/ipc-protocol';

/**
 * F2 history viewer — list of past finalize dumps, shown in the idle
 * Recording view. Pure/presentational (static-markup testable); the parent
 * fetches via window.lisna.listDumps(). Work-surface rules: tokens only,
 * no decoration (web-design.md scope-boundary).
 *
 * Empty list: renders the section with a quiet placeholder line per spec §4
 * ("まだ履歴がありません") — NOT null. Returning null hides the section
 * entirely, which is spec-wrong; the heading should be present for orientation.
 */
interface Props {
  dumps: DumpSummary[];
  onOpen: (id: string) => void;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatRecordedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function HistoryList({ dumps, onOpen }: Props) {
  if (dumps.length === 0) {
    return (
      <div data-testid="history-section">
        <p className="lz-hint">まだ履歴がありません</p>
      </div>
    );
  }
  return (
    <div data-testid="history-section" className="lz-list">
      {dumps.map((d) =>
        d.unreadable ? (
          <div key={d.id} className="lz-row" style={{ cursor: 'default' }}>
            <div className="lz-row-main">
              <div className="lz-row-title lz-muted">{formatRecordedAt(d.recordedAt)}</div>
              <div className="lz-row-meta">読み込み不可</div>
            </div>
          </div>
        ) : (
          <div
            key={d.id}
            className="lz-row"
            data-testid={`history-row-${d.id}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(d.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(d.id); }}
          >
            <div className="lz-row-main">
              <div className="lz-row-title">
                {d.family ? d.family : '文字起こし'}
                {d.ok === false ? ' · 失敗' : ''}
              </div>
              <div className="lz-row-meta">
                {formatDuration(d.durationSec ?? 0)} · {d.language ?? '?'} · {formatRecordedAt(d.recordedAt)}
              </div>
            </div>
            <span className="lz-row-chev" aria-hidden="true">›</span>
          </div>
        ),
      )}
    </div>
  );
}
