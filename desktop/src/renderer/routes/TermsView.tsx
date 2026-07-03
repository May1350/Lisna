import { useEffect, useRef, useState } from 'react';

interface Props {
  onBack: () => void;
}

/**
 * Terms (用語集) — manage the proper-noun glossary that biases STT toward the
 * user's preferred spelling. Persists to `<userData>/glossary.json` via IPC;
 * the next transcribe reads it. Native-Mac work surface — theme tokens (dark),
 * no hardcoded light-mode colors. JA-locked copy.
 *
 * Honest ceiling stated in the UI: this pins the SPELLING of names/jargon; it
 * does not fix homophones, and it biases toward the exact form you type.
 */
export function TermsView({ onBack }: Props) {
  const [terms, setTerms] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    window.lisna.getGlossary().then((t) => { if (live) { setTerms(t); setLoading(false); } });
    return () => { live = false; };
  }, []);

  async function commit(next: string[]) {
    setBusy(true);
    try {
      setTerms(await window.lisna.setGlossary(next));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const t = input.trim();
    // Dedup: adding an existing term is a no-op (also avoids duplicate React keys).
    if (!t || terms.includes(t)) { setInput(''); return; }
    setInput('');
    inputRef.current?.focus();
    await commit([...terms, t]);
  }

  return (
    <section className="lz-pad" style={{ maxWidth: 620, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>用語集</h2>
        <button onClick={onBack} style={{ marginLeft: 'auto' }}>← 戻る</button>
      </header>

      <p className="lz-muted" style={{ fontSize: 13.5, lineHeight: 1.7, margin: '0 0 6px' }}>
        録音によく出てくる固有名詞・専門用語を、
        <strong style={{ color: 'var(--lz-text)', fontWeight: 600 }}>出したい表記のまま</strong>
        登録すると、次回以降の文字起こしがその表記に寄ります。
      </p>
      <p className="lz-hint" style={{ lineHeight: 1.6, margin: '0 0 20px' }}>
        ※ 同音異義語（例: 四半期 / 市販機）は直せません。登録した表記そのものへ寄せる機能です。
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="用語を追加（例: カスタマーループ）"
          aria-label="用語を追加"
          maxLength={40}
          style={{ flex: 1, padding: '9px 12px', fontSize: 14 }}
        />
        <button
          className="lz-primary"
          onClick={() => void add()}
          disabled={busy || input.trim().length === 0}
        >
          追加
        </button>
      </div>

      {loading ? (
        <p className="lz-hint">読み込み中…</p>
      ) : terms.length === 0 ? (
        <p className="lz-hint">まだ用語がありません。上の欄に入力して「追加」してください。</p>
      ) : (
        <>
          <p className="lz-label" style={{ margin: '0 0 10px' }}>登録済み {terms.length}件</p>
          <ul
            data-testid="terms-list"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}
          >
            {terms.map((term) => (
              <li key={term} className="lz-tag">
                <span>{term}</span>
                <button
                  className="lz-tag-x"
                  onClick={() => void commit(terms.filter((x) => x !== term))}
                  disabled={busy}
                  aria-label={`${term} を削除`}
                  title="削除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
