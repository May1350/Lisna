import { useState, useRef, useEffect, type KeyboardEvent, type CSSProperties } from 'react';

interface Props {
  /** Persisted user title (editable). '' = untitled → the fallback shows. */
  value: string;
  /** Shown (as the effective name) when `value` is empty — e.g. the note's
   *  auto title or the date. Also the input placeholder while editing. */
  fallback: string;
  /** Persist a new title ('' clears it). */
  onSave: (next: string) => void | Promise<void>;
  className?: string;
  style?: CSSProperties;
  /** In a clickable list row: stop clicks/keys from bubbling to the row so
   *  renaming doesn't also open the row. */
  inRow?: boolean;
}

/**
 * Finder-style inline-rename title. Click the name → it becomes an input
 * prefilled with the current user title (empty for an auto-named recording, so
 * you type a fresh name); Enter / blur saves, Esc cancels. Empty save clears
 * the title back to the fallback. Desktop work surface — tokens only, JA copy.
 */
export function EditableTitle({ value, fallback, onSave, className, style, inRow }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (editing) { ref.current?.focus(); ref.current?.select(); }
  }, [editing]);

  function begin(e: { stopPropagation: () => void }) {
    if (inRow) e.stopPropagation();
    cancelledRef.current = false;
    setDraft(value);
    setEditing(true);
  }
  // Single commit path: Enter/Esc both blur the input, so `finish` (onBlur) is
  // the ONLY place that saves/reverts — no double-fire regardless of whether
  // React fires blur on unmount. Esc sets a flag so finish reverts instead.
  function finish() {
    setEditing(false);
    if (cancelledRef.current) { cancelledRef.current = false; setDraft(value); return; }
    if (draft.trim() !== value.trim()) void onSave(draft.trim());
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className={className}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => { if (inRow) e.stopPropagation(); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          // In a row the parent listens for Enter/Space to open — never let a
          // keystroke while renaming bubble up and navigate away.
          if (inRow) e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; ref.current?.blur(); }
        }}
        onBlur={finish}
        maxLength={80}
        placeholder={fallback}
        aria-label="タイトルを編集"
        data-testid="editable-title-input"
        style={{ font: 'inherit', color: 'inherit', background: 'var(--lz-surface)', border: '1px solid var(--lz-border)', borderRadius: 6, padding: '2px 6px', width: '100%', ...style }}
      />
    );
  }

  const shown = value.trim() || fallback;
  // In a row the parent row IS the keyboard/role target — don't nest a second
  // button. As a header (not inRow) the title is its own focusable rename button.
  const interactive = inRow
    ? {}
    : { role: 'button', tabIndex: 0, onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Enter') begin(e); } };
  return (
    <span
      className={className}
      onClick={begin}
      title="クリックして名前を変更"
      data-testid="editable-title"
      style={{ cursor: 'text', opacity: value.trim() ? 1 : 0.75, ...style }}
      {...interactive}
    >
      {shown}
    </span>
  );
}
