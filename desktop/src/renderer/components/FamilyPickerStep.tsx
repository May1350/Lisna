import { useState } from 'react';
import type { NoteFamily } from '@shared/note-schema';
import { languageCapabilities } from '@shared/language-capabilities';
import { TARGET_PICKER_STRINGS_JA as T } from '../i18n/connector-strings';

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
 *
 * Task 9 (spec section 4 step 3) adds a generation-target axis, orthogonal to the
 * family choice: when the Claude connector is connected, a segmented
 * control (Claude preselected) lets the user pick 'claude' | 'ondevice'.
 * When not connected, no control is shown and every pick resolves to
 * 'ondevice' — plus a dismissible upsell banner points at Settings.
 */
/** Output-mode choice: one of the 4 note families, or LLM-free raw transcript. */
type PickChoice = NoteFamily | 'transcript';

/** Generation target — which pipeline produces the note (Task 6/9). Exported
 *  for reuse at the App.tsx / History.tsx call sites (3+ sites: this Props
 *  type, BackgroundJob.target, and the two onRegenerate/runFinalize params). */
export type GenerationTarget = 'ondevice' | 'claude';

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

/** localStorage key for the upsell-dismissal flag — mirrors App.tsx's
 *  'lisna.audioNoticeAck' once-only-ack pattern, scoped to this device. */
export const CLAUDE_UPSELL_DISMISSED_KEY = 'lisna.claudeUpsellDismissed';

/**
 * Resolves the effective generation target sent with onPick. Not connected ⇒
 * always 'ondevice' regardless of `selected` — the segmented control that
 * would produce a 'claude' selection isn't even rendered in that state, so
 * this is also the defensive floor if `selected` were ever stale. Pure
 * (exported for tests — no DOM env in this package's vitest config).
 */
export function resolveGenerationTarget(connectorConnected: boolean, selected: GenerationTarget): GenerationTarget {
  return connectorConnected ? selected : 'ondevice';
}

/**
 * Upsell-banner visibility predicate: shown only when not connected AND not
 * previously dismissed on this device. Pure (exported for tests).
 */
export function shouldShowClaudeUpsell(connectorConnected: boolean, dismissed: boolean): boolean {
  return !connectorConnected && !dismissed;
}

/**
 * Persists the upsell-dismissal flag. Takes an injectable storage (rather
 * than reading the `localStorage` global directly) so the ✕ button's
 * persistence behavior is unit-testable without a DOM env — mirrors
 * ConnectorView.tsx's injectable `ConnectorLisnaClient` pattern.
 */
export function persistClaudeUpsellDismissed(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(CLAUDE_UPSELL_DISMISSED_KEY, '1');
}

interface Props {
  onPick: (choice: PickChoice, target: GenerationTarget) => void;
  /** Discard route (2026-06-10): drop the session without a note and return
   *  to Recording. Wired to `session/discard` by the parent. */
  onDiscard: () => void;
  /** Show the 文字起こし (raw transcript) output choice. False in the
   *  history-regenerate picker, where the transcript is already displayed and
   *  regenerate produces notes only. */
  showTranscript?: boolean;
  /** Recording language code (e.g. 'ja', 'ko'). When the language does not
   *  support notes (ko Phase 1), only the transcript option is shown. */
  language?: string;
  /** Whether the user has an active Claude connector (Task 8/9). Gates the
   *  target segmented control (connected) vs. the upsell banner (not). */
  connectorConnected: boolean;
  /** Opens the connector settings view — fired by the upsell banner's 設定 link. */
  onOpenConnector: () => void;
}

export function FamilyPickerStep({
  onPick,
  onDiscard,
  showTranscript = true,
  language = 'ja',
  connectorConnected,
  onOpenConnector,
}: Props) {
  const notesAllowed = languageCapabilities(language).notes;
  const [selected, setSelected] = useState<PickChoice>(notesAllowed ? 'lecture' : 'transcript');
  // In-flight guard. Click-then-click would otherwise call onPick twice; the
  // parent's prev.kind FSM guard short-circuits the second state transition
  // but the underlying window.lisna.finalize would still fire twice — two
  // concurrent generate streams over one sidecar, ~30-120 s of wasted LLM.
  const [submitting, setSubmitting] = useState(false);
  // Claude preselected when connected (spec section 4 step 3). Irrelevant when not
  // connected — resolveGenerationTarget forces 'ondevice' regardless.
  const [target, setTarget] = useState<GenerationTarget>(connectorConnected ? 'claude' : 'ondevice');
  const [upsellDismissed, setUpsellDismissed] = useState(
    () => localStorage.getItem(CLAUDE_UPSELL_DISMISSED_KEY) === '1',
  );

  function handleSubmit(): void {
    if (submitting) return;
    setSubmitting(true);
    onPick(selected, resolveGenerationTarget(connectorConnected, target));
  }

  function dismissUpsell(): void {
    persistClaudeUpsellDismissed(localStorage);
    setUpsellDismissed(true);
  }

  const renderOption = (f: { id: PickChoice; label: string; desc: string; disabled: boolean }) => (
    <label
      className={`lz-row lz-choice${selected === f.id && !f.disabled ? ' default' : ''}`}
      style={{ marginBottom: 8, cursor: f.disabled ? 'not-allowed' : 'pointer', opacity: f.disabled ? 0.55 : 1 }}
    >
      <input
        type="radio"
        name="family"
        value={f.id}
        checked={selected === f.id}
        disabled={f.disabled}
        onChange={() => setSelected(f.id)}
        data-testid={`family-radio-${f.id}`}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
      <div className="lz-row-main">
        <div className="lz-row-title">{f.label}</div>
        <div className="lz-row-meta">{f.desc}</div>
        {f.disabled && <div className="lz-hint">(coming soon)</div>}
      </div>
      {selected === f.id && !f.disabled && (
        <span style={{ color: 'var(--lz-accent)', fontSize: 17 }} aria-hidden="true">→</span>
      )}
    </label>
  );

  return (
    <div className="lz-pad" style={{ maxWidth: 480, margin: '0 auto' }} data-testid="family-picker">
      <h2 style={{ marginBottom: 4 }}>このセッションの種類は?</h2>
      <p className="lz-hint" style={{ marginBottom: 16 }}>録音からノートを生成します。</p>
      {notesAllowed && <div>{FAMILIES.map((f) => <div key={f.id}>{renderOption(f)}</div>)}</div>}
      {!notesAllowed && (
        <p className="lz-muted" style={{ fontSize: 13 }}>
          この言語では文字起こしのみ対応しています（ノート生成は近日対応 / coming soon）。
        </p>
      )}
      {shouldShowClaudeUpsell(connectorConnected, upsellDismissed) && (
        <div
          data-testid="claude-upsell"
          role="region"
          aria-label="Claude連携のご案内"
          style={{
            position: 'relative',
            marginTop: 14,
            padding: '10px 34px 10px 14px',
            border: '1px solid var(--lz-border)',
            borderRadius: 'var(--lz-radius)',
            background: 'var(--lz-surface)',
          }}
        >
          <button
            className="lz-icon-btn"
            style={{ position: 'absolute', top: 4, right: 4 }}
            onClick={dismissUpsell}
            aria-label={T.upsellClose}
            data-testid="claude-upsell-close"
          >
            ✕
          </button>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--lz-text-2)' }}>
            {T.upsellText}{' '}
            <button
              onClick={onOpenConnector}
              style={{ background: 'transparent', border: 0, color: 'var(--lz-accent)', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              data-testid="claude-upsell-open"
            >
              {T.upsellLink}
            </button>
          </p>
        </div>
      )}
      {(showTranscript || !notesAllowed) && (
        <div style={{ borderTop: '1px solid var(--lz-line)', paddingTop: 14, marginTop: 10 }}>
          {notesAllowed && <div className="lz-label" style={{ marginBottom: 8 }}>またはノートにせず</div>}
          {renderOption(TRANSCRIPT_OPTION)}
        </div>
      )}
      {connectorConnected && (
        <fieldset className="lz-seg" style={{ marginTop: 14 }} data-testid="target-seg">
          <legend>{T.segLabel}</legend>
          <label>
            <input
              type="radio"
              name="target"
              value="claude"
              checked={target === 'claude'}
              onChange={() => setTarget('claude')}
              data-testid="target-radio-claude"
            />
            {T.claudeOption}
          </label>
          <label>
            <input
              type="radio"
              name="target"
              value="ondevice"
              checked={target === 'ondevice'}
              onChange={() => setTarget('ondevice')}
              data-testid="target-radio-ondevice"
            />
            {T.ondeviceOption}
          </label>
        </fieldset>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="lz-primary" onClick={handleSubmit} disabled={submitting} data-testid="family-continue">
          続行
        </button>
        <button onClick={onDiscard} disabled={submitting} data-testid="family-discard">
          ノートを作らずに戻る
        </button>
      </div>
    </div>
  );
}
