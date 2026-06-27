import { useState } from 'react';
import type { TranscriptSegment } from '@shared/types';
import { transcriptToText } from '@shared/note-export';
import { CopyExportButtons } from '../components/CopyExportButtons';

interface Props {
  segments: TranscriptSegment[];
  language: string;
  durationSec?: number;
  /** Dump dir id this transcript persists to. When absent (dumps disabled),
   *  the transcript is view-only — no 編集 affordance. */
  dumpId?: string;
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
 * Shows the verbatim segments subtitle-style, no LLM note. When a `dumpId` is
 * present, segment TEXT is editable in-place and persisted to the session's
 * transcript.json (the user-correction loop). Function-first styling per
 * web-design.md scope boundary — no legal-pad decoration. JA-locked copy.
 */
export function TranscriptView({ segments, language, durationSec, dumpId, onNewSession }: Props) {
  const [local, setLocal] = useState<TranscriptSegment[]>(segments);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  function setText(i: number, text: string) {
    setLocal((prev) => prev.map((s, j) => (j === i ? { ...s, text } : s)));
  }

  async function save() {
    if (!dumpId) return;
    setSaving(true);
    try {
      await window.lisna.saveTranscript(
        dumpId,
        local.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })),
      );
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setLocal(segments);
    setEditing(false);
  }

  return (
    <section>
      <h2>文字起こし</h2>
      <p style={{ color: '#666', fontSize: 13 }}>
        {local.length} 個のセグメント{durationSec != null ? ` · ${fmt(durationSec)}` : ''} · {language}
        {editing && <span style={{ color: '#c8333a' }}> · 編集中</span>}
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
        {local.map((seg, i) => (
          <li key={i} style={{ marginBottom: '0.25em', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ color: '#999', flex: '0 0 auto', paddingTop: editing ? 6 : 0 }}>[{fmt(seg.startSec)}]</span>
            {editing ? (
              <textarea
                value={seg.text}
                onChange={(e) => setText(i, e.target.value)}
                aria-label={`セグメント ${fmt(seg.startSec)} を編集`}
                rows={1}
                style={{
                  flex: 1, font: 'inherit', padding: '4px 6px', border: '1px solid #ccc',
                  borderRadius: 4, resize: 'vertical', minHeight: '1.6em',
                }}
              />
            ) : (
              <span>{seg.text}</span>
            )}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        {editing ? (
          <>
            <button onClick={() => void save()} disabled={saving} style={{ padding: '8px 16px', fontSize: 14 }}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={cancel} disabled={saving} style={{ padding: '8px 16px', fontSize: 14 }}>
              キャンセル
            </button>
          </>
        ) : (
          <>
            {dumpId != null && (
              <button
                data-testid="transcript-edit"
                onClick={() => setEditing(true)}
                style={{ padding: '8px 16px', fontSize: 14 }}
              >
                編集
              </button>
            )}
            <CopyExportButtons getText={() => transcriptToText(local)} exportName="transcript.txt" />
            <button
              data-testid="transcript-new-session"
              onClick={onNewSession}
              style={{ padding: '8px 16px', fontSize: 14 }}
            >
              新しい録音
            </button>
          </>
        )}
      </div>
    </section>
  );
}
