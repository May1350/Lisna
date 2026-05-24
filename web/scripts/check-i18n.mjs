#!/usr/bin/env node
/**
 * i18n consistency check — runs in CI + pre-commit.
 *
 * Three passes:
 *   1. KEY PARITY     — every key in `en.json` must exist in `ja.json` and
 *                       `ko.json`, and vice versa. Missing keys fail HARD.
 *   2. VALUE PARITY   — for each key, if `ja[k] === en[k]` or `ko[k] === en[k]`,
 *                       and the key is not in `IDENTICAL_VALUES_OK`, warn.
 *                       Catches translations that were copy-pasted from en
 *                       and never localized.
 *   3. HARDCODED CJK  — scan `.tsx` files under `web/src/app/` and
 *                       `web/src/components/` for visible CJK characters
 *                       in JSX. Files in `HARDCODED_OK_FILES` are skipped
 *                       (e.g. tokusho, hero decorative demo). Legal pages
 *                       use `lang="ja"` on the `<article>` element and are
 *                       skipped too — they carry their own translated
 *                       counterpart in the same file.
 *
 * Hardcoded *English* detection is intentionally NOT included — too many
 * false positives without an AST parser. Pass 2 catches the common failure
 * mode (key added to en.json, never re-translated for ja/ko).
 *
 * Exits non-zero on any pass-1 failure. Pass-2 + pass-3 are warnings by
 * default; pass `--strict` (or set `CHECK_I18N_STRICT=1`) to make them
 * fail too.
 *
 * Usage:
 *   pnpm --filter lisna-web check:i18n
 *   pnpm --filter lisna-web check:i18n:strict
 *
 * IMPORTANT: the two allowlists below (IDENTICAL_VALUES_OK + HARDCODED_OK_FILES)
 * are duplicated from `web/src/i18n/brand-vocabulary.ts` so this script can run
 * as plain ESM without any TS transpiler. If you edit either list, edit both
 * places. A startup sanity check verifies the lists match.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

const LOCALES = ['en', 'ja', 'ko'];

// ─── Allowlists (keep in sync with brand-vocabulary.ts) ───────────────────

const IDENTICAL_VALUES_OK = new Set([
  'pricingSection.alphaAmount',
  'pricingSection.proAmount',
  'pricingSection.proName',
  'hero.hint',
  'ctaStrip.hint',
  'footer.copyright',
  'privacyEmphasis.statValue',
  'features.privacy.headlineAfter',
  'auth.continueHeadingSuffix',
  'features.stt.metaA',
  'features.stt.metaC',
  'features.notes.metaA',
  'features.notes.metaB',
  'features.export.metaB',
  'features.export.metaC',
  'downloadPage.versionLine',
  'downloadPage.shaPrefix',
  'downloadPage.modelsWhisperLabel',
  'downloadPage.modelsLlamaLabel',
  'downloadPage.wlHeading',
  'downloadPage.wlEmailPlaceholder',
]);

const HARDCODED_OK_FILES = [
  'web/src/components/marketing/hero.tsx',
  'web/src/app/[locale]/tokusho/page.tsx',
  'web/src/app/_components/AutoCloseTab.tsx',
  'web/src/app/cancel/page.tsx',
  'web/src/app/success/page.tsx',
  'web/src/app/trial-cancel/page.tsx',
  'web/src/app/trial-success/page.tsx',
  'web/src/components/ui/locale-switcher.test.tsx',
];

// ─── State ────────────────────────────────────────────────────────────────

const STRICT = process.argv.includes('--strict') || process.env.CHECK_I18N_STRICT === '1';
let hardFails = 0;
let warnings = 0;
const fail = (msg) => { hardFails++; console.error(`FAIL: ${msg}`); };
const warn = (msg) => { warnings++; console.warn(`WARN: ${msg}`); };

// ─── Sanity: allowlists in this file match brand-vocabulary.ts ────────────

function stripLineComments(s) {
  // Remove `// ...` to end of line. Naive (does not handle // inside strings)
  // but our brand-vocabulary.ts has no `//` inside string literals, so safe.
  return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractStringArray(src, exportName) {
  // Match `EXPORT_NAME ... [` then balance brackets to find the closing `]`.
  const start = src.search(new RegExp(`\\b${exportName}\\b`));
  if (start < 0) return [];
  const openIdx = src.indexOf('[', start);
  if (openIdx < 0) return [];
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx < 0) return [];
  const body = stripLineComments(src.slice(openIdx + 1, closeIdx));
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function checkAllowlistSync() {
  const brandPath = path.join(WEB_ROOT, 'src/i18n/brand-vocabulary.ts');
  const src = fs.readFileSync(brandPath, 'utf8');

  const tsIdKeys = extractStringArray(src, 'IDENTICAL_VALUES_OK');
  const tsIdSet = new Set(tsIdKeys);
  for (const k of IDENTICAL_VALUES_OK) {
    if (!tsIdSet.has(k)) fail(`allowlist drift: IDENTICAL_VALUES_OK has "${k}" in check-i18n.mjs but not in brand-vocabulary.ts`);
  }
  for (const k of tsIdKeys) {
    if (!IDENTICAL_VALUES_OK.has(k)) fail(`allowlist drift: IDENTICAL_VALUES_OK has "${k}" in brand-vocabulary.ts but not in check-i18n.mjs`);
  }

  const tsHcFiles = extractStringArray(src, 'HARDCODED_OK_FILES');
  const tsHcSet = new Set(tsHcFiles);
  const mjsHcSet = new Set(HARDCODED_OK_FILES);
  for (const f of HARDCODED_OK_FILES) {
    if (!tsHcSet.has(f)) fail(`allowlist drift: HARDCODED_OK_FILES has "${f}" in check-i18n.mjs but not in brand-vocabulary.ts`);
  }
  for (const f of tsHcFiles) {
    if (!mjsHcSet.has(f)) fail(`allowlist drift: HARDCODED_OK_FILES has "${f}" in brand-vocabulary.ts but not in check-i18n.mjs`);
  }
}

// ─── Pass 1 + 2: message files ────────────────────────────────────────────

function flatten(obj, prefix = '') {
  const out = {};
  if (obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, key));
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function loadMessages() {
  const out = {};
  for (const loc of LOCALES) {
    const p = path.join(WEB_ROOT, 'src/messages', `${loc}.json`);
    out[loc] = flatten(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return out;
}

function checkKeyParity(msgs) {
  const enKeys = new Set(Object.keys(msgs.en));
  for (const loc of LOCALES) {
    if (loc === 'en') continue;
    const locKeys = new Set(Object.keys(msgs[loc]));
    for (const k of enKeys) {
      if (!locKeys.has(k)) fail(`messages/${loc}.json missing key: ${k}`);
    }
    for (const k of locKeys) {
      if (!enKeys.has(k)) fail(`messages/${loc}.json has stray key not in en: ${k}`);
    }
  }
}

function checkValueParity(msgs) {
  for (const k of Object.keys(msgs.en)) {
    if (IDENTICAL_VALUES_OK.has(k)) continue;
    const en = msgs.en[k];
    if (en === '') continue; // intentional empty splice values
    for (const loc of LOCALES) {
      if (loc === 'en') continue;
      const v = msgs[loc]?.[k];
      if (v === undefined) continue; // reported by parity check
      if (v === en) {
        warn(`messages/${loc}.json value identical to en for "${k}": ${JSON.stringify(en).slice(0, 80)}`);
      }
    }
  }
}

// ─── Pass 3: hardcoded CJK in TSX ─────────────────────────────────────────

// Hiragana + Katakana + CJK Unified Ideographs + Hangul Syllables
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

function walkTsx(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(p, out);
    else if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function checkHardcodedCJK() {
  const okSet = new Set(HARDCODED_OK_FILES.map((f) => path.resolve(REPO_ROOT, f)));
  const dirs = [
    path.join(WEB_ROOT, 'src/app'),
    path.join(WEB_ROOT, 'src/components'),
  ];
  const files = [];
  for (const d of dirs) walkTsx(d, files);

  for (const file of files) {
    if (okSet.has(file)) continue;
    const rel = path.relative(REPO_ROOT, file);
    const src = fs.readFileSync(file, 'utf8');

    // Files that carry a `lang="ja"` block (privacy / terms / refunds) hold the
    // JA copy alongside an EN block — the EN side is the canonical one for the
    // check, the JA side is intentional hardcoded translation.
    if (src.includes('lang="ja"')) continue;

    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (trimmed.startsWith('import ')) return;
      if (!CJK_RE.test(line)) return;

      // Allow:
      //   ja: '...',  ko: '...',  en: '...'      (per-locale lookup tables)
      //   LOCALE_LABELS / LOCALE_SHORT references (locale display chrome)
      if (/^\s*(ja|ko|en|'ja'|'ko'|'en'|"ja"|"ko"|"en")\s*:/.test(line)) return;
      if (/LOCALE_(LABELS|SHORT)/.test(line)) return;
      if (/META_(TITLE|DESC)/.test(line)) return; // legal-page metadata maps

      warn(`hardcoded CJK in ${rel}:${i + 1} — ${trimmed.slice(0, 120)}`);
    });
  }
}

// ─── main ────────────────────────────────────────────────────────────────

function main() {
  console.log('check-i18n: scanning…');
  checkAllowlistSync();
  if (hardFails === 0) {
    const msgs = loadMessages();
    checkKeyParity(msgs);
    checkValueParity(msgs);
    checkHardcodedCJK();
  }

  console.log('');
  console.log(`check-i18n: ${hardFails} hard fail(s), ${warnings} warning(s)`);

  if (hardFails > 0) process.exit(1);
  if (STRICT && warnings > 0) {
    console.error('check-i18n: --strict — treating warnings as failures');
    process.exit(1);
  }
  console.log('check-i18n: ok');
}

main();
