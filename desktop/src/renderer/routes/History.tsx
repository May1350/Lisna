import { useEffect, useState } from 'react';
import type { DumpTranscript } from '@shared/ipc-protocol';
import type { NoteFamily } from '@shared/note-schema';
import { FamilyPickerStep, type GenerationTarget } from '../components/FamilyPickerStep';
import { Spinner } from '../components/Spinner';
import { GlossaryAdded } from '../components/GlossaryAdded';
import { EditableTitle } from '../components/EditableTitle';
import { autoRegisterGlossaryFromEdit } from '../lib/glossary-auto';
import { toFriendlyJa } from '../i18n/error-message-map';
import { ORIGIN_LABEL_JA } from '../i18n/connector-strings';

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
  onRegenerate: (family: NoteFamily, target: GenerationTarget) => void;
  /** Whether the user has an active Claude connector (Task 9) — threaded to
   *  the embedded FamilyPickerStep's target picker / upsell banner. */
  connectorConnected: boolean;
  onOpenConnector: () => void;
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
export function HistoryDetail({ id, transcript, onBack, onRegenerate, connectorConnected, onOpenConnector }: DetailProps) {
  const [local, setLocal] = useState(transcript.segments);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addedTerms, setAddedTerms] = useState<string[]>([]);
  const [titleValue, setTitleValue] = useState(transcript.title ?? '');

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
      // Proper-noun corrections in this edit → auto-register them to the glossary
      // so the next recording's STT biases toward the fixed spelling. Best-effort:
      // a glossary-read/write failure must not turn a successful save into an error.
      try {
        const pairs = local
          .map((s, i) => ({ before: transcript.segments[i]?.text ?? '', after: s.text }))
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
  function cancel() { setLocal(transcript.segments); setEditing(false); }

  return (
    <section className="lz-pad" style={{ maxWidth: 760, margin: '0 auto' }} data-testid="history-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {/* In edit mode the back button is a dead end (edits pending) — hide it;
            the キャンセル button at the bottom is the way out. */}
        {!editing && <button data-testid="history-back" onClick={onBack}>← 戻る</button>}
        <EditableTitle
          value={titleValue}
          fallback={transcript.noteTitle ?? fmtDate(id)}
          onSave={(t) => { setTitleValue(t); void window.lisna.saveDumpTitle(id, t); }}
          style={{ fontSize: 20, fontWeight: 600, maxWidth: '60%' }}
        />
        {editing && <span style={{ color: 'var(--lz-accent)', fontSize: 12 }}>編集中</span>}
        {!editing && (
          <button data-testid="transcript-edit" onClick={() => setEditing(true)} style={{ marginLeft: 'auto' }}>
            字幕を編集
          </button>
        )}
      </div>
      <p className="lz-hint" style={{ marginBottom: 14 }}>
        {fmtDate(id)} · {transcript.language} · {local.length}件
        {/* Task 10 — origin badge, defensive: absent for dumps predating the field. */}
        {transcript.origin && <> · {ORIGIN_LABEL_JA[transcript.origin]}</>}
      </p>
      <div className="lz-scroll" data-lz-scroll style={{ marginBottom: 16 }}>
        {local.map((seg, i) => (
          <div key={i} className="lz-tline">
            <span className="lz-ts">{fmtTs(seg.startSec)}</span>
            {editing ? (
              <textarea
                value={seg.text}
                onChange={(e) => setText(i, e.target.value)}
                aria-label={`セグメント ${fmtTs(seg.startSec)} を編集`}
                rows={1}
                data-lz-scroll
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
        <>
          {addedTerms.length > 0 && <GlossaryAdded added={addedTerms} onClose={() => setAddedTerms([])} />}
          <div style={{ borderTop: '1px solid var(--lz-line)', marginTop: 4, paddingTop: 6 }}>
          <FamilyPickerStep
            // Regenerate-from-dump only produces NOTES. The raw transcript is
            // already shown above, so the 文字起こし choice is hidden here; the
            // narrowing guard stays as a defensive no-op.
            showTranscript={false}
            connectorConnected={connectorConnected}
            onOpenConnector={onOpenConnector}
            onPick={(choice, target) => {
              if (choice !== 'transcript') onRegenerate(choice, target);
            }}
            onDiscard={onBack}
          />
          </div>
        </>
      )}
    </section>
  );
}

interface Props {
  id: string;
  onBack: () => void;
  onRegenerate: (family: NoteFamily, target: GenerationTarget) => void;
  connectorConnected: boolean;
  onOpenConnector: () => void;
}

/** Container: fetches the dump transcript, then renders HistoryDetail. */
export function History({ id, onBack, onRegenerate, connectorConnected, onOpenConnector }: Props) {
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
    // resolve through the same JA map as ErrorView.
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
  return (
    <HistoryDetail
      key={id}
      id={id}
      transcript={transcript}
      onBack={onBack}
      onRegenerate={onRegenerate}
      connectorConnected={connectorConnected}
      onOpenConnector={onOpenConnector}
    />
  );
}
