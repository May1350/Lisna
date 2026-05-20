import createMiddleware from 'next-intl/middleware';
import { type NextRequest } from 'next/server';
import { routing } from './src/i18n/routing';

const intl = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const res = intl(req);
  res.headers.set('x-pathname', req.nextUrl.pathname);
  return res;
}

export const config = {
  // Match all paths except API, _next, static files, and existing top-level
  // pages that haven't yet been migrated under [locale]/ (Phase F moves them).
  // When a page is moved under [locale]/, remove it from this exclusion list.
  // Known transition-period gap: locale-prefixed access to non-migrated pages
  // (e.g. /ja/pricing) returns 404 — middleware runs but Next finds no
  // [locale]/pricing/page.tsx until Phase F migrates it.
  matcher: [
    '/((?!api|_next|_vercel|cancel|design-test|pricing|privacy|refunds|success|terms|tokusho|trial-cancel|trial-success|robots.txt|.*\\..*).*)',
  ],
};
