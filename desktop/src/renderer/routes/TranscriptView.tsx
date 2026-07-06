import { useState } from 'react';
import type { TranscriptSegment } from '@shared/types';
import { transcriptToText } from '@shared/note-export';
import { CopyExportButtons } from '../components/CopyExportButtons';
import { GlossaryAdded } from '../components/GlossaryAdded';
import { autoRegisterGlossaryFromEdit } from '../lib/glossary-auto';

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
  const [addedTerms, setAddedTerms] = useState<string[]>([]);

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
      // Proper-noun corrections → auto-register them to the glossary (biases the
      // next recording's STT toward the fixed spelling). Best-effort: a
      // glossary-read/write failure must not turn a successful save into an error.
      try {
        const pairs = local
          .map((s, i) => ({ before: segments[i]?.text ?? '', after: s.text }))
          .filter((p) => p.before !== p.after);
        const added = await autoRegisterGlossaryFromEdit(pairs, {
          getGlossary: window.lisna.getGlossary,
          setGlossary: window.lisna.setGlossary,
        });
        setAddedTerms(added);
      } catch { /* best-effort — helper already swallows, this guards the pairs build */ }
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setLocal(segments);
    setEditing(false);
  }

  return (
    <section className="lz-pad" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>文字起こし</h2>
      <p className="lz-hint" style={{ marginBottom: 16 }}>
        {local.length} セグメント{durationSec != null ? ` · ${fmt(durationSec)}` : ''} · {language}
        {editing && <span style={{ color: 'var(--lz-accent)' }}> · 編集中</span>}
      </p>
      <ul className="lz-scroll lz-scroll--plain" data-lz-scroll style={{ listStyle: 'none', margin: 0 }}>
        {local.map((seg, i) => (
          <li key={i} style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="lz-ts" style={{ flex: '0 0 auto', paddingTop: editing ? 8 : 3 }}>{fmt(seg.startSec)}</span>
            {editing ? (
              <textarea
                value={seg.text}
                onChange={(e) => setText(i, e.target.value)}
                aria-label={`セグメント ${fmt(seg.startSec)} を編集`}
                rows={1}
                data-lz-scroll
                style={{ flex: 1, resize: 'vertical', minHeight: '1.7em' }}
              />
            ) : (
              <span className="lz-read-p">{seg.text}</span>
            )}
          </li>
        ))}
      </ul>
      {!editing && addedTerms.length > 0 && <GlossaryAdded added={addedTerms} onClose={() => setAddedTerms([])} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        {editing ? (
          <>
            <button className="lz-primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={cancel} disabled={saving}>キャンセル</button>
          </>
        ) : (
          <>
            {dumpId != null && (
              <button data-testid="transcript-edit" onClick={() => setEditing(true)}>編集</button>
            )}
            <CopyExportButtons getText={() => transcriptToText(local)} exportName="transcript.txt" />
            <button data-testid="transcript-new-session" onClick={onNewSession}>新しい録音</button>
          </>
        )}
      </div>
    </section>
  );
}
