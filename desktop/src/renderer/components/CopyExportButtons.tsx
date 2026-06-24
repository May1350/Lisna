import { useState } from 'react';

interface Props {
  /** Lazily produce the text to copy/export — only called on click, so the
   *  (cheap) note→markdown serialization doesn't run on every render. */
  getText: () => string;
  /** Default filename for the save dialog; the extension implies the format. */
  exportName: string;
}

type Status = 'idle' | 'copied' | 'saved' | 'error';

/**
 * Copy-to-clipboard + Export-to-file buttons for the note / transcript views.
 * Work-surface styling (function-first inline styles, per web-design.md scope
 * boundary — no legal-pad decoration). JA copy per the v2.0 concept-lock.
 */
export function CopyExportButtons({ getText, exportName }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const flash = (s: Status) => { setStatus(s); window.setTimeout(() => setStatus('idle'), 1500); };

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(getText());
      flash('copied');
    } catch {
      flash('error');
    }
  }

  async function onExport() {
    try {
      const res = await window.lisna.exportFile({ content: getText(), defaultName: exportName });
      if (res.ok) flash('saved');
      // user-canceled dialog → no feedback
    } catch {
      flash('error');
    }
  }

  const btn = { padding: '6px 12px', fontSize: 13 } as const;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button data-testid="copy-button" onClick={onCopy} style={btn}>コピー</button>
      <button data-testid="export-button" onClick={onExport} style={btn}>保存</button>
      {status === 'copied' && <span style={{ color: '#5fa872', fontSize: 12 }}>コピーしました</span>}
      {status === 'saved' && <span style={{ color: '#5fa872', fontSize: 12 }}>保存しました</span>}
      {status === 'error' && <span style={{ color: '#c33', fontSize: 12 }}>失敗しました</span>}
    </div>
  );
}
