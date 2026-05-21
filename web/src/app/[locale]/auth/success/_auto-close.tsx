'use client';
import * as React from 'react';

export function AutoCloseTab() {
  const [secs, setSecs] = React.useState(5);
  const [blocked, setBlocked] = React.useState(false);

  React.useEffect(() => {
    if (secs === 0) {
      try {
        window.close();
        // If still here after a tick, the browser blocked the close
        const t = setTimeout(() => setBlocked(true), 250);
        return () => clearTimeout(t);
      } catch {
        setBlocked(true);
      }
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);

  if (blocked) {
    return <p className="mt-6 text-hint text-ink-700/60">Closing didn't work — close this tab manually.</p>;
  }
  return <p className="mt-6 text-hint text-ink-700/60">Auto-closing in {secs} seconds…</p>;
}
