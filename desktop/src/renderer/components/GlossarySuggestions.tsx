import { useState } from 'react';

interface Props {
  /** Proper-noun terms extracted from the just-saved edit (suggestGlossaryTerms). */
  candidates: string[];
  onClose: () => void;
}

/**
 * Post-edit glossary suggestion banner. When a transcript edit introduces
 * proper-noun spellings, offer to add them to the glossary so the NEXT
 * recording's STT biases toward the corrected form (the proven
 * glossary → initial_prompt lever). Confirm-only — NEVER auto-adds, so a wrong
 * correction can't silently poison the glossary. Self-contained IPC (get + set)
 * like the rest of the renderer; JA-locked (desktop work surface).
 */
export function GlossarySuggestions({ candidates, onClose }: Props) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (candidates.length === 0) return null;
  const remaining = candidates.filter((c) => !added.has(c));

  async function add(terms: string[]) {
    setBusy(true);
    try {
      const existing = await window.lisna.getGlossary();
      await window.lisna.setGlossary([...existing, ...terms]);
      setAdded((prev) => new Set([...prev, ...terms]));
    } catch {
      // Glossary write failed (rare: disk/IPC). Leave the chips un-added so the
      // user can retry; no unhandled rejection, no data loss (the edit is saved).
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="glossary-suggest"
      role="region"
      aria-label="用語集への追加候補"
      style={{
        marginTop: 16,
        padding: '12px 14px',
        border: '1px solid var(--lz-border)',
        borderRadius: 'var(--lz-radius)',
        background: 'var(--lz-surface)',
      }}
    >
      <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600 }}>
        修正した語を用語集に追加しますか？
      </p>
      <p className="lz-hint" style={{ margin: '0 0 10px' }}>
        次回以降の文字起こしがこの表記に寄ります。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {candidates.map((c) => (
          <button
            key={c}
            onClick={() => void add([c])}
            disabled={busy || added.has(c)}
            className="lz-tag"
            style={{ cursor: added.has(c) ? 'default' : 'pointer', opacity: added.has(c) ? 0.6 : 1 }}
            aria-label={added.has(c) ? `${c} を追加済み` : `${c} を用語集に追加`}
          >
            {added.has(c) ? `✓ ${c}` : `＋ ${c}`}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {remaining.length > 1 && (
          <button className="lz-primary" onClick={() => void add(remaining)} disabled={busy}>
            すべて追加
          </button>
        )}
        <button onClick={onClose} disabled={busy}>
          {added.size > 0 ? '閉じる' : '今はしない'}
        </button>
      </div>
    </div>
  );
}
