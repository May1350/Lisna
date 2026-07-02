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

/** mm:ss from seconds (readable timestamp, replaces raw "12.3"). */
function fmtTs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** The dump-dir id is an ISO stamp with ':'/'.' replaced by '-'. Reconstruct
 *  it to a readable locale date; fall back to the raw id if parsing fails. */
function fmtDate(id: string): string {
  const iso = id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, 'T$1:$2:$3.$4Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? id : d.toLocaleString();
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
    <section className="lz-pad" style={{ maxWidth: 760, margin: '0 auto' }} data-testid="history-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button data-testid="history-back" onClick={onBack} disabled={editing}>← 戻る</button>
        <h2 style={{ margin: 0 }}>録音履歴</h2>
        {editing && <span style={{ color: 'var(--lz-accent)', fontSize: 12 }}>編集中</span>}
        {!editing && (
          <button data-testid="transcript-edit" onClick={() => setEditing(true)} style={{ marginLeft: 'auto' }}>
            字幕を編集
          </button>
        )}
      </div>
      <p className="lz-hint" style={{ marginBottom: 14 }}>
        {fmtDate(id)} · {transcript.language} · {local.length}件
      </p>
      <div className="lz-scroll" style={{ marginBottom: 16 }}>
        {local.map((seg, i) => (
          <div key={i} className="lz-tline">
            <span className="lz-ts">{fmtTs(seg.startSec)}</span>
            {editing ? (
              <textarea
                value={seg.text}
                onChange={(e) => setText(i, e.target.value)}
                aria-label={`セグメント ${fmtTs(seg.startSec)} を編集`}
                rows={1}
                style={{ flex: 1, resize: 'vertical', minHeight: '1.7em' }}
              />
            ) : (
              <span className="txt">{seg.text}</span>
            )}
          </div>
        ))}
      </div>
      {editing ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="lz-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={cancel} disabled={saving}>キャンセル</button>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--lz-line)', marginTop: 4, paddingTop: 6 }}>
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
        </div>
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
