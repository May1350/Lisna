import { useState } from 'react';

interface Props {
  /** Terms just auto-added to the glossary (autoRegisterGlossaryFromEdit result). */
  added: string[];
  onClose: () => void;
}

/**
 * Persistent "added to glossary" banner. Transcript-edit proper nouns are
 * auto-registered (no confirm); this shows what was added and lets the user
 * undo a wrong one (a bad term would bias future STT). JA-locked work surface.
 */
export function GlossaryAdded({ added, onClose }: Props) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (added.length === 0) return null;
  const active = added.filter((t) => !removed.has(t));

  async function remove(terms: string[]) {
    setBusy(true);
    try {
      const existing = await window.lisna.getGlossary();
      const drop = new Set(terms);
      await window.lisna.setGlossary(existing.filter((t) => !drop.has(t)));
      setRemoved((prev) => new Set([...prev, ...terms]));
    } catch {
      // best-effort: glossary already holds the term; leave it, user can use 用語集.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="glossary-added"
      role="region"
      aria-label="用語集に追加した語"
      style={{ marginTop: 16, padding: '12px 14px', border: '1px solid var(--lz-border)', borderRadius: 'var(--lz-radius)', background: 'var(--lz-surface)' }}
    >
      <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600 }}>用語集に追加しました</p>
      <p className="lz-hint" style={{ margin: '0 0 10px' }}>次回以降の文字起こしがこの表記に寄ります。不要なら取り消せます。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {added.map((c) => (
          <span key={c} className="lz-tag" style={{ opacity: removed.has(c) ? 0.5 : 1, textDecoration: removed.has(c) ? 'line-through' : 'none' }}>
            {c}
            {!removed.has(c) && (
              <button className="lz-tag-x" onClick={() => void remove([c])} disabled={busy} aria-label={`${c} を取り消す`}>✕</button>
            )}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {active.length > 1 && (
          <button onClick={() => void remove(active)} disabled={busy}>すべて取り消す</button>
        )}
        <button className="lz-primary" onClick={onClose} disabled={busy}>閉じる</button>
      </div>
    </div>
  );
}
