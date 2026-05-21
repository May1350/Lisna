// web/src/i18n/navigation.ts
// Locale-aware navigation helpers, derived from `routing` so that
// internal links auto-prefix the active locale (and respect
// localePrefix:'as-needed' — /en is implicit, /ja and /ko explicit).
//
// Use `Link` from here whenever a link points at an internal route that
// has a localized variant. External URLs and mailto: links stay plain.
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
