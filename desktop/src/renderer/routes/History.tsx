import { useEffect, useState } from 'react';
import type { DumpTranscript } from '@shared/ipc-protocol';
import type { NoteFamily } from '@shared/note-schema';
import { FamilyPickerStep } from '../components/FamilyPickerStep';
import { Spinner } from '../components/Spinner';
import { toFriendlyJa } from '../i18n/error-message-map';

/**
 * F2 history viewer — detail route. Read-only transcript + family picker +
 * regenerate (spec section 4). The picker's 続行 fires onRegenerate; its
 * built-in `submitting` guard gives double-fire protection (review P1-1
 * renderer leg). ノートを作らずに戻る doubles as back.
 */
interface DetailProps {
  id: string;
  transcript: DumpTranscript;
  onBack: () => void;
  onRegenerate: (family: NoteFamily) => void;
}

/** Pure detail view — exported for static-markup tests. Transcript text is
 *  editable in-place (persists to the dump's transcript.json, same loop as the
 *  live TranscriptView). Mounted with `key={id}` so the edit state is fresh per
 *  recording. Edit logic is intentionally inline (2nd call site after
 *  TranscriptView — inline per the no-premature-abstraction rule). */
export function HistoryDetail({ id, transcript, onBack, onRegenerate }: DetailProps) {
  const [local, setLocal] = useState(transcript.segments);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  function setText(i: number, text: string) {
    setLocal((prev) => prev.map((s, j) => (j === i ? { ...s, text } : s)));
  }
  async function save() {
    setSaving(true);
    try {
      await window.lisna.saveTranscript(
        id,
        local.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })),
      );
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  function cancel() { setLocal(transcript.segments); setEditing(false); }

  return (
    <section data-testid="history-detail">
      <button data-testid="history-back" onClick={onBack} disabled={editing}>← 戻る</button>
      <h2>録音履歴</h2>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        {id} · {transcript.language} · {local.length} segments · {transcript.llmModel}
        {editing && <span style={{ color: '#c8333a' }}> · 編集中</span>}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '40vh', overflowY: 'auto' }}>
        {local.map((seg, i) => (
          <li key={i} style={{ fontFamily: 'monospace', marginBottom: '0.25em', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ flex: '0 0 auto', paddingTop: editing ? 6 : 0 }}>[{seg.startSec.toFixed(1)}]</span>
            {editing ? (
              <textarea
                value={seg.text}
                onChange={(e) => setText(i, e.target.value)}
                aria-label={`セグメント ${seg.startSec.toFixed(1)} を編集`}
                rows={1}
                style={{ flex: 1, font: 'inherit', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, resize: 'vertical', minHeight: '1.6em' }}
              />
            ) : (
              <span>{seg.text}</span>
            )}
          </li>
        ))}
      </ul>
      {editing ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => void save()} disabled={saving} style={{ padding: '8px 16px' }}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={cancel} disabled={saving} style={{ padding: '8px 16px' }}>キャンセル</button>
        </div>
      ) : (
        <>
          <button data-testid="transcript-edit" onClick={() => setEditing(true)} style={{ padding: '8px 16px', marginBottom: 12 }}>
            字幕を編集
          </button>
          <FamilyPickerStep
            // Regenerate-from-dump only produces NOTES. The raw transcript is
            // already shown above, so the 文字起こし choice is hidden here; the
            // narrowing guard stays as a defensive no-op.
            showTranscript={false}
            onPick={(choice) => {
              if (choice !== 'transcript') onRegenerate(choice);
            }}
            onDiscard={onBack}
          />
        </>
      )}
    </section>
  );
}

interface Props {
  id: string;
  onBack: () => void;
  onRegenerate: (family: NoteFamily) => void;
}

/** Container: fetches the dump transcript, then renders HistoryDetail. */
export function History({ id, onBack, onRegenerate }: Props) {
  const [transcript, setTranscript] = useState<DumpTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.lisna
      .loadDump(id)
      .then((t) => { if (active) setTranscript(t); })
      .catch((err) => { if (active) setError(String((err as Error)?.message ?? err)); });
    return () => { active = false; };
  }, [id]);

  if (error) {
    // Raw contract codes (DUMP_NOT_FOUND etc.) must never reach the user —
    // resolve through the same JA map as ErrorView / ModelPickerStep.
    return (
      <section data-testid="history-detail-error">
        <p>{toFriendlyJa(error)}</p>
        <button onClick={onBack}>← 戻る</button>
      </section>
    );
  }
  if (!transcript) {
    return (
      <section>
        <Spinner /> 読み込み中…
      </section>
    );
  }
  return <HistoryDetail key={id} id={id} transcript={transcript} onBack={onBack} onRegenerate={onRegenerate} />;
}
