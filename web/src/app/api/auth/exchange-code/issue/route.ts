// web/src/app/api/auth/exchange-code/issue/route.ts
//
// Security deviation from plan: url is HTML-escaped before embedding in the meta-refresh
// attribute to prevent XSS via a crafted app_callback value. JSON.stringify in the script
// context is safe as-is and is left unchanged.
// Input deviation from plan: fragment check added before calling buildCallbackUrl so a
// malformed callback yields 400 instead of letting buildCallbackUrl throw a 500.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { issueExchangeCode, buildCallbackUrl } from '@/lib/app-auth';

// Escape a string for safe use inside an HTML attribute value.
// Guards against attribute-injection XSS when url is derived from user input.
const escapeHtmlAttr = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/signin', req.url));
  }
  const callback = req.nextUrl.searchParams.get('app_callback') ?? 'lisna://callback';
  if (!callback.startsWith('lisna://') || callback.includes('#')) {
    return new NextResponse('invalid scheme or contains fragment', { status: 400 });
  }
  const code = await issueExchangeCode(session.user.id);
  const url = buildCallbackUrl(callback, code);
  // 302 the browser to the lisna:// URL — macOS routes it to Lisna.app.
  // Also include a fallback HTML body in case the OS does not handle the redirect cleanly.
  return new NextResponse(
    `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${escapeHtmlAttr(url)}" /><title>Returning to Lisna…</title></head>
<body><p>Returning to Lisna… <a href="/auth/success">Continue in browser</a></p>
<script>window.location.href = ${JSON.stringify(url)};</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}
