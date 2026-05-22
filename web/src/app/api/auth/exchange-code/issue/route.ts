// web/src/app/api/auth/exchange-code/issue/route.ts
//
// Security: url is HTML-escaped before embedding in the meta-refresh attribute to prevent
// attribute-injection XSS. In the inline <script> context, JSON.stringify alone is
// insufficient — the HTML5 script-data parser terminates <script> at the literal substring
// </script> regardless of JS string context. We therefore Unicode-escape <, >, and & so
// the sequence </script> can never appear verbatim in the response body.
// Input: app_callback is validated to reject non-lisna:// schemes, fragments (#),
// and extra query params (? / &) — the latter prevents code-param shadowing in the
// desktop URL handler.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { issueExchangeCode, buildCallbackUrl } from '@/lib/app-auth';

// Escape a string for safe use inside an HTML attribute value.
// Guards against attribute-injection XSS when url is derived from user input.
const escapeHtmlAttr = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Escape a string for safe embedding inside an inline <script> tag.
// JSON.stringify produces a valid JS string literal but does NOT escape `<`, so an
// attacker-controlled value containing `</script>` would terminate the script block.
// Unicode escapes (< etc.) are valid JS and do not change the runtime string value.
const escapeForScript = (s: string): string =>
  JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    const redirectRes = NextResponse.redirect(new URL('/signin', req.url));
    redirectRes.headers.set('Cache-Control', 'no-store');
    return redirectRes;
  }
  const callback = new URL(req.url).searchParams.get('app_callback') ?? 'lisna://callback';
  if (
    !callback.startsWith('lisna://')
    || callback.includes('#')
    || callback.includes('?')
    || callback.includes('&')
  ) {
    return new NextResponse('invalid app_callback', { status: 400, headers: NO_STORE });
  }
  const code = await issueExchangeCode(session.user.id);
  const url = buildCallbackUrl(callback, code);
  // Redirect the browser to the lisna:// URL — macOS routes it to Lisna.app.
  // Also include a fallback HTML body in case the OS does not handle the redirect cleanly.
  return new NextResponse(
    `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${escapeHtmlAttr(url)}" /><title>Returning to Lisna…</title></head>
<body><p>Returning to Lisna… <a href="/auth/success">Continue in browser</a></p>
<script>window.location.href = ${escapeForScript(url)};</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } },
  );
}
