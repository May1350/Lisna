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
  // Match all paths except API, _next, static infrastructure, and Stripe /
  // checkout return URLs. The 4 transition tokens (cancel, success,
  // trial-cancel, trial-success) intentionally stay at top level because
  // Stripe constructs the return URL externally and doesn't know the user's
  // locale — so they must not be locale-prefixed.
  //
  // `dl` is a permanent infrastructure exclusion (release-download redirects
  // resolved by route handlers, no locale variant).
  //
  // `design-test` is a dev-only sandbox page that intentionally stays
  // un-localized.
  //
  // These exclusions are stable — they are NOT migration backlog.
  matcher: [
    '/((?!api|_next|_vercel|dl|cancel|design-test|success|trial-cancel|trial-success|robots.txt|.*\\..*).*)',
  ],
};
