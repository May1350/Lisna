// web/src/i18n/navigation.ts
// Locale-aware navigation helpers, derived from `routing` so that
// internal links auto-prefix the active locale (and respect
// localePrefix:'as-needed' — /en is implicit, /ja and /ko explicit).
//
// Convention: use `Link` from here whenever an internal route has a
// localized variant. External URLs and mailto: links stay plain.
//
// Partial-rollout status (as of commit 8649e09): only the 4 legal pages
// (terms / privacy / tokusho / refunds) have been migrated to consume
// this helper. ~8 other call sites still use `next/link` + a manual
// `locale === 'en' ? '' : '/${locale}'` ternary — including the navbar,
// footer, locale-switcher, marketing components, and sibling `[locale]/`
// pages. The full sweep is deferred to a separate polish commit in the
// Phase H polish-batch.
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
