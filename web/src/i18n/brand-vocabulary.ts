/**
 * Brand vocabulary — strings that NEVER translate across locales.
 *
 * Anything visible to users that should look identical in EN/JA/KO
 * belongs here: product names, model names, license names, third-party
 * product names, currency symbols, license short codes, technical tokens.
 *
 * Two consumers:
 *   1. Components import named tokens (`BRAND.appName`) so the value lives
 *      in one place. Renaming a brand only touches this file.
 *   2. `web/scripts/check-i18n.ts` reads `IDENTICAL_VALUES_OK` to suppress
 *      "value is identical across locales" warnings for keys that are
 *      *intentionally* identical (e.g. "$0", "© 2026 Lisna · …").
 *
 * If you find yourself writing a brand string inline in JSX, import it
 * from here instead. If you find yourself adding a key to a messages
 * file that ends up being the same string in all three locales, add the
 * key path to `IDENTICAL_VALUES_OK` below — and explain why.
 */

export const BRAND = {
  /** Product */
  appName: 'Lisna',
  domain: 'lisna.jp',
  supportEmail: 'takgun.jr@gmail.com',

  /** First-party tech */
  whisper: 'Whisper',
  llama: 'Llama',
  llama32: 'Llama 3.2',
  llama32_3b: 'Llama 3.2 3B',

  /** Third-party */
  obsidian: 'Obsidian',
  notion: 'Notion',
  icloud: 'iCloud',
  dropbox: 'Dropbox',
  chrome: 'Chrome',
  chromeWebStore: 'Chrome Web Store',
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  plausible: 'Plausible',
  stripe: 'Stripe',

  /** Apple */
  apple: 'Apple',
  appleSilicon: 'Apple Silicon',
  mac: 'Mac',
  macos: 'macOS',
  metal: 'Metal',
  neuralEngine: 'Neural Engine',

  /** Licenses (short forms — render as-is) */
  mit: 'MIT',
  metaLicense: 'Meta license',

  /** Competitors (compare page) */
  otter: 'Otter',
  fireflies: 'Fireflies',
  notionAi: 'Notion AI',

  /** Community */
  discord: 'Discord',
  github: 'GitHub',
  bluesky: 'Bluesky',

  /** Currency symbols (numeric values stay locale-stable too) */
  jpy: '¥',
  usd: '$',
} as const;

/**
 * Locale display labels — used by `LocaleSwitcher` and the footer's
 * decorative locale strip. Always shown in the user's NATIVE script
 * regardless of the page locale (so a JA user can find the EN switch
 * even if reading Korean).
 */
export const LOCALE_LABELS = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
} as const;

/** Short locale codes for compact UI chrome (header switcher). */
export const LOCALE_SHORT = {
  en: 'EN',
  ja: '日本語',
  ko: '한국어',
} as const;

/**
 * Message keys whose value is intentionally the same across all three
 * locales (e.g. price amounts, currency-prefixed numbers, the copyright
 * line). `check-i18n.ts` suppresses parity warnings for these.
 *
 * Add a comment for each entry explaining WHY it's intentional.
 */
export const IDENTICAL_VALUES_OK = new Set<string>([
  // Numeric pricing — currency / digits never translate.
  'pricingSection.alphaAmount',          // "$0"
  'pricingSection.proAmount',            // "$?"
  'pricingSection.proName',              // "Pro" — brand-style tier name.
  'hero.hint',                           // "macOS 13+ · Apple Silicon · 158 MB"
  'ctaStrip.hint',                       // same hint, different surface
  // Copyright — legal short form, stays in EN.
  'footer.copyright',                    // "© 2026 Lisna · All rights reserved"
  // Statistical eyecatch — pure number.
  'privacyEmphasis.statValue',           // "100%"
  // Sentence-final punctuation — same glyph across locales here.
  'features.privacy.headlineAfter',      // "."
  'auth.continueHeadingSuffix',          // "."
  // Meta tags inside feature blocks that are tech tokens.
  'features.stt.metaA',                  // "→ Whisper"
  'features.stt.metaC',                  // "→ JA / EN / KO" (language codes)
  'features.notes.metaA',                // "→ Llama 3.2 3B"
  'features.notes.metaB',                // "→ Markdown"
  'features.export.metaB',               // "→ Markdown"
  'features.export.metaC',               // "→ PDF"
  // Partner org names — fixed in canonical English across all locales.
  'trust.keio',                          // "Keio University"
  // Download page — tech / brand strings that don't translate.
  'downloadPage.versionLine',            // "v0.1.0 · 158 MB · Apple Silicon"
  'downloadPage.shaPrefix',              // "SHA256: "
  'downloadPage.modelsWhisperLabel',     // "Whisper STT"
  'downloadPage.modelsLlamaLabel',       // "Llama LLM"
  'downloadPage.wlHeading',              // "Windows / Linux"
  'downloadPage.wlEmailPlaceholder',     // "you@example.com"
]);

/**
 * File globs whose content is INTENTIONALLY untranslated.
 * `check-i18n.ts` skips hardcoded-string detection for these.
 */
export const HARDCODED_OK_FILES = [
  // Mock screenshot content inside Hero / page.tsx Postits.
  // These are aria-hidden decorative samples — translating "Bolzano-Weierstrass"
  // or "04:32" makes no sense.
  'web/src/components/marketing/hero.tsx',
  // Tokusho page — Japanese-only legal document (特定商取引法).
  'web/src/app/[locale]/tokusho/page.tsx',
  // Stripe billing callback pages — JP-market-only flow (NOT under [locale]).
  // These render after Stripe checkout success/cancel; copy is fixed Japanese.
  'web/src/app/_components/AutoCloseTab.tsx',
  'web/src/app/cancel/page.tsx',
  'web/src/app/success/page.tsx',
  'web/src/app/trial-cancel/page.tsx',
  'web/src/app/trial-success/page.tsx',
  // Locale-switcher test asserts on a Japanese button label by design.
  'web/src/components/ui/locale-switcher.test.tsx',
];

export type BrandToken = keyof typeof BRAND;
