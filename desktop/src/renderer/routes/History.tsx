import { useEffect, useState } from 'react';
import type { DumpTranscript } from '@shared/ipc-protocol';
import type { NoteFamily } from '@shared/note-schema';
import type { TranscriptSegment } from '@shared/types';
import { FamilyPickerStep } from '../components/FamilyPickerStep';
import { Spinner } from '../components/Spinner';

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
  onRegenerate: (family: NoteFamily, segments: TranscriptSegment[]) => void;
}

/** Pure detail view — exported for static-markup tests. */
export function HistoryDetail({ id, transcript, onBack, onRegenerate }: DetailProps) {
  return (
    <section data-testid="history-detail">
      <button data-testid="history-back" onClick={onBack}>← 戻る</button>
      <h2>録音履歴</h2>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        {id} · {transcript.language} · {transcript.segments.length} segments · {transcript.llmModel}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '40vh', overflowY: 'auto' }}>
        {transcript.segments.map((seg, i) => (
          <li key={i} style={{ fontFamily: 'monospace', marginBottom: '0.25em' }}>
            [{seg.startSec.toFixed(1)}] {seg.text}
          </li>
        ))}
      </ul>
      <FamilyPickerStep
        onPick={(family) => onRegenerate(family, transcript.segments)}
        onDiscard={onBack}
      />
    </section>
  );
}

interface Props {
  id: string;
  onBack: () => void;
  onRegenerate: (family: NoteFamily, segments: TranscriptSegment[]) => void;
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
    return (
      <section data-testid="history-detail-error">
        <p>履歴を読み込めませんでした ({error})</p>
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
  return <HistoryDetail id={id} transcript={transcript} onBack={onBack} onRegenerate={onRegenerate} />;
}
