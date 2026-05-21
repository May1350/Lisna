import * as React from 'react';

/**
 * Phase M Task 70 — pre-auth landing view.
 *
 * Shown when boot-time `getAuthState()` reports `signedIn:false` (no device
 * token in Keychain). The single button defers to main's `auth/sign-in`
 * handler, which opens the lisna.jp `/signin?source=app&app_callback=…`
 * page in the user's default browser. The actual sign-in completes on the
 * web side; main receives the resulting `lisna://callback?code=…` deep
 * link, redeems it via exchange-code (handleAuthCallback), stores the
 * device token, and broadcasts `auth/signed-in`. App.tsx's parent gate
 * subscribes to that channel and swaps in the authenticated shell.
 *
 * Typography (`Georgia, serif`) and palette (`#1a1410` / `#f8f3e9`) match
 * the Notebook Craft brand tone established for the lisna.jp web side;
 * intentionally inconsistent with the AuthenticatedApp inline system-ui
 * styling because the sign-in flow is a brand surface, not a tool surface.
 */
export function SignInView() {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>Welcome to Lisna</h1>
      <p style={{ marginBottom: 24, color: '#3a3025' }}>Sign in to start.</p>
      <button
        onClick={() => window.lisna.signIn()}
        style={{
          padding: '14px 28px',
          background: '#1a1410',
          color: '#f8f3e9',
          border: 0,
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Sign in to start
      </button>
    </div>
  );
}
