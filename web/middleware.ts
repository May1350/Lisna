// web/middleware.ts
import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all paths except API, _next, static files, and existing top-level
  // pages that haven't yet been migrated under [locale]/ (Phase F moves them).
  // When a page is moved under [locale]/, remove it from this exclusion list.
  matcher: [
    '/((?!api|_next|_vercel|cancel|design-test|pricing|privacy|refunds|success|terms|tokusho|trial-cancel|trial-success|robots.txt|.*\\..*).*)',
  ],
};
