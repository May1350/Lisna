import { useState } from 'react';
import type { NoteFamily } from '@shared/note-schema';

/**
 * Family picker shown after Stop is clicked, before finalize runs.
 *
 * Lists all four note families. Lecture + Meeting + Interview +
 * Brainstorm are all enabled. Renderers for each are registered as
 * side-effect imports in `main.tsx`; cores are registered on the
 * orchestrator side (see `session-finalize.ts`).
 *
 * State is local: user picks a family, then clicks 続行 to commit.
 * Default selection is Lecture (the alpha-supported, single-speaker
 * primary case).
 */
/** Output-mode choice: one of the 4 note families, or LLM-free raw transcript. */
type PickChoice = NoteFamily | 'transcript';

const FAMILIES: ReadonlyArray<{
  id: PickChoice;
  label: string;
  desc: string;
  disabled: boolean;
}> = [
  {
    id: 'lecture',
    label: '講義 (Lecture)',
    desc: '単一話者・章立て・key_terms',
    disabled: false,
  },
  {
    id: 'meeting',
    label: 'ミーティング (Meeting)',
    desc: '決定事項・アクション・参加者',
    disabled: false,
  },
  {
    id: 'interview',
    label: 'インタビュー (Interview)',
    desc: 'Q/A・テーマ・引用',
    disabled: false,
  },
  {
    id: 'brainstorm',
    label: 'ブレスト (Brainstorm)',
    desc: 'アイデア・クラスタ',
    disabled: false,
  },
];

/**
 * Raw-transcript output mode (STT Phase 2, 2026-06-19). NOT a note family —
 * an LLM-free output format. Rendered set apart from the 4 families below the
 * 「またはノートにせず」 caption.
 */
const TRANSCRIPT_OPTION = {
  id: 'transcript' as const,
  label: '文字起こし (Transcript)',
  desc: '録音をそのまま字幕で表示（ノート生成なし）',
  disabled: false,
};

interface Props {
  onPick: (choice: NoteFamily | 'transcript') => void;
  /** Discard route (2026-06-10): drop the session without a note and return
   *  to Recording. Wired to `session/discard` by the parent. */
  onDiscard: () => void;
  /** Show the 文字起こし (raw transcript) output choice. False in the
   *  history-regenerate picker, where the transcript is already displayed and
   *  regenerate produces notes only. */
  showTranscript?: boolean;
}

export function FamilyPickerStep({ onPick, onDiscard, showTranscript = true }: Props) {
  const [selected, setSelected] = useState<PickChoice>('lecture');
  // In-flight guard. Click-then-click would otherwise call onPick twice; the
  // parent's prev.kind FSM guard short-circuits the second state transition
  // but the underlying window.lisna.finalize would still fire twice — two
  // concurrent generate streams over one sidecar, ~30-120 s of wasted LLM.
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(): void {
    if (submitting) return;
    setSubmitting(true);
    onPick(selected);
  }

  const renderOption = (f: { id: PickChoice; label: string; desc: string; disabled: boolean }) => (
    <label
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        cursor: f.disabled ? 'not-allowed' : 'pointer',
        opacity: f.disabled ? 0.55 : 1,
      }}
    >
      <input
        type="radio"
        name="family"
        value={f.id}
        checked={selected === f.id}
        disabled={f.disabled}
        onChange={() => setSelected(f.id)}
        data-testid={`family-radio-${f.id}`}
      />
      <span>
        <strong>{f.label}</strong>
        <div style={{ color: '#666', fontSize: 13 }}>{f.desc}</div>
        {f.disabled && <small style={{ color: '#999' }}>(coming soon)</small>}
      </span>
    </label>
  );

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }} data-testid="family-picker">
      <h2 style={{ marginTop: 0 }}>このセッションの種類は?</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {FAMILIES.map((f) => (
          <li key={f.id} style={{ marginBottom: 12 }}>
            {renderOption(f)}
          </li>
        ))}
      </ul>
      {/* Transcript output mode, set apart from the 4 note "types" — it's an
          output format, not a session type. Hidden in the history-regenerate
          picker (showTranscript=false): the dump transcript is already shown
          and regenerate only produces notes. */}
      {showTranscript && (
        <div style={{ borderTop: '1px solid #ddd', paddingTop: 12, marginTop: 4 }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>またはノートにせず</div>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li style={{ marginBottom: 12 }}>{renderOption(TRANSCRIPT_OPTION)}</li>
          </ul>
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        data-testid="family-continue"
        style={{ padding: '8px 16px', fontSize: 14, marginTop: 8 }}
      >
        続行
      </button>
      <button
        onClick={onDiscard}
        disabled={submitting}
        data-testid="family-discard"
        style={{
          padding: '8px 16px',
          fontSize: 14,
          marginTop: 8,
          marginLeft: 12,
          background: 'transparent',
          color: '#666',
          border: '1px solid #ccc',
          borderRadius: 4,
        }}
      >
        ノートを作らずに戻る
      </button>
    </div>
  );
}
