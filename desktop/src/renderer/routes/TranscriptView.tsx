import type { TranscriptSegment } from '@shared/types';

interface Props {
  segments: TranscriptSegment[];
  language: string;
  durationSec?: number;
  onNewSession: () => void;
}

/** m:ss from seconds. */
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Raw whole-WAV transcript view (STT Phase 2 — "文字起こし" picker choice).
 * Shows the verbatim segments subtitle-style, no LLM note. Function-first
 * styling per web-design.md scope boundary (this is the work surface), so
 * inline styles like ErrorView.tsx — no legal-pad / .postit / .pencil
 * decoration. JA-locked copy per v2.0 concept-lock (ErrorView.tsx header note).
 */
export function TranscriptView({ segments, language, durationSec, onNewSession }: Props) {
  return (
    <section>
      <h2>文字起こし</h2>
      <p style={{ color: '#666', fontSize: 13 }}>
        {segments.length} 個のセグメント{durationSec != null ? ` · ${fmt(durationSec)}` : ''} · {language}
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          fontFamily: 'monospace',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {segments.map((seg, i) => (
          <li key={i} style={{ marginBottom: '0.25em' }}>
            <span style={{ color: '#999' }}>[{fmt(seg.startSec)}]</span> {seg.text}
          </li>
        ))}
      </ul>
      <button
        data-testid="transcript-new-session"
        onClick={onNewSession}
        style={{ padding: '8px 16px', fontSize: 14, marginTop: 8 }}
      >
        新しい録音
      </button>
    </section>
  );
}
