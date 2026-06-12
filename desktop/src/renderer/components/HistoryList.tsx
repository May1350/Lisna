import type { DumpSummary } from '@shared/ipc-protocol';

/**
 * F2 history viewer — list of past finalize dumps, shown in the idle
 * Recording view. Pure/presentational (static-markup testable); the parent
 * fetches via window.lisna.listDumps(). Work-surface rules: tokens only,
 * no decoration (web-design.md scope-boundary).
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
  if (dumps.length === 0) return null;
  return (
    <div data-testid="history-section">
      <h3>History</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {dumps.map((d) => (
          <li key={d.id} style={{ marginBottom: '0.25em' }}>
            {d.unreadable ? (
              <span style={{ color: '#999' }}>
                {formatRecordedAt(d.recordedAt)} — 読み込み不可
              </span>
            ) : (
              <button
                data-testid={`history-row-${d.id}`}
                onClick={() => onOpen(d.id)}
                style={{
                  background: 'transparent',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {formatRecordedAt(d.recordedAt)} · {formatDuration(d.durationSec ?? 0)} ·{' '}
                {d.language ?? '?'}
                {d.family ? ` · ${d.family}` : ''}
                {d.ok === true ? ' · ✓' : d.ok === false ? ' · 失敗' : ''}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
