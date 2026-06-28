import { useEffect, useRef, useState } from 'react';

interface Props {
  onBack: () => void;
}

/**
 * Terms (用語集) — manage the proper-noun glossary that biases STT toward the
 * user's preferred spelling. Persists to `<userData>/glossary.json` via IPC;
 * the next transcribe reads it. Work-surface styling (function-first inline,
 * per web-design.md scope boundary — no legal-pad decoration). JA-locked copy.
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
    if (!t) return;
    setInput('');
    inputRef.current?.focus();
    await commit([...terms, t]);
  }

  const wrap = { maxWidth: 560, margin: '0 auto', padding: '8px 4px' } as const;

  return (
    <section style={wrap}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>用語集</h2>
        <button onClick={onBack} style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }}>
          ← 戻る
        </button>
      </header>

      <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
        録音によく出てくる固有名詞・専門用語を、<strong>出したい表記のまま</strong>登録します。
        次回以降の文字起こしがこの表記に寄ります。
        <br />
        <span style={{ color: '#999', fontSize: 12 }}>
          ※ 同音異義語（例: 四半期/市販機）は直せません。登録した表記そのものに寄せる機能です。
        </span>
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="用語を追加（例: カスタマーループ）"
          aria-label="用語を追加"
          maxLength={40}
          style={{ flex: 1, padding: '10px 12px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button
          onClick={() => void add()}
          disabled={busy || input.trim().length === 0}
          style={{ padding: '10px 18px', fontSize: 14, borderRadius: 6 }}
        >
          追加
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#999', fontSize: 13 }}>読み込み中…</p>
      ) : terms.length === 0 ? (
        <p style={{ color: '#999', fontSize: 13 }}>まだ用語がありません。上で追加してください。</p>
      ) : (
        <ul data-testid="terms-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {terms.map((term) => (
            <li
              key={term}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 8px 6px 12px', border: '1px solid #ddd', borderRadius: 999,
                background: '#fafafa', fontSize: 14,
              }}
            >
              <span>{term}</span>
              <button
                onClick={() => void commit(terms.filter((x) => x !== term))}
                disabled={busy}
                aria-label={`${term} を削除`}
                title="削除"
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 16, lineHeight: 1, color: '#999', padding: '0 2px',
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
