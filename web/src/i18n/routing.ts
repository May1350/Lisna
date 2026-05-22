// web/src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ja', 'ko'],
  defaultLocale: 'en',
  localeDetection: true,
  localePrefix: 'as-needed',  // /en is implicit; /ja and /ko are explicit
});

export type Locale = (typeof routing.locales)[number];
