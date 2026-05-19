# lisna.jp Full Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild lisna.jp as the v2 desktop alpha distribution + auth + onboarding gateway, with Notebook Craft design tone, D3 anonymous-download flow (download → in-app signup via `lisna://callback`), 13-page site IA, Auth.js v5 + Drizzle + AWS RDS Postgres, EN/JA i18n, Plausible analytics, GH Releases for DMG, and electron-updater integration.

**Architecture:** Next.js 16 App Router (already installed in `web/`) on Vercel Tokyo edge. Tailwind v4 + Radix primitives + custom Notebook components + CVA + tailwind-merge + clsx. Auth.js v5 with Drizzle adapter against existing v1 AWS RDS Postgres via RDS Proxy + IAM auth. Custom URL scheme handshake (Cursor/Linear/Figma pattern) bridges desktop ↔ web auth. next-intl for `/[locale]/...` routing.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · Radix primitives · CVA · tailwind-merge · clsx · Auth.js v5 · Drizzle ORM · pg + AWS SDK (RDS Proxy IAM) · Resend (magic link) · React Email · next-intl · MDX (`@next/mdx`) · Plausible · Stripe (existing) · GitHub Actions · GitHub Releases · electron-updater · Vercel · Fraunces + Inter + Noto Serif JP via next/font

**Spec:** `docs/superpowers/specs/2026-05-19-lisna-jp-fullsite-design.md` (1038L, 14 sections)

**Worktree:** `.claude/worktrees/web-redesign` on branch `worktree-web-redesign`, based on `9364932` (main with v2 alpha).

**Plan structure:** 15 phases (A–O), ~80 tasks. Each phase ends with a working commit. Implementation is dependency-ordered: bootstrap → design system → marketing site → functional pages → DB → auth → desktop integration → CD → smoke.

---

## File Structure

All paths relative to repo root unless otherwise noted.

```
web/
├── package.json (modify — many new deps)
├── tailwind.config.ts (create)
├── postcss.config.mjs (create)
├── next.config.ts (modify — i18n + MDX + image domains + headers)
├── middleware.ts (create — next-intl locale + auth gate)
├── drizzle.config.ts (create)
├── .env.example (create)
├── src/
│   ├── app/
│   │   ├── layout.tsx (modify — fonts + theme + locale root)
│   │   ├── [locale]/
│   │   │   ├── layout.tsx (create — locale-aware shell + font conditional)
│   │   │   ├── page.tsx (replace — 12-section home)
│   │   │   ├── download/page.tsx (create)
│   │   │   ├── docs/
│   │   │   │   ├── layout.tsx (create)
│   │   │   │   └── [...slug]/page.tsx (create — MDX renderer)
│   │   │   ├── changelog/page.tsx (create)
│   │   │   ├── changelog/rss.xml/route.ts (create)
│   │   │   ├── compare/page.tsx (create)
│   │   │   ├── pricing/page.tsx (replace — v1 + v2 sections)
│   │   │   ├── signin/page.tsx (create)
│   │   │   ├── auth/success/page.tsx (create)
│   │   │   ├── dashboard/page.tsx (create — auth gated)
│   │   │   ├── terms/page.tsx (modify — v2 clauses)
│   │   │   ├── privacy/page.tsx (modify — v2 clauses)
│   │   │   ├── tokusho/page.tsx (modify — v2 reference)
│   │   │   └── refunds/page.tsx (modify — v2 reference)
│   │   ├── api/
│   │   │   └── auth/
│   │   │       ├── [...nextauth]/route.ts (create — Auth.js handlers)
│   │   │       ├── exchange-code/issue/route.ts (create)
│   │   │       ├── exchange-code/redeem/route.ts (create)
│   │   │       ├── refresh/route.ts (create)
│   │   │       └── revoke-device/route.ts (create)
│   │   ├── dl/dmg/latest/route.ts (create — 302 to GH Release DMG)
│   │   └── robots.ts (existing, may modify for /[locale])
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx (CVA variants)
│   │   │   ├── input.tsx
│   │   │   ├── email-magic-link-form.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx (Radix)
│   │   │   ├── dropdown.tsx (Radix)
│   │   │   ├── tabs.tsx (Radix)
│   │   │   ├── toast.tsx (Radix)
│   │   │   ├── popover.tsx (Radix)
│   │   │   ├── accordion.tsx (Radix)
│   │   │   ├── locale-switcher.tsx
│   │   │   ├── navbar.tsx
│   │   │   ├── footer.tsx
│   │   │   ├── avatar-menu.tsx
│   │   │   └── screenshot-frame.tsx
│   │   ├── marketing/
│   │   │   ├── hero.tsx
│   │   │   ├── trust-strip.tsx
│   │   │   ├── feature-block.tsx
│   │   │   ├── marginalia.tsx
│   │   │   ├── privacy-emphasis.tsx
│   │   │   ├── pricing-cards.tsx
│   │   │   ├── faq-accordion.tsx
│   │   │   └── cta-strip.tsx
│   │   └── layout/
│   │       ├── marketing-shell.tsx
│   │       ├── dashboard-shell.tsx
│   │       └── auth-shell.tsx
│   ├── lib/
│   │   ├── cn.ts
│   │   ├── auth.ts (Auth.js config)
│   │   ├── db.ts (Drizzle client + IAM token)
│   │   ├── email.ts (Resend wrapper)
│   │   ├── app-auth.ts (exchange-code logic)
│   │   ├── env.ts (zod env schema)
│   │   ├── i18n.ts (next-intl config)
│   │   └── plausible.ts (event helpers)
│   ├── db/
│   │   ├── schema.ts (5 tables — accounts/sessions/verification-tokens/app-exchange-codes/app-devices)
│   │   └── migrations/ (Drizzle Kit output)
│   ├── messages/
│   │   ├── en.json
│   │   ├── ja.json
│   │   └── ko.json (stub)
│   ├── content/
│   │   ├── docs/
│   │   │   ├── getting-started.mdx
│   │   │   ├── first-recording.mdx
│   │   │   ├── exporting-to-obsidian.mdx
│   │   │   ├── faq.mdx
│   │   │   └── troubleshooting.mdx
│   │   └── changelog/
│   │       └── 2026-05-18-v0.1.0.mdx
│   └── styles/
│       └── globals.css (Tailwind base + notebook utilities)
└── public/
    └── images/screenshots/... (hero + feature mockups, exported PNGs)

desktop/                    # Phase M only — desktop app integration
├── electron-builder.yml (modify — CFBundleURLTypes for lisna://)
├── src/main/
│   ├── url-scheme.ts (create — handle lisna:// URLs)
│   ├── auth/
│   │   ├── keychain.ts (create — macOS Keychain via keytar)
│   │   └── exchange.ts (create — redeem code → token)
│   └── ipc.ts (modify — sign-in IPC handlers)
└── src/renderer/
    └── routes/
        └── SignInView.tsx (create — Sign in to start button)

.github/workflows/
├── ci.yml (existing — desktop CI)
└── release.yml (create — desktop DMG build + GH Release publish)
```

---

## Conventions

- **Package manager**: `pnpm` (existing repo convention). All install commands use `pnpm add`.
- **Commit message format**: follow existing repo style — `<type>(scope): summary` (e.g., `feat(web): add Hero component`).
- **Test framework for web**: **Vitest** + **@testing-library/react** + **happy-dom** (matches existing desktop testing setup; no Jest).
- **TDD scope**: tasks with real logic (auth, exchange-code, locale routing, env validation, DB queries) ship with tests. Pure-presentational tasks (CSS utilities, marketing components without behavior) skip tests but include a visual smoke step (run dev server, screenshot, verify).
- **Per-task commits**: every task ends with a commit. Use `git add <specific files>` (never `git add -A`).
- **Verification before completion**: every task ends with a verification step — typecheck, lint, test, or visual smoke. Never claim a task done without running it.
- **Secrets**: never write secret VALUES into code/docs/commits. Reference env var NAMES only. See global rule in `~/.claude/CLAUDE.md`.

---

## Phase A — Bootstrap (Tasks 1-5)

Goal: install all web dependencies, scaffold Tailwind + design tokens + font loading. End of phase: `pnpm dev` boots, blank page renders with Fraunces + Inter + cream background.

### Task 1: Install Tailwind v4 + PostCSS + design-system dependencies

**Files:**
- Modify: `web/package.json`
- Create: `web/postcss.config.mjs`
- Create: `web/src/styles/globals.css`
- Modify: `web/src/app/layout.tsx` (import globals.css)

- [ ] **Step 1: Install Tailwind + design system deps**

Run from `web/`:

```bash
cd web && pnpm add -D tailwindcss @tailwindcss/postcss postcss autoprefixer
pnpm add clsx tailwind-merge class-variance-authority
pnpm add @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-accordion @radix-ui/react-tabs @radix-ui/react-toast @radix-ui/react-slot
```

Expected: `package.json` gains tailwind v4, all Radix primitives, CVA, tailwind-merge, clsx.

- [ ] **Step 2: Create postcss.config.mjs**

```js
// web/postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create web/src/styles/globals.css with Tailwind base**

```css
@import "tailwindcss";

@theme {
  /* Tokens defined in Task 3 — placeholder for now */
}

@layer base {
  html {
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  body {
    background-color: #f8f3e9; /* cream-200 placeholder; Task 3 binds to token */
    color: #1a1410; /* ink-900 placeholder */
  }
}
```

- [ ] **Step 4: Import globals.css in app/layout.tsx**

Modify the existing root layout to import styles:

```ts
// web/src/app/layout.tsx — add at top:
import '@/styles/globals.css';
```

(Keep existing layout structure — fonts will be added in Task 4, locale wrapping in Task 17.)

- [ ] **Step 5: Verify dev server boots with cream background**

```bash
cd web && pnpm dev
```

Open `http://localhost:3000`. Expected: existing home renders on cream background (#f8f3e9). No console errors.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/postcss.config.mjs web/src/styles/globals.css web/src/app/layout.tsx
git commit -m "feat(web): install Tailwind v4 + Radix + CVA + design-system deps"
```

---

### Task 2: Create tailwind.config.ts with Notebook tokens + typescale

**Files:**
- Create: `web/tailwind.config.ts`
- Modify: `web/src/styles/globals.css` (replace @theme block)

- [ ] **Step 1: Create web/tailwind.config.ts**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50:  '#fefbf5',
          100: '#faf6ef',
          200: '#f8f3e9',
          300: '#ebe2cf',
        },
        ink: {
          700: '#3a3025',
          900: '#1a1410',
        },
        margin: {
          red: '#b85050',
        },
        accent: {
          tan:  '#8a6a3a',
          sage: '#5fa872',
        },
      },
      fontFamily: {
        serif:      ['var(--font-fraunces)', 'Iowan Old Style', 'Georgia', 'serif'],
        'serif-jp': ['var(--font-noto-serif-jp)', 'Yu Mincho', 'Hiragino Mincho ProN', 'serif'],
        sans:       ['var(--font-inter)', '-apple-system', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-1':       ['3.5rem',    { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '400' }],
        'display-2':       ['2.75rem',   { lineHeight: '1',    letterSpacing: '-0.03em',  fontWeight: '400' }],
        h1:                ['2.5rem',    { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }],
        h2:                ['2.375rem',  { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }],
        'h2-sm':           ['2rem',      { lineHeight: '1.15', letterSpacing: '-0.018em', fontWeight: '400' }],
        feature:           ['2rem',      { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }],
        'feature-primary': ['2.125rem',  { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }],
        plan:              ['1.25rem',   { lineHeight: '1.3',                             fontWeight: '400' }],
        'grid-title':      ['1.125rem',  { lineHeight: '1.3',                             fontWeight: '400' }],
        q:                 ['1.0625rem', { lineHeight: '1.4',                             fontWeight: '400' }],
        sub:               ['1.03125rem',{ lineHeight: '1.55',                            fontWeight: '400' }],
        body:              ['0.9375rem', { lineHeight: '1.65',                            fontWeight: '400' }],
        'body-sm':         ['0.78125rem',{ lineHeight: '1.65',                            fontWeight: '400' }],
        meta:              ['0.75rem',   { lineHeight: '1.5',  letterSpacing: '0.1em',    fontWeight: '700' }],
        hint:              ['0.6875rem', { lineHeight: '1.5',                             fontWeight: '400' }],
      },
    },
  },
};

export default config;
```

- [ ] **Step 2: Replace placeholder body colors in globals.css with token classes**

```css
@layer base {
  body {
    @apply bg-cream-200 text-ink-900 font-sans;
  }
}
```

- [ ] **Step 3: Verify Tailwind picks up tokens — temporary test class**

In `web/src/app/page.tsx`, add a test paragraph: `<p className="text-display-1 font-serif text-margin-red">Tailwind test</p>`. Run `pnpm dev`. Expected: paragraph renders in 56px serif red.

Remove the test paragraph after verifying.

- [ ] **Step 4: Commit**

```bash
git add web/tailwind.config.ts web/src/styles/globals.css web/src/app/page.tsx
git commit -m "feat(web): add Notebook Craft Tailwind tokens (colors + typescale + fonts)"
```

---

### Task 3: Load Fraunces + Inter + Noto Serif JP via next/font

**Files:**
- Modify: `web/src/app/layout.tsx`
- Create: `web/src/lib/fonts.ts`

- [ ] **Step 1: Create web/src/lib/fonts.ts**

```ts
import { Fraunces, Inter, Noto_Serif_JP } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const notoSerifJP = Noto_Serif_JP({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-noto-serif-jp',
  display: 'swap',
  preload: false,  // only load when locale === 'ja' (done at [locale]/layout in Task 17)
});
```

- [ ] **Step 2: Apply font variables to <html> in root layout**

```tsx
// web/src/app/layout.tsx
import '@/styles/globals.css';
import { fraunces, inter } from '@/lib/fonts';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Visual verify in dev**

Edit `web/src/app/page.tsx` to render `<h1 className="font-serif text-display-1">Fraunces test</h1>` + `<p className="font-sans">Inter test</p>`. Run `pnpm dev`. Expected: H1 in Fraunces serif, body in Inter sans.

Revert the test edits.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/fonts.ts web/src/app/layout.tsx web/src/app/page.tsx
git commit -m "feat(web): load Fraunces + Inter via next/font; Noto Serif JP lazy"
```

---

### Task 4: Create env validation schema + .env.example

**Files:**
- Create: `web/src/lib/env.ts`
- Create: `web/.env.example`

- [ ] **Step 1: Install zod**

```bash
cd web && pnpm add zod
```

- [ ] **Step 2: Create web/src/lib/env.ts**

```ts
import { z } from 'zod';

const envSchema = z.object({
  // Required at runtime
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // DB (Phase I)
  DATABASE_URL: z.string().url().optional(),       // for local dev w/o IAM
  RDS_PROXY_ENDPOINT: z.string().optional(),       // prod: IAM-authed
  RDS_USERNAME: z.string().optional(),
  AWS_REGION: z.string().default('ap-northeast-1'),

  // Email (Phase J)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('auth@lisna.jp'),

  // OAuth (Phase J)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),  // JWT-signed, generated separately

  // Plausible
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().default('lisna.jp'),

  // GitHub Release (for /dl/dmg/latest redirect)
  GITHUB_OWNER: z.string().default('May1350'),
  GITHUB_REPO: z.string().default('Lisna'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 3: Create web/.env.example (no real values — names + shape only)**

```bash
# Auth.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=                # openssl rand -base64 32

# Database (Phase I)
# Local dev: use full Postgres URL
DATABASE_URL=postgresql://user:pass@localhost:5432/lisna
# Production: use RDS Proxy with IAM
# RDS_PROXY_ENDPOINT=<proxy-endpoint>.proxy-<id>.ap-northeast-1.rds.amazonaws.com
# RDS_USERNAME=lisna_web
# AWS_REGION=ap-northeast-1

# Email (Phase J)
RESEND_API_KEY=                 # re_...REDACTED
EMAIL_FROM=auth@lisna.jp

# OAuth providers (Phase J)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=

# Plausible
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=lisna.jp

# GitHub Releases (DMG redirect)
GITHUB_OWNER=May1350
GITHUB_REPO=Lisna
```

- [ ] **Step 4: Verify env loads (typecheck only — no runtime yet)**

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/env.ts web/.env.example web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): add zod env schema + .env.example template"
```

---

### Task 5: Add Vitest + testing-library setup

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/test/setup.ts`

- [ ] **Step 1: Install test deps**

```bash
cd web && pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom happy-dom
```

- [ ] **Step 2: Create web/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 3: Create web/src/test/setup.ts**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add test script to package.json**

```jsonc
// web/package.json — add to "scripts":
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Smoke test — write a trivial passing test**

Create `web/src/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:

```bash
cd web && pnpm test
```

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/vitest.config.ts web/src/test/setup.ts web/src/test/smoke.test.ts
git commit -m "feat(web): add Vitest + happy-dom + testing-library setup"
```

---

## Phase B — Design system foundation (Tasks 6-11)

Goal: `cn()` helper, Button + Input + Card primitives with CVA variants, Notebook background utilities (ruled paper + red margin), ScreenshotFrame. End of phase: a `/design-test` route renders all primitives in their variants.

### Task 6: cn.ts className composition helper

**Files:**
- Create: `web/src/lib/cn.ts`
- Test: `web/src/lib/cn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/cn.test.ts
import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins class strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('handles conditional values', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c');
  });
});
```

- [ ] **Step 2: Run — expect fail (module not found)**

```bash
cd web && pnpm test src/lib/cn.test.ts
```

- [ ] **Step 3: Implement cn.ts**

```ts
// web/src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run tests — expect 3/3 pass**

```bash
cd web && pnpm test src/lib/cn.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cn.ts web/src/lib/cn.test.ts
git commit -m "feat(web): add cn() helper (clsx + tailwind-merge)"
```

---

### Task 7: Button component with CVA variants

**Files:**
- Create: `web/src/components/ui/button.tsx`
- Test: `web/src/components/ui/button.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/ui/button.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Download for Mac</Button>);
    expect(screen.getByText('Download for Mac')).toBeInTheDocument();
  });
  it('applies primary-ink variant classes by default', () => {
    render(<Button>X</Button>);
    expect(screen.getByText('X')).toHaveClass('bg-ink-900');
  });
  it('applies ghost variant classes when specified', () => {
    render(<Button variant="ghost">X</Button>);
    expect(screen.getByText('X')).toHaveClass('border');
  });
  it('renders as <a> when asChild + an <a> is provided', () => {
    render(<Button asChild><a href="/download">D</a></Button>);
    const link = screen.getByText('D');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/download');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd web && pnpm test src/components/ui/button.test.tsx
```

- [ ] **Step 3: Implement button.tsx**

```tsx
// web/src/components/ui/button.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-sans transition-transform duration-150 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        'primary-ink':
          'bg-ink-900 text-cream-200 rounded-md shadow-[0_3px_0_rgba(0,0,0,0.25),0_6px_14px_rgba(60,40,20,0.18)] hover:-translate-y-px',
        ghost:
          'border border-ink-900/20 text-ink-900 rounded-md hover:bg-cream-100',
        'text-arrow':
          'text-ink-900 underline-offset-4 hover:underline',
      },
      size: {
        md: 'text-[16px] px-[30px] py-[18px]',
        sm: 'text-[14px] px-[22px] py-[14px]',
        lg: 'text-[17px] px-[34px] py-[20px]',
      },
    },
    defaultVariants: { variant: 'primary-ink', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
```

- [ ] **Step 4: Run tests — expect 4/4 pass**

```bash
cd web && pnpm test src/components/ui/button.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/button.tsx web/src/components/ui/button.test.tsx
git commit -m "feat(web): add Button with primary-ink/ghost/text-arrow CVA variants"
```

---

### Task 8: Input + EmailMagicLinkForm composite

**Files:**
- Create: `web/src/components/ui/input.tsx`
- Create: `web/src/components/ui/email-magic-link-form.tsx`
- Test: `web/src/components/ui/email-magic-link-form.test.tsx`

- [ ] **Step 1: Write Input (presentational only — no test)**

```tsx
// web/src/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-12 w-full rounded-md bg-cream-50 border border-ink-900/20 px-4 text-[15px] text-ink-900 placeholder:text-ink-700/50 focus:outline-none focus:border-ink-900/40 transition-colors',
        className,
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
```

- [ ] **Step 2: Write the failing test for EmailMagicLinkForm**

```tsx
// web/src/components/ui/email-magic-link-form.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailMagicLinkForm } from './email-magic-link-form';

describe('EmailMagicLinkForm', () => {
  it('calls onSubmit with the email', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EmailMagicLinkForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(onSubmit).toHaveBeenCalledWith('a@b.com');
  });
  it('disables the button while submitting', async () => {
    let resolve: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<EmailMagicLinkForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(screen.getByRole('button')).toBeDisabled();
    resolve();
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
cd web && pnpm test src/components/ui/email-magic-link-form.test.tsx
```

- [ ] **Step 4: Implement email-magic-link-form.tsx**

```tsx
// web/src/components/ui/email-magic-link-form.tsx
'use client';
import * as React from 'react';
import { Input } from './input';
import { Button } from './button';

export interface EmailMagicLinkFormProps {
  onSubmit: (email: string) => Promise<void>;
  hint?: string;
}

export function EmailMagicLinkForm({ onSubmit, hint }: EmailMagicLinkFormProps) {
  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(email);
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <p className="text-body text-ink-700">Magic link sent. Check your email.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="email"
          required
          placeholder="you@example.com"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send link'}
        </Button>
      </div>
      {hint && <p className="text-hint text-ink-700/60">{hint}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Run tests — expect 2/2 pass**

```bash
cd web && pnpm test src/components/ui/email-magic-link-form.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/input.tsx web/src/components/ui/email-magic-link-form.tsx web/src/components/ui/email-magic-link-form.test.tsx
git commit -m "feat(web): add Input + EmailMagicLinkForm composite"
```

---

### Task 9: Card component (cream + notebook variants)

**Files:**
- Create: `web/src/components/ui/card.tsx`

- [ ] **Step 1: Implement card.tsx (presentational; visual smoke only)**

```tsx
// web/src/components/ui/card.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const cardVariants = cva(
  'rounded-lg border border-ink-900/10 p-6',
  {
    variants: {
      variant: {
        cream:    'bg-cream-50',
        notebook: 'bg-cream-50 ruled-paper',
      },
    },
    defaultVariants: { variant: 'cream' },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
);
Card.displayName = 'Card';
```

- [ ] **Step 2: Typecheck verifies**

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/card.tsx
git commit -m "feat(web): add Card with cream + notebook variants"
```

---

### Task 10: Notebook background utilities (ruled-paper + red-margin + notebook-bg)

**Files:**
- Modify: `web/src/styles/globals.css`

- [ ] **Step 1: Append utilities layer to globals.css**

```css
@layer utilities {
  .ruled-paper {
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 30px,
      rgba(120, 100, 70, 0.07) 30px 31px
    );
  }

  .red-margin {
    position: relative;
  }
  .red-margin::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--margin-offset, 80px);
    width: 1px;
    background: rgba(184, 80, 80, 0.25);
    pointer-events: none;
  }

  .notebook-bg {
    background:
      linear-gradient(180deg, rgba(120, 100, 70, 0.02), rgba(120, 100, 70, 0.05)),
      theme('colors.cream.200');
    position: relative;
  }
}
```

- [ ] **Step 2: Smoke verify — apply to existing page.tsx**

Temporarily wrap content in `<div className="notebook-bg ruled-paper red-margin min-h-screen p-12">test</div>`. Run `pnpm dev`. Expected: cream bg with horizontal ruled lines + 1px vertical red line at left: 80px.

Revert the smoke edit.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/globals.css
git commit -m "feat(web): add notebook background utilities (ruled-paper + red-margin + notebook-bg)"
```

---

### Task 11: ScreenshotFrame component (window chrome)

**Files:**
- Create: `web/src/components/ui/screenshot-frame.tsx`

- [ ] **Step 1: Implement screenshot-frame.tsx**

```tsx
// web/src/components/ui/screenshot-frame.tsx
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ScreenshotFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function ScreenshotFrame({ title, className, children, ...props }: ScreenshotFrameProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-cream-50 overflow-hidden shadow-[0_6px_28px_rgba(60,40,20,0.18)] border border-ink-900/10',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-cream-300/60 border-b border-ink-900/10">
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-margin-red/70" />
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-accent-tan/70" />
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-accent-sage/70" />
        {title && <span className="ml-2 text-body-sm text-ink-700/80 font-sans">{title}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/screenshot-frame.tsx
git commit -m "feat(web): add ScreenshotFrame (macOS-style window chrome)"
```

---

## Phase C — Radix primitives (Tasks 12-15)

Goal: wrap Radix primitives with Notebook styling. Dropdown (for locale + avatar menu), Accordion (for FAQ), Dialog/Popover/Toast (form feedback + future use), Tabs (deferred uses).

### Task 12: Dropdown primitive (Radix)

**Files:**
- Create: `web/src/components/ui/dropdown.tsx`

- [ ] **Step 1: Implement dropdown.tsx wrapping Radix**

```tsx
// web/src/components/ui/dropdown.tsx
'use client';
import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/cn';

export const Dropdown = DropdownMenu.Root;
export const DropdownTrigger = DropdownMenu.Trigger;

export const DropdownContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'min-w-[180px] rounded-md border border-ink-900/10 bg-cream-50 p-1 shadow-[0_8px_24px_rgba(60,40,20,0.18)]',
        className,
      )}
      {...props}
    />
  </DropdownMenu.Portal>
));
DropdownContent.displayName = 'DropdownContent';

export const DropdownItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Item
    ref={ref}
    className={cn(
      'flex items-center gap-2 rounded-sm px-3 py-2 text-body text-ink-900 outline-none cursor-pointer data-[highlighted]:bg-cream-200',
      className,
    )}
    {...props}
  />
));
DropdownItem.displayName = 'DropdownItem';

export const DropdownSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Separator
    ref={ref}
    className={cn('my-1 h-px bg-ink-900/10', className)}
    {...props}
  />
));
DropdownSeparator.displayName = 'DropdownSeparator';
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/dropdown.tsx
git commit -m "feat(web): add Radix Dropdown wrapped with Notebook styling"
```

---

### Task 13: Accordion primitive (Radix)

**Files:**
- Create: `web/src/components/ui/accordion.tsx`

- [ ] **Step 1: Implement accordion.tsx**

```tsx
// web/src/components/ui/accordion.tsx
'use client';
import * as React from 'react';
import * as Acc from '@radix-ui/react-accordion';
import { cn } from '@/lib/cn';

export const Accordion = Acc.Root;
export const AccordionItem = React.forwardRef<
  React.ElementRef<typeof Acc.Item>,
  React.ComponentPropsWithoutRef<typeof Acc.Item>
>(({ className, ...props }, ref) => (
  <Acc.Item ref={ref} className={cn('border-b border-ink-900/10', className)} {...props} />
));
AccordionItem.displayName = 'AccordionItem';

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof Acc.Trigger>,
  React.ComponentPropsWithoutRef<typeof Acc.Trigger>
>(({ className, children, ...props }, ref) => (
  <Acc.Header className="flex">
    <Acc.Trigger
      ref={ref}
      className={cn(
        'flex flex-1 items-center justify-between py-4 text-q font-serif text-ink-900 transition-colors hover:bg-[rgba(184,80,80,0.03)] [&[data-state=open]>span]:rotate-45',
        className,
      )}
      {...props}
    >
      {children}
      <span className="ml-4 text-[22px] text-accent-tan transition-transform duration-200">+</span>
    </Acc.Trigger>
  </Acc.Header>
));
AccordionTrigger.displayName = 'AccordionTrigger';

export const AccordionContent = React.forwardRef<
  React.ElementRef<typeof Acc.Content>,
  React.ComponentPropsWithoutRef<typeof Acc.Content>
>(({ className, children, ...props }, ref) => (
  <Acc.Content
    ref={ref}
    className={cn(
      'overflow-hidden text-body text-ink-700 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
      className,
    )}
    {...props}
  >
    <div className="pb-4 pt-0">{children}</div>
  </Acc.Content>
));
AccordionContent.displayName = 'AccordionContent';
```

- [ ] **Step 2: Add accordion animation to tailwind.config.ts**

Modify `theme.extend` in `web/tailwind.config.ts`:

```ts
keyframes: {
  'accordion-down': {
    from: { height: '0' },
    to: { height: 'var(--radix-accordion-content-height)' },
  },
  'accordion-up': {
    from: { height: 'var(--radix-accordion-content-height)' },
    to: { height: '0' },
  },
},
animation: {
  'accordion-down': 'accordion-down 0.2s ease-out',
  'accordion-up': 'accordion-up 0.2s ease-out',
},
```

- [ ] **Step 3: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui/accordion.tsx web/tailwind.config.ts
git commit -m "feat(web): add Radix Accordion + slide animations"
```

---

### Task 14: Dialog + Popover + Toast primitives (batch)

**Files:**
- Create: `web/src/components/ui/dialog.tsx`
- Create: `web/src/components/ui/popover.tsx`
- Create: `web/src/components/ui/toast.tsx`

- [ ] **Step 1: Implement dialog.tsx (minimal Radix wrap)**

```tsx
// web/src/components/ui/dialog.tsx
'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-ink-900/10 bg-cream-50 p-6 shadow-[0_24px_64px_rgba(60,40,20,0.28)]',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
```

- [ ] **Step 2: Implement popover.tsx**

```tsx
// web/src/components/ui/popover.tsx
'use client';
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-ink-900/10 bg-cream-50 p-4 shadow-[0_8px_24px_rgba(60,40,20,0.18)]',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';
```

- [ ] **Step 3: Implement toast.tsx (basic Radix Toast.Provider wrap)**

```tsx
// web/src/components/ui/toast.tsx
'use client';
import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cn } from '@/lib/cn';

export const ToastProvider = ToastPrimitive.Provider;
export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'fixed bottom-4 right-4 z-50 flex max-h-screen w-full max-w-md flex-col gap-2',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      'flex items-start gap-3 rounded-md border border-ink-900/10 bg-cream-50 p-4 shadow-[0_8px_24px_rgba(60,40,20,0.18)]',
      className,
    )}
    {...props}
  />
));
Toast.displayName = 'Toast';

export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;
export const ToastClose = ToastPrimitive.Close;
```

- [ ] **Step 4: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/dialog.tsx web/src/components/ui/popover.tsx web/src/components/ui/toast.tsx
git commit -m "feat(web): add Radix Dialog + Popover + Toast wrappers"
```

---

### Task 15: Tabs primitive (Radix — deferred uses)

**Files:**
- Create: `web/src/components/ui/tabs.tsx`

- [ ] **Step 1: Implement tabs.tsx**

```tsx
// web/src/components/ui/tabs.tsx
'use client';
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex gap-4 border-b border-ink-900/10', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-1 pb-2 text-body text-ink-700 transition-colors data-[state=active]:text-ink-900 data-[state=active]:border-b-2 data-[state=active]:border-margin-red -mb-px',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/ui/tabs.tsx
git commit -m "feat(web): add Radix Tabs wrapper"
```

---

## Phase D — i18n setup with next-intl (Tasks 16-20)

Goal: `/[locale]/...` routing, en/ja/ko message files, LocaleSwitcher component, Noto Serif JP lazy-loaded for `ja` only, middleware for Accept-Language detection. End of phase: visiting `/` redirects to `/en/`, `/ja/`, or `/ko/` based on `Accept-Language`; switching locale updates URL + cookie.

### Task 16: Install next-intl + i18n config

**Files:**
- Modify: `web/package.json`
- Create: `web/src/lib/i18n.ts`
- Create: `web/src/i18n/routing.ts`

- [ ] **Step 1: Install next-intl**

```bash
cd web && pnpm add next-intl
```

- [ ] **Step 2: Create web/src/i18n/routing.ts**

```ts
// web/src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ja', 'ko'],
  defaultLocale: 'en',
  localeDetection: true,
  localePrefix: 'as-needed',  // /en is implicit; /ja and /ko are explicit
});

export type Locale = (typeof routing.locales)[number];
```

- [ ] **Step 3: Create web/src/lib/i18n.ts (request config)**

```ts
// web/src/lib/i18n.ts
import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 4: Configure next.config.ts**

Modify `web/next.config.ts`:

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n.ts');

const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/((?!success|cancel|trial-success|trial-cancel).*)',
        headers: [{ key: 'x-robots-tag', value: 'index, follow' }],
      },
    ];
  },
};

export default withNextIntl(config);
```

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/i18n/routing.ts web/src/lib/i18n.ts web/next.config.ts
git commit -m "feat(web): install next-intl + locale routing config"
```

---

### Task 17: Create middleware + [locale] layout

**Files:**
- Create: `web/middleware.ts`
- Create: `web/src/app/[locale]/layout.tsx`
- Delete: existing pages we will replace under [locale] (move content into new locale-aware routes) — to be done in subsequent tasks

- [ ] **Step 1: Create middleware**

```ts
// web/middleware.ts
import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all paths except API, _next, static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

- [ ] **Step 2: Create [locale] layout with conditional JP font**

```tsx
// web/src/app/[locale]/layout.tsx
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import { notoSerifJP } from '@/lib/fonts';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  // Conditionally apply JP serif variable only for ja locale
  const localeFontClass = locale === 'ja' ? notoSerifJP.variable : '';

  return (
    <div className={localeFontClass} data-locale={locale}>
      <NextIntlClientProvider locale={locale as Locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </div>
  );
}
```

- [ ] **Step 3: Move existing home page into [locale]**

Move `web/src/app/page.tsx` → `web/src/app/[locale]/page.tsx`. Existing inline-styled content is OK for now; we replace it in Phase F.

```bash
mkdir -p web/src/app/'[locale]'
git mv web/src/app/page.tsx web/src/app/'[locale]'/page.tsx
```

- [ ] **Step 4: Smoke — visit /en, /ja, /ko**

Run `pnpm dev`. Visit:
- `http://localhost:3000/` → expect redirect to `/en` (or no prefix per `as-needed`)
- `http://localhost:3000/ja` → expect home renders, `data-locale="ja"` on the wrapper
- `http://localhost:3000/ko` → expect home renders, `data-locale="ko"`

Expected: all 3 locales serve the home page; URL prefix logic respected.

- [ ] **Step 5: Commit**

```bash
git add web/middleware.ts 'web/src/app/[locale]/layout.tsx' 'web/src/app/[locale]/page.tsx' web/src/app/page.tsx
git commit -m "feat(web): add next-intl middleware + [locale] layout with conditional JP font"
```

---

### Task 18: Create message files (en/ja/ko stubs)

**Files:**
- Create: `web/src/messages/en.json`
- Create: `web/src/messages/ja.json`
- Create: `web/src/messages/ko.json`

- [ ] **Step 1: Create en.json with hero + nav keys (rest filled per page in later tasks)**

```json
{
  "nav": {
    "product": "Product",
    "pricing": "Pricing",
    "docs": "Docs",
    "changelog": "Changelog",
    "signin": "Sign in",
    "dashboard": "Dashboard",
    "signout": "Sign out"
  },
  "hero": {
    "h1Line1": "Your lectures,",
    "h1Line2Prefix": "in ",
    "h1Line2Emphasis": "your",
    "h1Line2Suffix": " notes.",
    "sub": "Real-time transcription + structured summaries. 100% on-device — your audio never leaves your Mac.",
    "cta": "Download for Mac →",
    "hint": "macOS 13+ · Free during alpha · Apple Silicon · 537 MB"
  },
  "trust": {
    "label": "EARLY USE AT",
    "keio": "Keio University"
  },
  "footer": {
    "tagline": "Lecture-notes app for students and researchers. Made in Tokyo. 100% on-device.",
    "productHeading": "Product",
    "docsHeading": "Docs",
    "communityHeading": "Community",
    "legalHeading": "Legal",
    "copyright": "© 2026 Lisna · All rights reserved"
  }
}
```

- [ ] **Step 2: Create ja.json — same keys, JP translations**

```json
{
  "nav": {
    "product": "プロダクト",
    "pricing": "料金",
    "docs": "ドキュメント",
    "changelog": "更新履歴",
    "signin": "サインイン",
    "dashboard": "ダッシュボード",
    "signout": "サインアウト"
  },
  "hero": {
    "h1Line1": "講義を、",
    "h1Line2Prefix": "",
    "h1Line2Emphasis": "あなたの",
    "h1Line2Suffix": "ノートに。",
    "sub": "リアルタイム文字起こし + 構造化されたサマリー。100% オンデバイス — 音声が Mac から出ることはありません。",
    "cta": "Macアプリをダウンロード →",
    "hint": "macOS 13+ · アルファ版無料 · Apple Silicon · 537 MB"
  },
  "trust": {
    "label": "アルファ版を試している大学",
    "keio": "慶應義塾大学"
  },
  "footer": {
    "tagline": "学生・研究者のための講義ノートアプリ。東京で開発。100% オンデバイス。",
    "productHeading": "プロダクト",
    "docsHeading": "ドキュメント",
    "communityHeading": "コミュニティ",
    "legalHeading": "法的事項",
    "copyright": "© 2026 Lisna · All rights reserved"
  }
}
```

- [ ] **Step 3: Create ko.json — same keys, KO translations**

```json
{
  "nav": {
    "product": "제품",
    "pricing": "요금",
    "docs": "문서",
    "changelog": "릴리스 노트",
    "signin": "로그인",
    "dashboard": "대시보드",
    "signout": "로그아웃"
  },
  "hero": {
    "h1Line1": "당신의 강의가",
    "h1Line2Prefix": "",
    "h1Line2Emphasis": "당신의",
    "h1Line2Suffix": " 노트로.",
    "sub": "실시간 전사 + 구조화된 요약. 100% 온디바이스 — 음성이 Mac 을 떠나지 않습니다.",
    "cta": "Mac 앱 다운로드 →",
    "hint": "macOS 13+ · 알파 무료 · Apple Silicon · 537 MB"
  },
  "trust": {
    "label": "얼리 어답터",
    "keio": "게이오 대학"
  },
  "footer": {
    "tagline": "학생과 연구자를 위한 강의 노트 앱. 도쿄에서 개발. 100% 온디바이스.",
    "productHeading": "제품",
    "docsHeading": "문서",
    "communityHeading": "커뮤니티",
    "legalHeading": "법적 사항",
    "copyright": "© 2026 Lisna · All rights reserved"
  }
}
```

- [ ] **Step 4: Verify all 3 locales typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add web/src/messages/
git commit -m "feat(web): add en/ja/ko message files — nav + hero + footer keys"
```

---

### Task 19: LocaleSwitcher component

**Files:**
- Create: `web/src/components/ui/locale-switcher.tsx`
- Test: `web/src/components/ui/locale-switcher.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/ui/locale-switcher.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleSwitcher } from './locale-switcher';

describe('LocaleSwitcher', () => {
  it('renders current locale label', () => {
    render(<LocaleSwitcher currentLocale="en" pathname="/" />);
    expect(screen.getByRole('button', { name: /EN/i })).toBeInTheDocument();
  });
  it('shows JP flag/label for ja locale', () => {
    render(<LocaleSwitcher currentLocale="ja" pathname="/" />);
    expect(screen.getByRole('button', { name: /日本語/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd web && pnpm test src/components/ui/locale-switcher.test.tsx
```

- [ ] **Step 3: Implement locale-switcher.tsx**

```tsx
// web/src/components/ui/locale-switcher.tsx
'use client';
import * as React from 'react';
import Link from 'next/link';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from './dropdown';
import type { Locale } from '@/i18n/routing';

const LABELS: Record<Locale, string> = {
  en: 'EN',
  ja: '日本語',
  ko: '한국어',
};

const ALL: Locale[] = ['en', 'ja', 'ko'];

function stripLocale(pathname: string): string {
  // Remove leading /en, /ja, /ko if present
  return pathname.replace(/^\/(en|ja|ko)(?=\/|$)/, '') || '/';
}

export interface LocaleSwitcherProps {
  currentLocale: Locale;
  pathname: string;
}

export function LocaleSwitcher({ currentLocale, pathname }: LocaleSwitcherProps) {
  const basePath = stripLocale(pathname);
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={`Locale: ${LABELS[currentLocale]}`}
        className="inline-flex items-center gap-1 text-body text-ink-900 hover:text-margin-red transition-colors"
      >
        {LABELS[currentLocale]} <span className="text-[10px]">▾</span>
      </DropdownTrigger>
      <DropdownContent align="end">
        {ALL.map((loc) => (
          <DropdownItem key={loc} asChild>
            <Link href={loc === 'en' ? basePath : `/${loc}${basePath}`}>
              {LABELS[loc]}
            </Link>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
```

- [ ] **Step 4: Run tests — expect 2/2 pass**

```bash
cd web && pnpm test src/components/ui/locale-switcher.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/locale-switcher.tsx web/src/components/ui/locale-switcher.test.tsx
git commit -m "feat(web): add LocaleSwitcher dropdown"
```

---

### Task 20: Locale routing smoke + cookie persistence

**Files:**
- (verification-only task; no new files)

- [ ] **Step 1: Smoke test — verify Accept-Language detection**

Run `pnpm dev`. With curl:

```bash
curl -sI http://localhost:3000/ -H 'Accept-Language: ja' | grep -iE 'location|set-cookie'
```

Expected: redirect to `/ja`, or render `/` with `NEXT_LOCALE=ja` cookie (next-intl behavior with `localePrefix: 'as-needed'`).

- [ ] **Step 2: Smoke test — manual switcher updates URL**

Temporarily add `<LocaleSwitcher currentLocale="en" pathname="/" />` to `[locale]/page.tsx`. Run dev server, click switcher, pick `日本語`, verify URL becomes `/ja`.

Revert the manual addition (it'll be properly wired into NavBar in Task 22).

- [ ] **Step 3: Run all tests + typecheck**

```bash
cd web && pnpm test && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit (no-op if nothing changed; otherwise revert smoke)**

If any smoke edits remain, revert before next task. No commit needed if tree is clean.

---

## Phase E — Layout shells + navigation (Tasks 21-25)

Goal: NavBar (public + auth variants), Footer (5-column), MarketingShell, AuthShell, DashboardShell. End of phase: every page wraps in a consistent layout; nav switches between guest/auth context.

### Task 21: NavBar component

**Files:**
- Create: `web/src/components/ui/navbar.tsx`

- [ ] **Step 1: Implement navbar.tsx (server component reading locale + session)**

```tsx
// web/src/components/ui/navbar.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from './locale-switcher';
import type { Locale } from '@/i18n/routing';

export interface NavBarProps {
  locale: Locale;
  pathname: string;
  authState: 'guest' | { name: string; email: string; image?: string | null };
}

export async function NavBar({ locale, pathname, authState }: NavBarProps) {
  const t = await getTranslations('nav');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <nav className="fixed top-0 inset-x-0 z-40 backdrop-blur-md bg-cream-200/70 border-b border-ink-900/5">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
        <Link href={`${prefix}/`} className="font-serif text-[18px] text-ink-900">Lisna</Link>
        <div className="flex items-center gap-6 text-body text-ink-900">
          <Link href={`${prefix}/#features`}>{t('product')}</Link>
          <Link href={`${prefix}/pricing`}>{t('pricing')}</Link>
          <Link href={`${prefix}/docs/getting-started`}>{t('docs')}</Link>
          <Link href={`${prefix}/changelog`}>{t('changelog')}</Link>
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
          {authState === 'guest' ? (
            <Link href={`${prefix}/signin`} className="underline underline-offset-4">
              {t('signin')}
            </Link>
          ) : (
            <Link href={`${prefix}/dashboard`} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-accent-tan text-cream-50 text-body-sm grid place-items-center font-serif">
                {authState.name?.[0]?.toUpperCase() ?? '·'}
              </span>
              <span>{authState.name}</span>
              <span className="text-[10px]">▾</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/navbar.tsx
git commit -m "feat(web): add NavBar (locale-aware + guest/auth states)"
```

---

### Task 22: Footer component

**Files:**
- Create: `web/src/components/ui/footer.tsx`

- [ ] **Step 1: Implement footer.tsx**

```tsx
// web/src/components/ui/footer.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export interface FooterProps {
  locale: Locale;
}

export async function Footer({ locale }: FooterProps) {
  const t = await getTranslations('footer');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <footer className="bg-ink-900 text-cream-200/60 mt-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-12 py-16 grid grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] gap-10">
        <div>
          <h4 className="font-serif text-[18px] text-cream-200 mb-4">Lisna</h4>
          <p className="text-body-sm text-cream-200/70 leading-relaxed">{t('tagline')}</p>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('productHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/#features`}>Features</Link></li>
            <li><Link href={`${prefix}/pricing`}>Pricing</Link></li>
            <li><Link href={`${prefix}/download`}>Download</Link></li>
            <li><Link href={`${prefix}/changelog`}>Changelog</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('docsHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/docs/getting-started`}>Getting started</Link></li>
            <li><Link href={`${prefix}/docs/faq`}>FAQ</Link></li>
            <li><Link href={`${prefix}/compare`}>Compare</Link></li>
            <li><Link href={`${prefix}/download#system-requirements`}>System reqs</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('communityHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><a href="https://discord.gg/69NkqBTbS" target="_blank" rel="noreferrer">Discord</a></li>
            <li><a href="https://github.com/May1350/Lisna" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href="https://bsky.app/profile/lisna.jp" target="_blank" rel="noreferrer">Bluesky</a></li>
            <li><a href="https://github.com/May1350/Lisna/issues" target="_blank" rel="noreferrer">Bug reports</a></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('legalHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/privacy`}>Privacy</Link></li>
            <li><Link href={`${prefix}/terms`}>Terms</Link></li>
            <li><Link href={`${prefix}/tokusho`}>Tokusho</Link></li>
            <li><Link href={`${prefix}/refunds`}>Refunds</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-cream-200/10 px-6 lg:px-12 py-6 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-body-sm">
        <p>{t('copyright')}</p>
        <p>EN · 日本語 · 한국어</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/footer.tsx
git commit -m "feat(web): add 5-column Footer with i18n + Discord/GitHub links"
```

---

### Task 23: MarketingShell layout

**Files:**
- Create: `web/src/components/layout/marketing-shell.tsx`

- [ ] **Step 1: Implement marketing-shell.tsx**

```tsx
// web/src/components/layout/marketing-shell.tsx
import { headers } from 'next/headers';
import { NavBar } from '@/components/ui/navbar';
import { Footer } from '@/components/ui/footer';
import { getAuthState } from '@/lib/auth-state';  // placeholder helper; implemented in Task 53
import type { Locale } from '@/i18n/routing';

export interface MarketingShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function MarketingShell({ locale, children }: MarketingShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  // Until Phase J lands, getAuthState always returns 'guest':
  const authState = await getAuthState();
  return (
    <div className="notebook-bg min-h-screen">
      <NavBar locale={locale} pathname={pathname} authState={authState} />
      <main className="pt-14">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}
```

- [ ] **Step 2: Create lib/auth-state.ts placeholder (returns 'guest' until Phase J)**

```ts
// web/src/lib/auth-state.ts
export async function getAuthState(): Promise<'guest' | { name: string; email: string; image?: string | null }> {
  // Phase J wires this to Auth.js session
  return 'guest';
}
```

- [ ] **Step 3: Add x-pathname header in middleware**

Modify `web/middleware.ts`:

```ts
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './src/i18n/routing';

const intl = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const res = intl(req);
  res.headers.set('x-pathname', req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

- [ ] **Step 4: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/marketing-shell.tsx web/src/lib/auth-state.ts web/middleware.ts
git commit -m "feat(web): add MarketingShell + x-pathname header for nav active states"
```

---

### Task 24: AuthShell layout (minimal — Lisna brand only)

**Files:**
- Create: `web/src/components/layout/auth-shell.tsx`

- [ ] **Step 1: Implement auth-shell.tsx**

```tsx
// web/src/components/layout/auth-shell.tsx
import Link from 'next/link';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { headers } from 'next/headers';
import type { Locale } from '@/i18n/routing';

export interface AuthShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function AuthShell({ locale, children }: AuthShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <div className="notebook-bg ruled-paper red-margin min-h-screen">
      <nav className="absolute top-0 inset-x-0 z-40 backdrop-blur-md bg-cream-200/60">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
          <Link href={`${prefix}/`} className="font-serif text-[18px] text-ink-900">Lisna</Link>
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
        </div>
      </nav>
      <main className="pt-14 min-h-screen grid place-items-center px-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/layout/auth-shell.tsx
git commit -m "feat(web): add AuthShell (minimal nav for signin/auth pages)"
```

---

### Task 25: DashboardShell layout

**Files:**
- Create: `web/src/components/layout/dashboard-shell.tsx`

- [ ] **Step 1: Implement dashboard-shell.tsx**

```tsx
// web/src/components/layout/dashboard-shell.tsx
import { headers } from 'next/headers';
import { NavBar } from '@/components/ui/navbar';
import { Footer } from '@/components/ui/footer';
import { getAuthState } from '@/lib/auth-state';
import type { Locale } from '@/i18n/routing';

export interface DashboardShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function DashboardShell({ locale, children }: DashboardShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  const authState = await getAuthState();
  return (
    <div className="notebook-bg min-h-screen">
      <NavBar locale={locale} pathname={pathname} authState={authState} />
      <main className="pt-14 mx-auto max-w-7xl px-6 lg:px-12 py-12">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/layout/dashboard-shell.tsx
git commit -m "feat(web): add DashboardShell for authenticated routes"
```

---

## Phase F — Home page sections (Tasks 26-36)

Goal: build all marketing components, assemble 12-section home, verify visual hierarchy. Mockups in `.superpowers/brainstorm/36028-1779191707/content/lisna-home-d3-keio.html` and `lisna-home-d3.html` are the visual ground truth — components must match the rendered HTML.

### Task 26: Hero component

**Files:**
- Create: `web/src/components/marketing/hero.tsx`

- [ ] **Step 1: Implement hero.tsx**

```tsx
// web/src/components/marketing/hero.tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScreenshotFrame } from '@/components/ui/screenshot-frame';

export function Hero() {
  const t = useTranslations('hero');
  return (
    <section className="red-margin relative mx-auto max-w-7xl px-6 lg:px-24 py-24 lg:py-32">
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 lg:gap-20 items-center">
        <div>
          <h1 className="font-serif text-display-1 text-ink-900 leading-[1.05]">
            {t('h1Line1')}<br />
            {t('h1Line2Prefix')}
            <em className="font-serif italic text-accent-tan text-[1.05em]">{t('h1Line2Emphasis')}</em>
            {t('h1Line2Suffix')}
          </h1>
          <p className="mt-6 font-sans text-sub text-ink-700 max-w-[42ch]">{t('sub')}</p>
          <div className="mt-10">
            <Button asChild size="md">
              <Link href="/dl/dmg/latest">{t('cta')}</Link>
            </Button>
          </div>
          <p className="mt-3 text-hint text-ink-700/60">{t('hint')}</p>
        </div>
        <div>
          <ScreenshotFrame title="Real Analysis · Lecture 3">
            <div className="font-sans text-body-sm text-ink-700 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-margin-red animate-pulse" />
                <span className="text-meta uppercase">Live</span>
                <span className="ml-auto text-hint">04:32</span>
              </div>
              <div className="flex gap-px h-10 items-end">
                {Array.from({ length: 20 }).map((_, i) => (
                  <span
                    key={i}
                    className={i >= 8 && i <= 10 ? 'w-1.5 bg-margin-red rounded-sm' : 'w-1.5 bg-ink-700/30 rounded-sm'}
                    style={{ height: `${30 + Math.sin(i) * 20 + (i % 3) * 8}%` }}
                  />
                ))}
              </div>
              <div className="border-t border-dashed border-ink-900/15 pt-3">
                <p className="text-body-sm"><span className="text-hint text-accent-tan mr-2">04:25</span>The Bolzano-Weierstrass theorem states that…</p>
              </div>
              <div className="border-t border-dashed border-ink-900/15 pt-3">
                <p className="text-meta uppercase text-accent-tan">Note · auto-generated</p>
                <h4 className="font-serif text-grid-title mt-1">§ Compactness</h4>
                <ul className="mt-2 space-y-1 text-body-sm">
                  <li>· Bolzano-Weierstrass</li>
                  <li>· Heine-Cantor</li>
                </ul>
              </div>
            </div>
          </ScreenshotFrame>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/marketing/hero.tsx
git commit -m "feat(web): add Hero (locked design — D3 single CTA + screenshot frame)"
```

---

### Task 27: TrustStrip component (Keio only)

**Files:**
- Create: `web/src/components/marketing/trust-strip.tsx`

- [ ] **Step 1: Implement trust-strip.tsx**

```tsx
// web/src/components/marketing/trust-strip.tsx
import { useTranslations } from 'next-intl';

export function TrustStrip() {
  const t = useTranslations('trust');
  return (
    <section className="border-y border-ink-900/8 bg-cream-50/50 py-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-24 text-center">
        <p className="text-meta uppercase tracking-[0.18em] text-ink-700/55">{t('label')}</p>
        <p className="mt-4 font-serif italic text-[22px] text-ink-900/88">{t('keio')}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/marketing/trust-strip.tsx
git commit -m "feat(web): add TrustStrip with Keio-only honest early-use signal"
```

---

### Task 28: FeatureBlock with alt/reverse/primary variants

**Files:**
- Create: `web/src/components/marketing/feature-block.tsx`

- [ ] **Step 1: Implement feature-block.tsx**

```tsx
// web/src/components/marketing/feature-block.tsx
import { cn } from '@/lib/cn';

export interface FeatureBlockProps {
  eyebrow: string;
  headline: React.ReactNode;     // includes <em> for emphasis
  body: string;
  meta: string[];
  image: React.ReactNode;        // screenshot or illustration
  variant?: 'default' | 'reverse' | 'primary';
}

export function FeatureBlock({ eyebrow, headline, body, meta, image, variant = 'default' }: FeatureBlockProps) {
  const reverse = variant === 'reverse';
  const isPrimary = variant === 'primary';
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-24 py-24">
      <div className={cn(
        'grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center',
        reverse && 'lg:[&>div:first-child]:order-2',
      )}>
        <div>
          <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
          <h3 className={cn(
            'mt-3 font-serif leading-[1.15] text-ink-900',
            isPrimary ? 'text-feature-primary' : 'text-feature',
          )}>
            {headline}
          </h3>
          <p className="mt-5 font-sans text-body text-ink-700 leading-[1.65] max-w-[52ch]">{body}</p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-ink-700/80">
            {meta.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
        <div>{image}</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/marketing/feature-block.tsx
git commit -m "feat(web): add FeatureBlock with alt/reverse/primary variants"
```

---

### Task 29: Marginalia pull-quote component

**Files:**
- Create: `web/src/components/marketing/marginalia.tsx`

- [ ] **Step 1: Implement marginalia.tsx**

```tsx
// web/src/components/marketing/marginalia.tsx
export function Marginalia({ children }: { children: React.ReactNode }) {
  return (
    <section className="red-margin relative border-b border-dashed border-ink-900/15 py-6">
      <div className="relative mx-auto max-w-7xl px-6 lg:px-24">
        <span aria-hidden className="absolute left-[88px] top-1/2 -translate-y-1/2 text-[12px] text-margin-red/70 hidden lg:inline">
          ✎
        </span>
        <p className="font-serif italic text-accent-tan text-[18px] lg:text-[20px] text-center lg:text-left lg:pl-32 max-w-[60ch] mx-auto lg:mx-0">
          {children}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/marketing/marginalia.tsx
git commit -m "feat(web): add Marginalia pull-quote (✎ glyph + tan italic)"
```

---

### Task 30: PrivacyEmphasis dark section (100% stat + 6-grid)

**Files:**
- Create: `web/src/components/marketing/privacy-emphasis.tsx`

- [ ] **Step 1: Implement privacy-emphasis.tsx**

```tsx
// web/src/components/marketing/privacy-emphasis.tsx
export interface PrivacyEmphasisProps {
  eyebrow: string;
  headline: React.ReactNode;
  statValue: string;       // "100%"
  statSub: string;
  items: { title: string; body: string }[];
}

export function PrivacyEmphasis({ eyebrow, headline, statValue, statSub, items }: PrivacyEmphasisProps) {
  return (
    <section className="bg-ink-900 text-cream-200 py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-24 grid lg:grid-cols-[5fr_4fr] gap-16">
        <div>
          <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
          <h2 className="mt-4 font-serif text-h2 text-cream-200 leading-[1.1]">{headline}</h2>
          <div className="mt-12">
            <p className="font-serif italic text-[72px] leading-none text-accent-tan">{statValue}</p>
            <p className="mt-3 font-sans text-body text-cream-200/78 max-w-[36ch]">{statSub}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((it, i) => (
            <div key={i}>
              <h4 className="font-serif text-grid-title text-cream-200">{it.title}</h4>
              <p className="mt-2 font-sans text-body-sm text-cream-200/70 leading-[1.65]">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/marketing/privacy-emphasis.tsx
git commit -m "feat(web): add PrivacyEmphasis (dark + 100% stat + 6-grid differentiator)"
```

---

### Task 31: PricingCards component

**Files:**
- Create: `web/src/components/marketing/pricing-cards.tsx`

- [ ] **Step 1: Implement pricing-cards.tsx**

```tsx
// web/src/components/marketing/pricing-cards.tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import Link from 'next/link';

export interface PricingPlan {
  name: string;
  amount: string;       // "$0" or "$?"
  period: string;       // "/forever during alpha" or "/month (post-alpha)"
  badge?: { label: string; tone: 'free' | 'soon' };
  features: string[];
  cta?: { label: string; href: string };
  highlighted?: boolean;
}

export interface PricingCardsProps {
  heading: string;
  sub: string;
  plans: [PricingPlan, PricingPlan];
}

export function PricingCards({ heading, sub, plans }: PricingCardsProps) {
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-24 py-24">
      <div className="text-center">
        <h2 className="font-serif text-h2-sm text-ink-900">{heading}</h2>
        <p className="mt-4 font-sans text-body text-ink-700 max-w-[52ch] mx-auto">{sub}</p>
      </div>
      <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {plans.map((plan, i) => (
          <article
            key={i}
            className={cn(
              'rounded-lg bg-cream-50 p-10',
              plan.highlighted ? 'border-[1.5px] border-margin-red' : 'border border-ink-900/10',
            )}
          >
            {plan.badge && (
              <span className={cn(
                'inline-block text-meta uppercase tracking-[0.12em] px-2 py-0.5 rounded-sm',
                plan.badge.tone === 'free' ? 'bg-margin-red/10 text-margin-red' : 'bg-ink-900/10 text-ink-700',
              )}>
                {plan.badge.label}
              </span>
            )}
            <h3 className="mt-3 font-serif text-plan text-ink-900">{plan.name}</h3>
            <p className="mt-4">
              <span className="font-serif text-display-2 text-ink-900">{plan.amount}</span>
              <span className="ml-2 font-sans text-body text-ink-700/70">{plan.period}</span>
            </p>
            <ul className="mt-8 space-y-3 text-body text-ink-700">
              {plan.features.map((f, j) => <li key={j}>· {f}</li>)}
            </ul>
            {plan.cta && (
              <div className="mt-10">
                <Button asChild variant={plan.highlighted ? 'primary-ink' : 'ghost'} size="md">
                  <Link href={plan.cta.href}>{plan.cta.label}</Link>
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/marketing/pricing-cards.tsx
git commit -m "feat(web): add PricingCards (Alpha + Pro placeholder)"
```

---

### Task 32: FAQAccordion component

**Files:**
- Create: `web/src/components/marketing/faq-accordion.tsx`

- [ ] **Step 1: Implement faq-accordion.tsx**

```tsx
// web/src/components/marketing/faq-accordion.tsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

export interface FAQEntry {
  q: string;
  a: React.ReactNode;
}

export interface FAQAccordionProps {
  eyebrow: string;
  heading: React.ReactNode;
  entries: FAQEntry[];
}

export function FAQAccordion({ eyebrow, heading, entries }: FAQAccordionProps) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-h2-sm text-ink-900">{heading}</h2>
      <Accordion type="single" collapsible className="mt-10">
        {entries.map((entry, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{entry.q}</AccordionTrigger>
            <AccordionContent>{entry.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/marketing/faq-accordion.tsx
git commit -m "feat(web): add FAQAccordion (Radix + Notebook styling)"
```

---

### Task 33: CTAStrip component

**Files:**
- Create: `web/src/components/marketing/cta-strip.tsx`

- [ ] **Step 1: Implement cta-strip.tsx**

```tsx
// web/src/components/marketing/cta-strip.tsx
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function CTAStrip() {
  const t = useTranslations('hero');
  return (
    <section className="bg-cream-300 border-t-[1px] border-margin-red/30">
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">START</p>
        <h2 className="mt-3 font-serif text-h1 text-ink-900">
          Ready to <em className="italic text-accent-tan">focus</em>?
        </h2>
        <p className="mt-5 font-sans text-body text-ink-700 max-w-[52ch] mx-auto">
          Free during alpha. Sign in inside the app on first launch.
        </p>
        <div className="mt-10">
          <Button asChild size="lg">
            <Link href="/dl/dmg/latest">{t('cta')}</Link>
          </Button>
        </div>
        <p className="mt-3 text-hint text-ink-700/60">macOS 13+ · Apple Silicon · 537 MB</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/marketing/cta-strip.tsx
git commit -m "feat(web): add CTAStrip section (warm cream + duplicate Download CTA)"
```

---

### Task 34: Add home-page i18n keys (features + privacy + pricing + faq + cta)

**Files:**
- Modify: `web/src/messages/en.json`
- Modify: `web/src/messages/ja.json`
- Modify: `web/src/messages/ko.json`

- [ ] **Step 1: Append the following keys to each locale (en first)**

Add to `en.json`:

```jsonc
{
  // ... existing nav/hero/trust/footer ...
  "features": {
    "stt": {
      "eyebrow": "REAL-TIME STT",
      "headlineBefore": "Transcribe as your ",
      "headlineEm": "professor speaks",
      "headlineAfter": ".",
      "body": "Whisper runs on your Mac. No upload, no waiting. Captions appear live, second-by-second, with timestamps.",
      "metaA": "→ Whisper",
      "metaB": "→ Live captions",
      "metaC": "→ JA / EN / KO"
    },
    "privacy": {
      "eyebrow": "ON-DEVICE PRIVACY",
      "headlineBefore": "Your audio ",
      "headlineEm": "never leaves your Mac",
      "headlineAfter": ".",
      "body": "Whisper + Llama models run locally. No cloud transcription, no recording uploaded, no third-party data processor.",
      "metaA": "→ 100% local",
      "metaB": "→ No telemetry",
      "metaC": "→ Open source models"
    },
    "notes": {
      "eyebrow": "STRUCTURED NOTES",
      "headlineBefore": "Not a wall of text — a ",
      "headlineEm": "study-ready note",
      "headlineAfter": ".",
      "body": "Llama 3.2 extracts sections, key terms, and bullets. Formatted as Markdown, ready to read or edit.",
      "metaA": "→ Llama 3.2 3B",
      "metaB": "→ Markdown",
      "metaC": "→ Section detection"
    },
    "export": {
      "eyebrow": "EXPORT ANYWHERE",
      "headlineBefore": "Drops into your ",
      "headlineEm": "Obsidian vault",
      "headlineAfter": ".",
      "body": "Markdown export means your notes live where you live. Obsidian, Notion, plain folder, anywhere your editor reads .md.",
      "metaA": "→ Works with Obsidian",
      "metaB": "→ Markdown",
      "metaC": "→ PDF"
    },
    "marginalia": "No upload. No cloud. No data processor — your lecture, your laptop, your notes."
  },
  "privacyEmphasis": {
    "eyebrow": "PRIVACY BY DEFAULT",
    "headlineBefore": "Built for people who ",
    "headlineEm": "read the docs",
    "headlineAfter": ".",
    "statValue": "100%",
    "statSub": "of audio stays on your Mac. Not 99.9% — actually all of it.",
    "item1Title": "Local STT",
    "item1Body": "Whisper runs on-device.",
    "item2Title": "Local LLM",
    "item2Body": "Llama 3.2 runs on-device.",
    "item3Title": "No telemetry",
    "item3Body": "Lisna doesn't ping our servers with usage data. Plausible on website only (anonymous, no cookies).",
    "item4Title": "Open models",
    "item4Body": "Whisper (MIT) + Llama 3.2 (Meta license). Audit the files; they run unmodified.",
    "item5Title": "Notes on disk",
    "item5Body": "Markdown on your Mac. Sync to Obsidian / iCloud / Dropbox — your choice.",
    "item6Title": "Account = email only",
    "item6Body": "Email + signin metadata. No transcription content ever touches our database."
  },
  "pricingSection": {
    "heading": "Free during alpha.",
    "sub": "Pay only when alpha ends — at fair, predictable pricing.",
    "alphaBadge": "Free",
    "alphaName": "Alpha",
    "alphaAmount": "$0",
    "alphaPeriod": "/forever during alpha",
    "alphaFeature1": "Unlimited recordings",
    "alphaFeature2": "On-device STT + LLM",
    "alphaFeature3": "Obsidian / Markdown / PDF export",
    "alphaFeature4": "Discord support",
    "alphaCta": "Download for Mac →",
    "proBadge": "Coming soon",
    "proName": "Pro",
    "proAmount": "$?",
    "proPeriod": "/month (post-alpha)",
    "proFeature1": "Everything in Free",
    "proFeature2": "Cloud sync optional",
    "proFeature3": "Team workspace",
    "proFeature4": "Priority support"
  },
  "faq": {
    "eyebrow": "FAQ",
    "headlineBefore": "Questions, ",
    "headlineEm": "answered",
    "headlineAfter": ".",
    "q1": "Why is Lisna macOS-only at launch?",
    "a1": "Our on-device LLM uses Apple's Metal GPU APIs. Windows / Linux support is on the roadmap after we validate the macOS alpha.",
    "q2": "What languages does the transcription support?",
    "a2": "Japanese, English, and Korean at launch. Whisper supports 90+ languages; we expand as the model evolves.",
    "q3": "Will my notes be private?",
    "a3": "Yes. Audio is transcribed locally; notes are saved on your Mac. Lisna's servers never see your audio or note content.",
    "q4": "What happens to my data if I uninstall?",
    "a4": "Your notes stay where they are on disk (Markdown files). The app removal does not delete content. Your account record on Lisna's server can be deleted via Discord support.",
    "q5": "How do I export to Obsidian?",
    "a5": "Set your Obsidian vault path in Settings. New notes save into the vault directly. Existing notes can be moved or symlinked.",
    "q6": "Will Windows / Linux support come?",
    "a6": "Yes, post-macOS-alpha. Timeline depends on alpha feedback and model performance on non-Apple-Silicon hardware."
  },
  "ctaStrip": {
    "eyebrow": "START",
    "headlineBefore": "Ready to ",
    "headlineEm": "focus",
    "headlineAfter": "?",
    "sub": "Free during alpha. Sign in inside the app on first launch."
  }
}
```

- [ ] **Step 2: Add the same keys to ja.json with JP translations**

(Founder translates — provide template structure with placeholders matching English keys. Sample JP keys for the headlines are in the spec §6.4-§6.10; full JP translation deferred to founder review during smoke.)

Use the same JSON shape as en.json, with the strings translated. Example for `features.stt`:

```jsonc
"features": {
  "stt": {
    "eyebrow": "リアルタイム文字起こし",
    "headlineBefore": "",
    "headlineEm": "教授の話す通りに",
    "headlineAfter": "文字起こし。",
    "body": "Whisper はあなたの Mac で動作します。アップロード不要、待ち時間なし。タイムスタンプ付きで秒単位のキャプションがライブ表示されます。",
    "metaA": "→ Whisper",
    "metaB": "→ ライブキャプション",
    "metaC": "→ JA / EN / KO"
  },
  // ... rest follows same pattern
}
```

Founder fills the rest during translation review (Task 39 — visual smoke per locale).

- [ ] **Step 3: Add the same keys to ko.json with KO translations**

Same pattern; KO locale ships partial at launch per spec §10.1. Stub with EN copy fallback if KO not ready.

- [ ] **Step 4: Verify JSON parses**

```bash
cd web && node -e "['en','ja','ko'].forEach(l => JSON.parse(require('fs').readFileSync('src/messages/' + l + '.json', 'utf8')))"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/messages/
git commit -m "feat(web): add home-page i18n keys (features + privacy + pricing + faq + ctaStrip)"
```

---

### Task 35: Compose [locale]/page.tsx (12-section home)

**Files:**
- Replace: `web/src/app/[locale]/page.tsx`

- [ ] **Step 1: Replace home page with full 12-section composition**

```tsx
// web/src/app/[locale]/page.tsx
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Hero } from '@/components/marketing/hero';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { FeatureBlock } from '@/components/marketing/feature-block';
import { Marginalia } from '@/components/marketing/marginalia';
import { PrivacyEmphasis } from '@/components/marketing/privacy-emphasis';
import { PricingCards } from '@/components/marketing/pricing-cards';
import { FAQAccordion } from '@/components/marketing/faq-accordion';
import { CTAStrip } from '@/components/marketing/cta-strip';
import { ScreenshotFrame } from '@/components/ui/screenshot-frame';
import type { Locale } from '@/i18n/routing';

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tF = await getTranslations('features');
  const tP = await getTranslations('privacyEmphasis');
  const tPr = await getTranslations('pricingSection');
  const tFaq = await getTranslations('faq');

  const stockImage = (label: string) => (
    <ScreenshotFrame title={label}>
      <div className="h-64 grid place-items-center text-body-sm text-ink-700/40">[ screenshot placeholder ]</div>
    </ScreenshotFrame>
  );

  return (
    <MarketingShell locale={locale}>
      <Hero />
      <TrustStrip />

      <div id="features">
        <FeatureBlock
          eyebrow={tF('stt.eyebrow')}
          headline={<>{tF('stt.headlineBefore')}<em className="italic text-accent-tan">{tF('stt.headlineEm')}</em>{tF('stt.headlineAfter')}</>}
          body={tF('stt.body')}
          meta={[tF('stt.metaA'), tF('stt.metaB'), tF('stt.metaC')]}
          image={stockImage('Live captions')}
        />

        <FeatureBlock
          variant="primary"
          eyebrow={tF('privacy.eyebrow')}
          headline={<>{tF('privacy.headlineBefore')}<em className="italic text-accent-tan">{tF('privacy.headlineEm')}</em>{tF('privacy.headlineAfter')}</>}
          body={tF('privacy.body')}
          meta={[tF('privacy.metaA'), tF('privacy.metaB'), tF('privacy.metaC')]}
          image={stockImage('Local-only diagram')}
        />
      </div>

      <Marginalia>{tF('marginalia')}</Marginalia>

      <FeatureBlock
        eyebrow={tF('notes.eyebrow')}
        headline={<>{tF('notes.headlineBefore')}<em className="italic text-accent-tan">{tF('notes.headlineEm')}</em>{tF('notes.headlineAfter')}</>}
        body={tF('notes.body')}
        meta={[tF('notes.metaA'), tF('notes.metaB'), tF('notes.metaC')]}
        image={stockImage('Note preview')}
      />

      <FeatureBlock
        variant="reverse"
        eyebrow={tF('export.eyebrow')}
        headline={<>{tF('export.headlineBefore')}<em className="italic text-accent-tan">{tF('export.headlineEm')}</em>{tF('export.headlineAfter')}</>}
        body={tF('export.body')}
        meta={[tF('export.metaA'), tF('export.metaB'), tF('export.metaC')]}
        image={stockImage('Markdown export')}
      />

      <PrivacyEmphasis
        eyebrow={tP('eyebrow')}
        headline={<>{tP('headlineBefore')}<em className="italic text-accent-tan">{tP('headlineEm')}</em>{tP('headlineAfter')}</>}
        statValue={tP('statValue')}
        statSub={tP('statSub')}
        items={[
          { title: tP('item1Title'), body: tP('item1Body') },
          { title: tP('item2Title'), body: tP('item2Body') },
          { title: tP('item3Title'), body: tP('item3Body') },
          { title: tP('item4Title'), body: tP('item4Body') },
          { title: tP('item5Title'), body: tP('item5Body') },
          { title: tP('item6Title'), body: tP('item6Body') },
        ]}
      />

      <PricingCards
        heading={tPr('heading')}
        sub={tPr('sub')}
        plans={[
          {
            name: tPr('alphaName'),
            amount: tPr('alphaAmount'),
            period: tPr('alphaPeriod'),
            badge: { label: tPr('alphaBadge'), tone: 'free' },
            features: [tPr('alphaFeature1'), tPr('alphaFeature2'), tPr('alphaFeature3'), tPr('alphaFeature4')],
            cta: { label: tPr('alphaCta'), href: '/dl/dmg/latest' },
            highlighted: true,
          },
          {
            name: tPr('proName'),
            amount: tPr('proAmount'),
            period: tPr('proPeriod'),
            badge: { label: tPr('proBadge'), tone: 'soon' },
            features: [tPr('proFeature1'), tPr('proFeature2'), tPr('proFeature3'), tPr('proFeature4')],
          },
        ]}
      />

      <FAQAccordion
        eyebrow={tFaq('eyebrow')}
        headline={<>{tFaq('headlineBefore')}<em className="italic text-accent-tan">{tFaq('headlineEm')}</em>{tFaq('headlineAfter')}</>}
        entries={[1, 2, 3, 4, 5, 6].map((n) => ({
          q: tFaq(`q${n}` as 'q1'),
          a: tFaq(`a${n}` as 'a1'),
        }))}
      />

      <CTAStrip />
    </MarketingShell>
  );
}
```

- [ ] **Step 2: Smoke — start dev, visit /en**

```bash
cd web && pnpm dev
```

Open `http://localhost:3000/en`. Verify: hero renders, all 12 sections present, no console errors.

- [ ] **Step 3: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/[locale]/page.tsx'
git commit -m "feat(web): compose 12-section home page (hero/trust/features/privacy/pricing/faq/cta)"
```

---

### Task 36: SEO meta + responsive review

**Files:**
- Modify: `web/src/app/[locale]/layout.tsx` (metadata export)
- Modify: `web/src/app/[locale]/page.tsx` (generateMetadata)

- [ ] **Step 1: Add metadata generation**

```tsx
// web/src/app/[locale]/page.tsx — add at top
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const titles: Record<Locale, string> = {
    en: 'Lisna — Your lectures, in your notes (100% on-device)',
    ja: 'Lisna — 講義を、あなたのノートに（100% オンデバイス）',
    ko: 'Lisna — 강의를 노트로 (100% 온디바이스)',
  };
  const descs: Record<Locale, string> = {
    en: 'Real-time transcription + structured summaries. 100% on-device — your audio never leaves your Mac.',
    ja: 'リアルタイム文字起こし + 構造化されたサマリー。100% オンデバイス — 音声が Mac から出ることはありません。',
    ko: '실시간 전사 + 구조화된 요약. 100% 온디바이스 — 음성이 Mac 을 떠나지 않습니다.',
  };
  return {
    title: titles[locale],
    description: descs[locale],
    openGraph: {
      title: titles[locale],
      description: descs[locale],
      url: `https://lisna.jp/${locale === 'en' ? '' : locale}`,
      siteName: 'Lisna',
      locale: locale === 'en' ? 'en_US' : locale === 'ja' ? 'ja_JP' : 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: titles[locale],
      description: descs[locale],
    },
    alternates: {
      canonical: `https://lisna.jp/${locale === 'en' ? '' : locale}`,
      languages: { en: '/', ja: '/ja', ko: '/ko' },
    },
  };
}
```

- [ ] **Step 2: Mobile responsive smoke**

In dev tools, toggle device emulation (iPhone 15 Pro). Verify hero stacks vertically, font scales (display-1 should render ~38px on narrow viewport — handled by Tailwind responsive class adjustments). If hero text overflows, add mobile breakpoints to relevant components.

For mobile-specific overrides, add `text-[38px] lg:text-display-1` style overrides in `Hero`, `PrivacyEmphasis`, `FeatureBlock` as needed.

- [ ] **Step 3: Run typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add 'web/src/app/[locale]/page.tsx'
git commit -m "feat(web): add per-locale SEO metadata (title/desc/OG/canonical)"
```

---

## Phase G — Functional marketing pages (Tasks 37-43)

Goal: `/download`, `/compare`, `/pricing` update, `/docs` (MDX) + 5 initial pages, `/changelog` + RSS. End of phase: all marketing pages exist; nav links all resolve.

### Task 37: /download page

**Files:**
- Create: `web/src/app/[locale]/download/page.tsx`

- [ ] **Step 1: Implement download page**

```tsx
// web/src/app/[locale]/download/page.tsx
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';

export default async function DownloadPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="red-margin relative mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Lisna for macOS</h1>
        <p className="mt-3 font-sans text-body text-ink-700">v0.1.0 · 537 MB · Apple Silicon</p>
        <p className="mt-1 text-hint text-ink-700/60 font-mono">SHA256: pending GH Release publish</p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/dl/dmg/latest">Download .dmg →</Link>
          </Button>
        </div>

        <div id="system-requirements" className="mt-20 grid lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">System requirements</h2>
            <ul className="mt-4 space-y-2 text-body text-ink-700">
              <li>· macOS 13 Ventura or later</li>
              <li>· Apple Silicon (M1/M2/M3/M4) — Intel Macs not supported in alpha</li>
              <li>· 8 GB RAM minimum (16 GB recommended)</li>
              <li>· 5 GB free disk space for models</li>
            </ul>
          </Card>
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">Install in 3 steps</h2>
            <ol className="mt-4 space-y-2 text-body text-ink-700 list-decimal list-inside">
              <li>Open the .dmg</li>
              <li>Drag Lisna.app to /Applications</li>
              <li>Launch — first-run fetches Whisper + Llama (~3.5 GB, one-time)</li>
            </ol>
          </Card>
        </div>

        <section className="mt-20">
          <h2 className="font-serif text-h2-sm text-ink-900">Model files (advanced)</h2>
          <p className="mt-4 text-body text-ink-700 max-w-[60ch]">
            For offline install or on a metered connection, place the models at the paths below before first launch:
          </p>
          <ul className="mt-4 space-y-3 text-body-sm text-ink-700 font-mono bg-cream-50 p-6 rounded-md border border-ink-900/10">
            <li>· Whisper STT: <strong>ggml-large-v3-q5_0.bin</strong> (1.5 GB) → <code>~/Library/Application Support/@lisna/desktop/models/whisper.bin</code></li>
            <li>· Llama LLM: <strong>Llama-3.2-3B-Instruct-Q4_K_M.gguf</strong> (2.0 GB) → <code>~/Library/Application Support/@lisna/desktop/models/llm.gguf</code></li>
          </ul>
          <p className="mt-4 text-body-sm text-ink-700/70">
            Files attached to the <a href="https://github.com/May1350/Lisna/releases" className="underline">GitHub release</a> tagged <code>models-latest</code>.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">Trouble?</h2>
          <p className="mt-3 text-body text-ink-700">See <Link href={`/${locale === 'en' ? '' : locale + '/'}docs/troubleshooting`} className="underline">troubleshooting</Link>.</p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">Windows / Linux</h2>
          <p className="mt-3 text-body text-ink-700 italic max-w-[52ch]">
            Coming after macOS alpha stabilizes. Drop your email below to get notified.
          </p>
          <form className="mt-4 flex gap-2 max-w-md">
            <input type="email" placeholder="you@example.com" className="h-12 flex-1 rounded-md bg-cream-50 border border-ink-900/20 px-4" />
            <Button type="submit">Notify me</Button>
          </form>
        </section>
      </section>
    </MarketingShell>
  );
}
```

- [ ] **Step 2: Smoke + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add 'web/src/app/[locale]/download/page.tsx'
git commit -m "feat(web): add /download page (DMG button + system reqs + install steps + model file paths)"
```

---

### Task 38: /compare page

**Files:**
- Create: `web/src/app/[locale]/compare/page.tsx`

- [ ] **Step 1: Implement compare page**

```tsx
// web/src/app/[locale]/compare/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import type { Locale } from '@/i18n/routing';

const ROWS: { feature: string; cells: [string, string, string, string] }[] = [
  { feature: 'On-device transcription',     cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Notes stay on device',         cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'No data sent to LLM provider', cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Real-time captions',           cells: ['✓', '✓', '✓', '✗'] },
  { feature: 'Markdown / Obsidian export',   cells: ['✓', '✗', '✗', 'partial'] },
  { feature: 'Works offline',                cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Lecture-aware structuring',    cells: ['✓', 'partial', 'partial', '✗'] },
  { feature: 'Free tier',                    cells: ['✓', '✓', '✓', '✗'] },
  { feature: 'Price',                        cells: ['$0 (alpha) / $? Pro', '$8.33/mo', '$10/mo', '$10/mo'] },
];

export default async function ComparePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Lisna vs cloud-based tools</h1>
        <p className="mt-4 font-sans text-body text-ink-700 max-w-[60ch]">
          What you get when transcription, structuring, and storage all run on your Mac.
        </p>

        <div className="mt-12 overflow-x-auto rounded-md border border-ink-900/10">
          <table className="w-full text-body text-ink-900">
            <thead className="bg-cream-50 border-b border-ink-900/10">
              <tr>
                <th className="text-left py-3 px-4 font-serif">Feature</th>
                <th className="py-3 px-4 font-serif">Lisna</th>
                <th className="py-3 px-4 font-serif text-ink-700">Otter</th>
                <th className="py-3 px-4 font-serif text-ink-700">Fireflies</th>
                <th className="py-3 px-4 font-serif text-ink-700">Notion AI</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={i} className="border-b border-ink-900/5 last:border-b-0">
                  <td className="py-3 px-4">{row.feature}</td>
                  {row.cells.map((cell, j) => (
                    <td key={j} className="py-3 px-4 text-center">
                      {cell === '✓' ? <span className="text-accent-sage">✓</span> :
                       cell === '✗' ? <span className="text-ink-700/40">✗</span> :
                       <span className="text-ink-700">{cell}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-16 prose prose-stone max-w-none text-body text-ink-700 leading-[1.7] font-sans space-y-5">
          <h2 className="font-serif text-h2-sm text-ink-900 mt-0">Why we built Lisna differently</h2>
          <p>Cloud transcription is fast to build but loud about your data. Audio is uploaded to a vendor, transcribed on their GPUs, structured by their LLM, and stored on their servers. For students and researchers handling lectures, drafts, and unpublished ideas, that flow is wrong.</p>
          <p>Lisna inverts it. Whisper runs on your Mac's Neural Engine. Llama 3.2 runs in your Mac's RAM. Notes write to your filesystem in Markdown — sync them with Obsidian or iCloud or no one if you prefer.</p>
          <p>This means Lisna is slower on first launch (model downloads). It means we can't ship feature parity with cloud-only tools on day one. We think the trade is worth it.</p>
        </section>
      </section>
    </MarketingShell>
  );
}
```

- [ ] **Step 2: Smoke + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add 'web/src/app/[locale]/compare/page.tsx'
git commit -m "feat(web): add /compare page (table + on-device rationale; no competitor screenshots)"
```

---

### Task 39: /pricing update

**Files:**
- Replace: `web/src/app/[locale]/pricing/page.tsx`

- [ ] **Step 1: Move + replace existing pricing page**

```bash
git mv web/src/app/pricing/page.tsx web/src/app/'[locale]'/pricing/page.tsx 2>/dev/null || mkdir -p 'web/src/app/[locale]/pricing'
```

If existing page wasn't moved automatically, create the new file:

```tsx
// web/src/app/[locale]/pricing/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { PricingCards } from '@/components/marketing/pricing-cards';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';

export default async function PricingPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Pricing</h1>
        <p className="mt-3 font-sans text-body text-ink-700 max-w-[60ch]">
          Lisna is in alpha and free for early users. The Pro tier turns on after alpha concludes.
        </p>

        {/* v2 plans */}
        <div className="mt-12">
          <PricingCards
            heading="v2 — Mac desktop alpha"
            sub="Pay only when alpha ends — at fair, predictable pricing."
            plans={[
              {
                name: 'Alpha',
                amount: '$0',
                period: '/forever during alpha',
                badge: { label: 'Free', tone: 'free' },
                features: ['Unlimited recordings', 'On-device STT + LLM', 'Markdown / PDF export', 'Discord support'],
                cta: { label: 'Download for Mac →', href: '/dl/dmg/latest' },
                highlighted: true,
              },
              {
                name: 'Pro',
                amount: '$?',
                period: '/month (post-alpha)',
                badge: { label: 'Coming soon', tone: 'soon' },
                features: ['Everything in Free', 'Cloud sync optional', 'Team workspace', 'Priority support'],
              },
            ]}
          />
        </div>

        {/* v1 plans */}
        <section className="mt-24 border-t border-ink-900/10 pt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">v1 — Chrome extension (existing)</h2>
          <p className="mt-3 text-body text-ink-700 max-w-[60ch]">
            The Chrome extension version of Lisna remains available at the existing price. It uses cloud transcription and is being maintained alongside v2.
          </p>
          <div className="mt-8 max-w-md rounded-md border border-ink-900/10 bg-cream-50 p-8">
            <p className="font-serif text-plan text-ink-900">Chrome extension</p>
            <p className="mt-4">
              <span className="font-serif text-display-2 text-ink-900">¥980</span>
              <span className="ml-2 font-sans text-body text-ink-700/70">/月</span>
            </p>
            <ul className="mt-6 space-y-2 text-body text-ink-700">
              <li>· Cloud transcription (Whisper / Groq)</li>
              <li>· YouTube + Drive supported</li>
              <li>· Curator-powered notes</li>
            </ul>
            <div className="mt-8">
              <Link href="https://chromewebstore.google.com/" className="underline text-ink-900">View on Chrome Web Store →</Link>
            </div>
          </div>
        </section>

        <p className="mt-16 text-body text-ink-700/70">
          Comparing plans? See <Link href={`/${locale === 'en' ? '' : locale + '/'}compare`} className="underline">Lisna vs other tools</Link>.
        </p>
      </section>
    </MarketingShell>
  );
}
```

- [ ] **Step 2: If old `/pricing` page existed at `web/src/app/pricing/page.tsx`, delete it**

```bash
rm -f web/src/app/pricing/page.tsx 2>/dev/null
rmdir web/src/app/pricing 2>/dev/null || true
```

- [ ] **Step 3: Smoke + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add 'web/src/app/[locale]/pricing/page.tsx' web/src/app/pricing
git commit -m "feat(web): replace /pricing — v2 alpha + Pro placeholder + retain v1 ¥980 section"
```

---

### Task 40: MDX support setup + /docs scaffolding

**Files:**
- Modify: `web/package.json`
- Modify: `web/next.config.ts`
- Create: `web/src/app/[locale]/docs/layout.tsx`
- Create: `web/src/app/[locale]/docs/[...slug]/page.tsx`
- Create: `web/src/lib/mdx.ts`

- [ ] **Step 1: Install MDX deps**

```bash
cd web && pnpm add @next/mdx @mdx-js/loader @mdx-js/react remark-gfm rehype-slug
pnpm add -D @types/mdx
```

- [ ] **Step 2: Wire MDX in next.config.ts**

```ts
// web/next.config.ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n.ts');
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  },
});

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  async headers() {
    return [
      {
        source: '/((?!success|cancel|trial-success|trial-cancel).*)',
        headers: [{ key: 'x-robots-tag', value: 'index, follow' }],
      },
    ];
  },
};

export default withMDX(withNextIntl(config));
```

- [ ] **Step 3: Create mdx loader util**

```ts
// web/src/lib/mdx.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_DIR = path.join(process.cwd(), 'src/content/docs');

export async function loadDocBySlug(slug: string[]): Promise<{ source: string } | null> {
  const filePath = path.join(DOCS_DIR, slug.join('/') + '.mdx');
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    return { source };
  } catch {
    return null;
  }
}

export async function listDocs(): Promise<string[]> {
  const files = await fs.readdir(DOCS_DIR);
  return files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, ''));
}
```

- [ ] **Step 4: Create docs layout**

```tsx
// web/src/app/[locale]/docs/layout.tsx
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { listDocs } from '@/lib/mdx';
import type { Locale } from '@/i18n/routing';

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const slugs = await listDocs();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <MarketingShell locale={locale}>
      <div className="mx-auto max-w-6xl px-6 lg:px-12 py-12 grid lg:grid-cols-[220px_1fr] gap-12">
        <aside className="lg:sticky lg:top-20 self-start">
          <p className="text-meta uppercase text-ink-700/60 mb-3">Docs</p>
          <ul className="space-y-2 text-body text-ink-900">
            {slugs.map((s) => (
              <li key={s}>
                <Link href={`${prefix}/docs/${s}`} className="hover:text-margin-red">
                  {s.replace(/-/g, ' ')}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <article className="prose prose-stone max-w-[720px] font-sans text-body text-ink-700 leading-[1.7]">
          {children}
        </article>
      </div>
    </MarketingShell>
  );
}
```

- [ ] **Step 5: Create docs catch-all route**

```tsx
// web/src/app/[locale]/docs/[...slug]/page.tsx
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { setRequestLocale } from 'next-intl/server';
import { loadDocBySlug, listDocs } from '@/lib/mdx';
import type { Locale } from '@/i18n/routing';

export async function generateStaticParams() {
  const slugs = await listDocs();
  return slugs.map((s) => ({ slug: [s] }));
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string[] }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const doc = await loadDocBySlug(slug);
  if (!doc) notFound();
  return <MDXRemote source={doc.source} />;
}
```

- [ ] **Step 6: Install next-mdx-remote**

```bash
cd web && pnpm add next-mdx-remote
```

- [ ] **Step 7: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/package.json web/pnpm-lock.yaml web/next.config.ts web/src/lib/mdx.ts 'web/src/app/[locale]/docs/'
git commit -m "feat(web): add MDX support + /docs scaffolding (sidebar + catch-all route)"
```

---

### Task 41: Initial /docs MDX content (5 files)

**Files:**
- Create: `web/src/content/docs/getting-started.mdx`
- Create: `web/src/content/docs/first-recording.mdx`
- Create: `web/src/content/docs/exporting-to-obsidian.mdx`
- Create: `web/src/content/docs/faq.mdx`
- Create: `web/src/content/docs/troubleshooting.mdx`

- [ ] **Step 1: Create getting-started.mdx**

```mdx
---
title: Getting started
description: Install Lisna and record your first lecture in 5 minutes.
---

# Getting started

Lisna runs entirely on your Mac. No upload, no cloud account, no waiting for transcription to finish.

## 1. Download

[Download .dmg](/dl/dmg/latest) — 537 MB · macOS 13+ · Apple Silicon.

## 2. Install

1. Open the downloaded `.dmg`
2. Drag **Lisna.app** to `/Applications`
3. Launch Lisna for the first time

## 3. First-run setup

Lisna will offer to download two model files (~3.5 GB total):

- **Whisper STT** — speech-to-text model (1.5 GB)
- **Llama 3.2 LLM** — note-summarization model (2.0 GB)

You can pick existing model files from disk if you already have them. See [Model files (advanced)](/download#model-files-advanced).

## 4. Sign in

After setup completes, click **Sign in to start**. Your default browser opens to lisna.jp/signin. Choose magic link or OAuth. The browser then hands authorization back to the app via `lisna://callback`.

## 5. Start recording

Press **Record**. Lisna captures the system audio + microphone, transcribes in real-time, and structures a note when you stop.

[First recording walkthrough →](/docs/first-recording)
```

- [ ] **Step 2: Create first-recording.mdx**

```mdx
---
title: First recording
description: UI tour of the recording → note flow.
---

# First recording

When you click **Record**, Lisna captures:

- **System audio** — the lecturer's voice from Zoom, Meet, YouTube, etc.
- **Microphone** — optional, for in-person lectures

Captions appear as you record. When you press **Stop**, Lisna passes the transcript to the local Llama model and generates a structured note.

## What the note contains

- **Title** — from the recording's metadata or your edits
- **Sections** — Llama identifies the lecture's structure (e.g., "§ Compactness")
- **Key terms** — important vocabulary with brief definitions
- **Bullets** — claims, examples, references

You can edit the note inline. Export to Markdown / Obsidian / PDF via the `Export` button.

## Tips

- For best transcription quality, use a quiet room and a single speaker per channel.
- Lisna does not record system audio of audio that isn't permitted by your Mac's privacy settings — grant **Screen & System Audio Recording** when prompted.
```

- [ ] **Step 3: Create exporting-to-obsidian.mdx**

```mdx
---
title: Exporting to Obsidian
description: Set your vault path and notes sync directly.
---

# Exporting to Obsidian

Lisna writes notes as Markdown. Point Lisna at your Obsidian vault and new notes appear in your vault as you create them.

## 1. Find your vault path

In Obsidian, **Settings → About → Show vault folder**. Copy the path (e.g., `~/Documents/Vault`).

## 2. Set Lisna's export path

Lisna → **Settings → Export → Vault path** → paste the path.

## 3. New notes auto-save

From the next recording onwards, Lisna saves notes into the vault directly.

## Existing notes

For notes created before you set the path, click **Export → Obsidian** on each note.

## Subfolder strategy

You can configure a subfolder template (e.g., `lectures/{course}/{date}-{title}.md`) in **Settings → Export → Path template**.
```

- [ ] **Step 4: Create faq.mdx (mirror home FAQ, expanded)**

```mdx
---
title: FAQ
description: Frequently asked questions about Lisna.
---

# FAQ

## Why is Lisna macOS-only at launch?

Our on-device LLM uses Apple's Metal GPU APIs and the Neural Engine for Whisper. Windows / Linux support is on the roadmap, contingent on alpha feedback and model performance benchmarks on non-Apple-Silicon hardware.

## What languages does the transcription support?

Japanese, English, and Korean at launch. Whisper supports 90+ languages; we expand the UI language coverage as the model evolves.

## Will my notes be private?

Yes. Audio is transcribed locally on your Mac. Notes are saved as Markdown to your filesystem. Lisna's servers never see your audio, transcripts, or note content. Our backend only stores your email + signin metadata for account purposes.

## What happens to my data if I uninstall?

Your notes stay where they are on disk (Markdown files). Uninstalling Lisna.app does not delete content. Your account record on Lisna's server can be deleted via Discord support — email is the only personal data we store.

## How do I export to Obsidian?

Set your Obsidian vault path in **Settings → Export**. New notes save into the vault directly. See [Exporting to Obsidian](/docs/exporting-to-obsidian).

## Will Windows / Linux support come?

Yes, post-macOS alpha. Timeline depends on alpha feedback and model performance on non-Apple-Silicon hardware. Subscribe via [/download](/download) to get notified.
```

- [ ] **Step 5: Create troubleshooting.mdx (covers Gatekeeper unsigned-app workaround)**

```mdx
---
title: Troubleshooting
description: Common issues during alpha.
---

# Troubleshooting

## "Lisna.app can't be opened because Apple cannot check it for malicious software"

During alpha, the app is not yet Apple-notarized. The fastest workaround:

1. Right-click on **Lisna.app** in `/Applications`
2. Choose **Open**
3. Click **Open** in the dialog that appears

You only need to do this once. macOS remembers the choice.

We're applying for an Apple Developer ID and will codesign + notarize the v2 build before public beta. Track the status in [/changelog](/changelog).

## "Lisna needs Screen Recording permission"

macOS requires explicit permission to capture system audio:

1. **System Settings → Privacy & Security → Screen & System Audio Recording**
2. Enable **Lisna**
3. Quit and re-open Lisna

## First-run model download stalls

Check internet connection. If a partial download is corrupted:

1. Quit Lisna
2. Delete `~/Library/Application Support/@lisna/desktop/models/`
3. Re-launch Lisna; downloads will retry from scratch

For metered or offline installs, see [Model files (advanced)](/download#model-files-advanced).

## "Sidecar failed to start"

Lisna spawns a native sidecar process for Whisper + Llama. If it fails:

1. Check Console.app for entries from `lisna_sidecar`
2. Common cause: macOS Gatekeeper blocking the unsigned sidecar. Solution: Apply the Right-click → Open trick to the sidecar binary at `Lisna.app/Contents/Resources/sidecar`.

If you still see the error, post the Console.app log in [Discord](https://discord.gg/69NkqBTbS) for help.

## Other issues

Join [Discord](https://discord.gg/69NkqBTbS) — fastest response.
```

- [ ] **Step 6: Smoke + commit**

```bash
cd web && pnpm dev
# Visit /en/docs/getting-started, /en/docs/faq, etc. — verify rendering.
cd web && pnpm exec tsc --noEmit
git add web/src/content/docs/
git commit -m "docs(web): add initial /docs MDX content (5 pages)"
```

---

### Task 42: /changelog page + RSS feed

**Files:**
- Create: `web/src/content/changelog/2026-05-18-v0.1.0.mdx`
- Create: `web/src/app/[locale]/changelog/page.tsx`
- Create: `web/src/app/changelog/rss.xml/route.ts`
- Create: `web/src/lib/changelog.ts`

- [ ] **Step 1: Create first changelog entry**

```mdx
---
date: 2026-05-18
version: 0.1.0
category: feature
title: v0.1.0 — Mac desktop alpha
---

The first public alpha of Lisna's macOS desktop app. Everything runs on your Mac.

- On-device STT (Whisper)
- On-device LLM (Llama 3.2 3B Instruct)
- Real-time captions
- Markdown / Obsidian export
- macOS 13+, Apple Silicon

[Download](/download) · [Getting started](/docs/getting-started)
```

- [ ] **Step 2: Create changelog loader**

```ts
// web/src/lib/changelog.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'src/content/changelog');

export interface ChangelogEntry {
  slug: string;
  date: string;
  version: string;
  category: 'feature' | 'fix' | 'breaking';
  title: string;
  source: string;
}

function parseFrontmatter(source: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) return {};
  return match[1].split('\n').reduce((acc, line) => {
    const m = /^(\w+):\s*(.+)$/.exec(line.trim());
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {} as Record<string, string>);
}

export async function listChangelog(): Promise<ChangelogEntry[]> {
  const files = await fs.readdir(DIR);
  const entries = await Promise.all(
    files.filter((f) => f.endsWith('.mdx')).map(async (f) => {
      const source = await fs.readFile(path.join(DIR, f), 'utf-8');
      const fm = parseFrontmatter(source);
      return {
        slug: f.replace(/\.mdx$/, ''),
        date: fm.date,
        version: fm.version,
        category: fm.category as ChangelogEntry['category'],
        title: fm.title,
        source,
      };
    })
  );
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
```

- [ ] **Step 3: Create changelog page**

```tsx
// web/src/app/[locale]/changelog/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { listChangelog } from '@/lib/changelog';
import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/routing';

const CAT_COLOR: Record<string, string> = {
  feature: 'text-accent-sage',
  fix: 'text-accent-tan',
  breaking: 'text-margin-red',
};

export default async function ChangelogPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const entries = await listChangelog();
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Changelog</h1>
        <p className="mt-3 text-body text-ink-700">Release notes for Lisna desktop. <a href="/changelog/rss.xml" className="underline">RSS</a>.</p>
        <ol className="mt-12 space-y-12">
          {entries.map((e) => (
            <li key={e.slug}>
              <header className="flex items-center gap-3 text-body-sm">
                <time className="font-mono text-ink-700/70">{e.date}</time>
                <span className="rounded-sm bg-cream-300 px-2 py-0.5 font-mono">v{e.version}</span>
                <span className={cn('uppercase text-meta', CAT_COLOR[e.category])}>{e.category}</span>
              </header>
              <h2 className="mt-3 font-serif text-h2-sm text-ink-900">{e.title}</h2>
              <div className="mt-4 prose prose-stone max-w-none text-body text-ink-700">
                <MDXRemote source={e.source.replace(/^---\n[\s\S]*?\n---/, '')} />
              </div>
            </li>
          ))}
        </ol>
      </section>
    </MarketingShell>
  );
}
```

- [ ] **Step 4: Create RSS route**

```ts
// web/src/app/changelog/rss.xml/route.ts
import { listChangelog } from '@/lib/changelog';

export async function GET() {
  const entries = await listChangelog();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Lisna Changelog</title>
    <link>https://lisna.jp/changelog</link>
    <description>Release notes for Lisna desktop</description>
${entries.map((e) => `    <item>
      <title>v${e.version} — ${e.title}</title>
      <link>https://lisna.jp/changelog#${e.slug}</link>
      <pubDate>${new Date(e.date).toUTCString()}</pubDate>
      <description><![CDATA[${e.title}]]></description>
    </item>`).join('\n')}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
```

- [ ] **Step 5: Smoke + commit**

```bash
cd web && pnpm dev
# Visit /en/changelog and /changelog/rss.xml — verify entries appear.
cd web && pnpm exec tsc --noEmit
git add web/src/content/changelog 'web/src/app/[locale]/changelog' web/src/app/changelog web/src/lib/changelog.ts
git commit -m "feat(web): add /changelog page + RSS feed (MDX-backed entries)"
```

---

### Task 43: /dl/dmg/latest redirect to GH Release

**Files:**
- Create: `web/src/app/dl/dmg/latest/route.ts`

- [ ] **Step 1: Implement redirect handler**

```ts
// web/src/app/dl/dmg/latest/route.ts
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';

export async function GET() {
  // Resolve latest GH release DMG URL via the GitHub API.
  // For alpha, hardcoded redirect is acceptable; switch to API resolution once auto-release is wired.
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      // Cache the lookup for 5 minutes to avoid burning the unauth'd GH API rate limit
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`GH API ${res.status}`);
    const data = await res.json();
    const dmg = data.assets?.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.dmg'));
    if (!dmg) throw new Error('no DMG asset on latest release');
    redirect(dmg.browser_download_url);
  } catch {
    // Fallback to releases page if API fails or no release yet
    redirect(`https://github.com/${owner}/${repo}/releases/latest`);
  }
}
```

- [ ] **Step 2: Smoke + commit**

```bash
cd web && pnpm dev
# Visit /dl/dmg/latest — expect a 307 to a GH release URL (or to the releases page if no DMG yet)
cd web && pnpm exec tsc --noEmit
git add web/src/app/dl/
git commit -m "feat(web): add /dl/dmg/latest redirect to GH Release DMG asset"
```

---

## Phase H — Legal pages (Task 44)

Goal: migrate existing `/terms`, `/privacy`, `/tokusho`, `/refunds` into `[locale]` tree, append v2-specific clauses.

### Task 44: Legal page migration + v2 clauses

**Files:**
- Move: `web/src/app/{terms,privacy,tokusho,refunds}/page.tsx` → `web/src/app/[locale]/{terms,privacy,tokusho,refunds}/page.tsx`
- Modify: each migrated file with v2 sections

- [ ] **Step 1: Read existing legal pages**

```bash
cat web/src/app/terms/page.tsx
cat web/src/app/privacy/page.tsx
cat web/src/app/tokusho/page.tsx
cat web/src/app/refunds/page.tsx
```

Capture existing content; v1 sections must be preserved verbatim per spec §7.9.

- [ ] **Step 2: Move each page into [locale]**

```bash
mkdir -p 'web/src/app/[locale]/terms' 'web/src/app/[locale]/privacy' 'web/src/app/[locale]/tokusho' 'web/src/app/[locale]/refunds'
git mv web/src/app/terms/page.tsx 'web/src/app/[locale]/terms/page.tsx'
git mv web/src/app/privacy/page.tsx 'web/src/app/[locale]/privacy/page.tsx'
git mv web/src/app/tokusho/page.tsx 'web/src/app/[locale]/tokusho/page.tsx'
git mv web/src/app/refunds/page.tsx 'web/src/app/[locale]/refunds/page.tsx'
rmdir web/src/app/terms web/src/app/privacy web/src/app/tokusho web/src/app/refunds
```

- [ ] **Step 3: Wrap each in MarketingShell + apply Notebook typography**

For each file, the migration pattern is:

```tsx
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import type { Locale } from '@/i18n/routing';

export default async function TermsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <article className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
        <h1 className="font-serif text-h1 text-ink-900">Terms of Service</h1>
        <p className="text-body-sm text-ink-700/70 mt-2">Last updated: 2026-05-19</p>
        {/* existing v1 sections — preserve verbatim */}

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">On-device processing (v2)</h2>
        <p>Lisna's desktop application processes audio and generates transcripts and notes entirely on the user's device. No audio or transcript content is transmitted to Lisna's servers or to any third-party data processor as part of normal operation.</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">Account scope (v2)</h2>
        <p>Lisna's backend stores: email address, signin metadata (provider, timestamps), device identifiers, and account preferences. Lisna's backend does <em>not</em> store: audio recordings, transcripts, generated notes, or any content derived from user recordings.</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">Open-source models (v2)</h2>
        <p>Lisna ships Whisper (MIT license) and Llama 3.2 (Meta Llama 3.2 Community License Agreement) on first launch. By using the app, you accept those license terms. The model files run unmodified.</p>
      </article>
    </MarketingShell>
  );
}
```

Apply equivalent v2 additions to:
- `/privacy` — add **Audio processing** + **Web analytics (Plausible cookieless)** + **Account data** sections
- `/tokusho` — add 動作環境 (macOS 13+, Apple Silicon, 8GB RAM, 5GB) + v2 価格 (アルファ無料 / 後日決定) + 引渡時期 (即時)
- `/refunds` — add v2 reference noting alpha is free → no refunds applicable

For full text of the v2 additions, see spec §7.9 and §11.1.

- [ ] **Step 4: Typecheck + smoke**

```bash
cd web && pnpm exec tsc --noEmit
cd web && pnpm dev
# Visit /en/terms, /en/privacy, /en/tokusho, /en/refunds — verify v1 content preserved + v2 sections appear.
```

- [ ] **Step 5: Commit**

```bash
git add 'web/src/app/[locale]/terms' 'web/src/app/[locale]/privacy' 'web/src/app/[locale]/tokusho' 'web/src/app/[locale]/refunds' web/src/app/terms web/src/app/privacy web/src/app/tokusho web/src/app/refunds
git commit -m "feat(web): migrate legal pages to [locale] + append v2 on-device clauses"
```

---

## Phase I — DB schema + Drizzle (Tasks 45-49)

Goal: install Drizzle ORM, wire RDS Proxy + IAM connection, define 5 tables + email_verified column on existing users, generate + run first migration. End of phase: `pnpm drizzle:push` produces an idempotent migration; smoke connect works against a local Postgres.

### Task 45: Install Drizzle + pg + AWS SDK

**Files:**
- Modify: `web/package.json`
- Create: `web/drizzle.config.ts`

- [ ] **Step 1: Install deps**

```bash
cd web && pnpm add drizzle-orm pg @aws-sdk/rds-signer
pnpm add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Create drizzle.config.ts**

```ts
// web/drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 3: Add scripts to package.json**

```jsonc
// web/package.json — add to "scripts":
"drizzle:generate": "drizzle-kit generate",
"drizzle:push": "drizzle-kit push",
"drizzle:studio": "drizzle-kit studio"
```

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/drizzle.config.ts
git commit -m "feat(web): install Drizzle + pg + AWS SDK; drizzle.config.ts"
```

---

### Task 46: Define schema.ts (5 tables + email_verified on users)

**Files:**
- Create: `web/src/db/schema.ts`

- [ ] **Step 1: Implement schema.ts**

```ts
// web/src/db/schema.ts
import { pgTable, uuid, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Existing v1 users table — we add `email_verified` via the migration.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionToken: text('session_token').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull().unique(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.identifier, t.token] }),
}));

export const appExchangeCodes = pgTable('app_exchange_codes', {
  code: text('code').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const appDevices = pgTable('app_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  deviceToken: text('device_token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  devices: many(appDevices),
}));
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/db/schema.ts
git commit -m "feat(web): add Drizzle schema (users + accounts + sessions + verif + exchange + devices)"
```

---

### Task 47: Create db.ts (RDS Proxy + IAM auth)

**Files:**
- Create: `web/src/lib/db.ts`
- Test: `web/src/lib/db.test.ts`

- [ ] **Step 1: Write a smoke test that verifies the module shape**

```ts
// web/src/lib/db.test.ts
import { describe, expect, it } from 'vitest';

describe('db module', () => {
  it('exports db and getIamToken', async () => {
    const mod = await import('./db');
    expect(typeof mod.db).toBe('object');
    expect(typeof mod.getIamToken).toBe('function');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd web && pnpm test src/lib/db.test.ts
```

- [ ] **Step 3: Implement db.ts**

```ts
// web/src/lib/db.ts
import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Signer } from '@aws-sdk/rds-signer';
import { env } from './env';
import * as schema from '@/db/schema';

export async function getIamToken(): Promise<string> {
  if (!env.RDS_PROXY_ENDPOINT || !env.RDS_USERNAME) {
    throw new Error('RDS Proxy not configured — fall back to DATABASE_URL');
  }
  const signer = new Signer({
    hostname: env.RDS_PROXY_ENDPOINT,
    port: 5432,
    username: env.RDS_USERNAME,
    region: env.AWS_REGION,
  });
  return signer.getAuthToken();
}

function makePool(): Pool {
  if (env.DATABASE_URL) {
    return new Pool({ connectionString: env.DATABASE_URL });
  }
  if (env.RDS_PROXY_ENDPOINT && env.RDS_USERNAME) {
    const cfg: PoolConfig & { password: () => Promise<string> } = {
      host: env.RDS_PROXY_ENDPOINT,
      port: 5432,
      user: env.RDS_USERNAME,
      database: 'lisna',
      ssl: { rejectUnauthorized: true },
      max: 1,
      password: async () => getIamToken(),
    };
    return new Pool(cfg);
  }
  throw new Error('Neither DATABASE_URL nor RDS_PROXY_ENDPOINT+RDS_USERNAME configured');
}

const pool = makePool();
export const db = drizzle(pool, { schema });
```

- [ ] **Step 4: Run tests — expect 1/1 pass**

```bash
cd web && pnpm test src/lib/db.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db.ts web/src/lib/db.test.ts
git commit -m "feat(web): add Drizzle client with RDS Proxy IAM auth + DATABASE_URL fallback"
```

---

### Task 48: Generate + smoke first migration against local Postgres

**Files:**
- Create: `web/src/db/migrations/0000_*.sql` (output of drizzle-kit generate)

- [ ] **Step 1: Spin up a temporary local Postgres for migration generation**

```bash
docker run --name lisna-pg-tmp -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
sleep 2
PGPASSWORD=dev psql -h localhost -U postgres -c "CREATE DATABASE lisna;"
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/lisna"
```

- [ ] **Step 2: Generate migration**

```bash
cd web && pnpm drizzle:generate
```

Expected: a new SQL file in `web/src/db/migrations/`. Inspect the diff manually — confirm `email_verified` is added to `users`, and 5 new tables exist.

- [ ] **Step 3: Push to local DB to smoke**

```bash
cd web && pnpm drizzle:push
```

Expected: success, no errors.

- [ ] **Step 4: Tear down**

```bash
docker rm -f lisna-pg-tmp
unset DATABASE_URL
```

- [ ] **Step 5: Commit the generated migration**

```bash
git add web/src/db/migrations/
git commit -m "feat(web): generate first Drizzle migration (5 tables + email_verified on users)"
```

---

### Task 49: Document prod-DB migration runbook

**Files:**
- Create: `web/src/db/MIGRATIONS.md`

- [ ] **Step 1: Write migration runbook**

Create `web/src/db/MIGRATIONS.md` with the following sections:

````md
# Migrations runbook

## Local dev

```bash
docker run --name lisna-pg-dev -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/lisna"
createdb lisna || true
pnpm drizzle:push
```

## Production (RDS via SSM port-forward)

1. Confirm migration file is reviewed (`web/src/db/migrations/0000_*.sql`).
2. SSM port-forward to RDS (direct, not the Proxy):
   ```bash
   aws ssm start-session --target i-<bastion-id> --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["6432"]}'
   ```
3. Fetch admin password from Secrets Manager:
   ```bash
   aws secretsmanager get-secret-value --secret-id lisna/prod/rds/master --query SecretString --output text | jq -r .password
   ```
4. Apply the migration:
   ```bash
   PGPASSWORD=<above> psql -h localhost -p 6432 -U lisna_admin -d lisna -f web/src/db/migrations/0000_<name>.sql
   ```
5. Verify all tables:
   ```sql
   \dt
   ```

## Rollback

Drizzle does not auto-generate down migrations. Write reverse SQL by hand:

```sql
DROP TABLE app_devices, app_exchange_codes, verification_tokens, sessions, accounts;
ALTER TABLE users DROP COLUMN email_verified;
```

## Notes

- The RDS Proxy IAM user (`lisna_web`) does **not** have CREATE TABLE privilege. Use admin role for schema migrations; the web app's runtime role is data-only.
- Never apply migrations via Drizzle Kit in production — always review SQL first.
````

- [ ] **Step 2: Commit**

```bash
git add web/src/db/MIGRATIONS.md
git commit -m "docs(web): add DB migration runbook (local dev + RDS via SSM)"
```

---

## Phase J — Auth.js v5 + magic link + OAuth (Tasks 50-56)

Goal: Auth.js v5 with Drizzle adapter, Resend magic-link email, Google/Apple/GitHub OAuth, `/signin` page, `/auth/success` page. End of phase: full sign-in flow works in development (curl-able + browser-clickable).

### Task 50: Install Auth.js v5 + Resend + React Email

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install deps**

```bash
cd web && pnpm add next-auth@beta @auth/drizzle-adapter resend
pnpm add -D @types/react
```

(`next-auth@beta` is v5 line at time of writing — verify the latest stable v5 GA version when implementing.)

- [ ] **Step 2: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): install Auth.js v5 + Drizzle adapter + Resend"
```

---

### Task 51: Create auth.ts (Auth.js config)

**Files:**
- Create: `web/src/lib/auth.ts`
- Test: `web/src/lib/auth.test.ts`

- [ ] **Step 1: Write smoke test verifying export shape**

```ts
// web/src/lib/auth.test.ts
import { describe, expect, it } from 'vitest';

describe('auth module', () => {
  it('exports handlers, signIn, signOut, auth', async () => {
    const mod = await import('./auth');
    expect(mod.handlers).toBeDefined();
    expect(typeof mod.signIn).toBe('function');
    expect(typeof mod.signOut).toBe('function');
    expect(typeof mod.auth).toBe('function');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd web && pnpm test src/lib/auth.test.ts
```

- [ ] **Step 3: Implement auth.ts**

```ts
// web/src/lib/auth.ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Apple from 'next-auth/providers/apple';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { Resend } from 'resend';
import { db } from './db';
import { env } from './env';
import { users, accounts, sessions, verificationTokens } from '@/db/schema';

const resend = new Resend(env.RESEND_API_KEY);

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  secret: env.NEXTAUTH_SECRET,
  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })]
      : []),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? [GitHub({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET })]
      : []),
    ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? [Apple({ clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET })]
      : []),
    {
      id: 'resend',
      name: 'Email',
      type: 'email',
      maxAge: 60 * 10, // 10 minutes
      from: env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        const { error } = await resend.emails.send({
          from: provider.from!,
          to: email,
          subject: 'Sign in to Lisna',
          html: magicLinkHtml(url),
          text: `Sign in to Lisna: ${url}`,
        });
        if (error) throw new Error(`Resend send failed: ${error.message}`);
      },
    },
  ],
  pages: {
    signIn: '/signin',
    verifyRequest: '/signin?check-email=1',
    error: '/signin?error=1',
  },
});

function magicLinkHtml(url: string): string {
  return `
<!doctype html>
<html><body style="font-family: -apple-system, sans-serif; background:#f8f3e9; padding:40px;">
  <div style="max-width:520px; margin:0 auto; background:#fefbf5; border:1px solid rgba(26,20,16,0.1); border-radius:8px; padding:32px;">
    <h1 style="font-family: Georgia, serif; font-weight:400; color:#1a1410; font-size:24px; margin:0 0 16px;">Sign in to Lisna</h1>
    <p style="color:#3a3025; line-height:1.6;">Click the button below to sign in. This link expires in 10 minutes.</p>
    <a href="${url}" style="display:inline-block; background:#1a1410; color:#f8f3e9; padding:14px 24px; border-radius:6px; text-decoration:none; margin:24px 0;">Sign in</a>
    <p style="color:#3a3025; font-size:13px; line-height:1.5;">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>
`;
}
```

- [ ] **Step 4: Run tests — expect 1/1 pass**

```bash
cd web && pnpm test src/lib/auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/auth.ts web/src/lib/auth.test.ts
git commit -m "feat(web): add Auth.js v5 config (Drizzle adapter + Resend + Google/Apple/GitHub OAuth)"
```

---

### Task 52: Create [...nextauth] route handler

**Files:**
- Create: `web/src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Implement route**

```ts
// web/src/app/api/auth/[...nextauth]/route.ts
export { GET, POST } from '@/lib/auth';

// Re-export pattern: handlers from auth.ts already destructures { handlers: { GET, POST } }.
// If the shape is { handlers } rather than { GET, POST }, use:
// import { handlers } from '@/lib/auth';
// export const { GET, POST } = handlers;
```

If the import-from-lib shape needs the alternate pattern, adjust:

```ts
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add 'web/src/app/api/auth/[...nextauth]'
git commit -m "feat(web): mount Auth.js handlers at /api/auth/[...nextauth]"
```

---

### Task 53: Wire getAuthState helper to Auth.js session

**Files:**
- Modify: `web/src/lib/auth-state.ts` (created in Task 23 as a placeholder)

- [ ] **Step 1: Replace placeholder with real Auth.js session reader**

```ts
// web/src/lib/auth-state.ts
import { auth } from './auth';

export async function getAuthState(): Promise<'guest' | { name: string; email: string; image?: string | null }> {
  const session = await auth();
  if (!session?.user) return 'guest';
  return {
    name: session.user.name ?? session.user.email ?? 'You',
    email: session.user.email ?? '',
    image: session.user.image ?? null,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth-state.ts
git commit -m "feat(web): wire getAuthState to Auth.js v5 session"
```

---

### Task 54: /signin page

**Files:**
- Create: `web/src/app/[locale]/signin/page.tsx`

- [ ] **Step 1: Implement signin page**

```tsx
// web/src/app/[locale]/signin/page.tsx
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { EmailMagicLinkForm } from '@/components/ui/email-magic-link-form';
import type { Locale } from '@/i18n/routing';
import { signIn } from '@/lib/auth';

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ source?: string; next?: string; app_callback?: string; ['check-email']?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const checkEmail = sp['check-email'] === '1';

  async function sendMagicLink(email: string) {
    'use server';
    const callbackUrl = sp.source === 'app'
      ? `/api/auth/exchange-code/issue?app_callback=${encodeURIComponent(sp.app_callback ?? 'lisna://callback')}`
      : (sp.next ?? '/dashboard');
    await signIn('resend', { email, redirectTo: callbackUrl });
  }

  async function oauth(provider: 'google' | 'apple' | 'github') {
    'use server';
    const callbackUrl = sp.source === 'app'
      ? `/api/auth/exchange-code/issue?app_callback=${encodeURIComponent(sp.app_callback ?? 'lisna://callback')}`
      : (sp.next ?? '/dashboard');
    await signIn(provider, { redirectTo: callbackUrl });
  }

  if (checkEmail) {
    return (
      <AuthShell locale={locale}>
        <div className="max-w-[440px] w-full text-center">
          <h1 className="font-serif text-h2-sm text-ink-900">Check your email.</h1>
          <p className="mt-3 text-body text-ink-700">We sent a magic link to your inbox. It expires in 10 minutes.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell locale={locale}>
      <div className="max-w-[440px] w-full">
        <h1 className="font-serif text-h2-sm text-ink-900 text-center">
          Continue to <em className="italic text-accent-tan">Lisna</em>.
        </h1>
        <p className="mt-3 text-body text-ink-700 text-center">
          Sign in or sign up — same flow either way. Either method below works.
        </p>

        <div className="mt-8">
          <EmailMagicLinkForm onSubmit={sendMagicLink} hint="We'll email you a magic link." />
        </div>

        <div className="my-8 flex items-center gap-3">
          <span className="flex-1 h-px bg-ink-900/10" />
          <span className="text-meta uppercase text-accent-tan">or</span>
          <span className="flex-1 h-px bg-ink-900/10" />
        </div>

        <form className="space-y-3">
          <Button formAction={oauth.bind(null, 'google')} variant="ghost" className="w-full justify-center">Continue with Google</Button>
          <Button formAction={oauth.bind(null, 'apple')} variant="ghost" className="w-full justify-center">Continue with Apple</Button>
          <Button formAction={oauth.bind(null, 'github')} variant="ghost" className="w-full justify-center">Continue with GitHub</Button>
        </form>

        <p className="mt-8 text-hint text-ink-700/60 text-center">
          By continuing, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy</Link> policy.
        </p>
        <p className="mt-3 text-hint text-ink-700/60 text-center">
          Need help? Join our <a href="https://discord.gg/69NkqBTbS" className="underline" target="_blank" rel="noreferrer">Discord</a>.
        </p>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Smoke**

Start a local Postgres + set `.env.local` with `NEXTAUTH_SECRET=$(openssl rand -base64 32)` + `RESEND_API_KEY=re_test...` + `DATABASE_URL=postgresql://...`. Run `pnpm dev`. Visit `/en/signin`. Enter an email. Expect the post-submit "Check your email" branch to render.

(OAuth providers only work with actual `*_CLIENT_ID/*_CLIENT_SECRET` set — verify smoke against magic link only at this stage.)

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/[locale]/signin'
git commit -m "feat(web): add /signin page (magic link + Google/Apple/GitHub OAuth) with source=app branch"
```

---

### Task 55: /auth/success page

**Files:**
- Create: `web/src/app/[locale]/auth/success/page.tsx`

- [ ] **Step 1: Implement auth success page**

```tsx
// web/src/app/[locale]/auth/success/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/layout/auth-shell';
import type { Locale } from '@/i18n/routing';
import { AutoCloseTab } from './_auto-close';

export default async function AuthSuccessPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AuthShell locale={locale}>
      <div className="max-w-[420px] w-full text-center">
        <p className="font-serif text-[64px] text-accent-tan">✓</p>
        <h1 className="mt-2 font-serif text-h2-sm text-ink-900">Signed in.</h1>
        <p className="mt-3 text-body text-ink-700">Lisna is ready to use on your Mac. You can close this tab.</p>
        <AutoCloseTab />
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Create the client component for auto-close**

```tsx
// web/src/app/[locale]/auth/success/_auto-close.tsx
'use client';
import * as React from 'react';

export function AutoCloseTab() {
  const [secs, setSecs] = React.useState(5);
  const [blocked, setBlocked] = React.useState(false);

  React.useEffect(() => {
    if (secs === 0) {
      try {
        window.close();
        // If still here after a tick, the browser blocked the close
        const t = setTimeout(() => setBlocked(true), 250);
        return () => clearTimeout(t);
      } catch {
        setBlocked(true);
      }
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);

  if (blocked) {
    return <p className="mt-6 text-hint text-ink-700/60">Closing didn't work — close this tab manually.</p>;
  }
  return <p className="mt-6 text-hint text-ink-700/60">Auto-closing in {secs} seconds…</p>;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/[locale]/auth/success'
git commit -m "feat(web): add /auth/success page with 5s auto-close countdown"
```

---

### Task 56: OAuth provider registration runbook

**Files:**
- Create: `web/docs/oauth-setup.md`

This is a documentation-only task. The actual creation of OAuth clients in Google Cloud Console / Apple Developer / GitHub Developer Settings is a manual step that requires the founder's accounts. Document the URIs and scopes so the founder can complete the registration.

- [ ] **Step 1: Write the runbook**

````md
# OAuth provider setup runbook

## Google

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID — Application type: Web application
3. Name: "Lisna web (production)"
4. **Authorized JavaScript origins:**
   - `https://lisna.jp`
   - `http://localhost:3000` (development)
5. **Authorized redirect URIs:**
   - `https://lisna.jp/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID → `GOOGLE_CLIENT_ID`
7. Copy Client secret → `GOOGLE_CLIENT_SECRET`

## GitHub

1. Go to https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Name: "Lisna"
3. Homepage URL: `https://lisna.jp`
4. Authorization callback URL: `https://lisna.jp/api/auth/callback/github`
5. Generate a client secret
6. Copy Client ID → `GITHUB_CLIENT_ID`
7. Copy Client secret → `GITHUB_CLIENT_SECRET`

(Create a separate OAuth app for development with `http://localhost:3000` URLs if you want local OAuth smoke.)

## Apple

Apple Sign-In requires:
- Apple Developer Program enrollment (separate side track)
- App ID with "Sign in with Apple" capability
- Services ID with `lisna.jp` and `https://lisna.jp/api/auth/callback/apple` configured
- A signing key (.p8) for generating the client secret JWT

This is deferred until Apple Developer Program enrollment lands. See Apple's docs: https://developer.apple.com/documentation/sign_in_with_apple

Once provisioned:
- `APPLE_CLIENT_ID` = Services ID identifier (e.g., `jp.lisna.signin`)
- `APPLE_CLIENT_SECRET` = JWT generated from the .p8 key (script: `web/scripts/generate-apple-secret.ts` — to be added when Apple enrollment lands)

## Vercel env wiring

Once values are in hand, set them in Vercel:

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add GITHUB_CLIENT_ID production
vercel env add GITHUB_CLIENT_SECRET production
# Apple deferred
```

Pull to `.env.local` for local dev:

```bash
vercel env pull web/.env.local
```
````

- [ ] **Step 2: Commit**

```bash
git add web/docs/oauth-setup.md
git commit -m "docs(web): add OAuth provider setup runbook (Google/GitHub/Apple)"
```

---

## Phase K — Custom URL scheme handshake (Tasks 57-61)

Goal: end-to-end app ↔ web auth handshake. `/api/auth/exchange-code/issue` generates a single-use code → redirects to `lisna://callback?code=...` → desktop app exchanges via `/api/auth/exchange-code/redeem` for a long-lived device token.

### Task 57: app-auth.ts (exchange-code logic)

**Files:**
- Create: `web/src/lib/app-auth.ts`
- Test: `web/src/lib/app-auth.test.ts`

- [ ] **Step 1: Write failing tests for the pure logic**

```ts
// web/src/lib/app-auth.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateExchangeCode, buildCallbackUrl } from './app-auth';

describe('app-auth pure helpers', () => {
  it('generateExchangeCode returns a 64-char hex string', () => {
    const code = generateExchangeCode();
    expect(code).toMatch(/^[a-f0-9]{64}$/);
  });
  it('two generated codes are unique', () => {
    const a = generateExchangeCode();
    const b = generateExchangeCode();
    expect(a).not.toBe(b);
  });
  it('buildCallbackUrl appends the code to the lisna:// callback', () => {
    const url = buildCallbackUrl('lisna://callback', 'abc123');
    expect(url).toBe('lisna://callback?code=abc123');
  });
  it('buildCallbackUrl handles a callback that already has query params', () => {
    const url = buildCallbackUrl('lisna://callback?foo=bar', 'abc123');
    expect(url).toBe('lisna://callback?foo=bar&code=abc123');
  });
  it('buildCallbackUrl rejects non-lisna schemes', () => {
    expect(() => buildCallbackUrl('https://evil.example.com/cb', 'abc')).toThrow(/scheme/i);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd web && pnpm test src/lib/app-auth.test.ts
```

- [ ] **Step 3: Implement pure helpers**

```ts
// web/src/lib/app-auth.ts
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { appExchangeCodes, appDevices } from '@/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';

const EXCHANGE_TTL_MS = 10 * 60 * 1000;  // 10 minutes
const DEVICE_TOKEN_TTL_DAYS = 90;

export function generateExchangeCode(): string {
  return randomBytes(32).toString('hex');
}

export function buildCallbackUrl(callback: string, code: string): string {
  if (!callback.startsWith('lisna://')) {
    throw new Error(`Invalid app callback scheme: ${callback}`);
  }
  const sep = callback.includes('?') ? '&' : '?';
  return `${callback}${sep}code=${encodeURIComponent(code)}`;
}

export async function issueExchangeCode(userId: string): Promise<string> {
  const code = generateExchangeCode();
  const expiresAt = new Date(Date.now() + EXCHANGE_TTL_MS);
  await db.insert(appExchangeCodes).values({ code, userId, expiresAt });
  return code;
}

export async function redeemExchangeCode(code: string): Promise<{ userId: string; deviceToken: string }> {
  // Atomic: mark consumed only if still unconsumed AND not expired.
  const now = new Date();
  const updated = await db
    .update(appExchangeCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(appExchangeCodes.code, code),
        isNull(appExchangeCodes.consumedAt),
        gt(appExchangeCodes.expiresAt, now),
      ),
    )
    .returning({ userId: appExchangeCodes.userId });

  if (updated.length === 0) {
    throw new Error('exchange code invalid or already consumed');
  }
  const { userId } = updated[0];

  // Create a device record + token
  const deviceToken = randomBytes(48).toString('base64url');
  await db.insert(appDevices).values({
    userId,
    deviceToken,
    name: 'Mac', // TODO: send a device name from the desktop client
  });
  return { userId, deviceToken };
}

export const DEVICE_TOKEN_TTL_DAYS_EXPORT = DEVICE_TOKEN_TTL_DAYS;
```

- [ ] **Step 4: Run tests — expect 5/5 pass**

```bash
cd web && pnpm test src/lib/app-auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/app-auth.ts web/src/lib/app-auth.test.ts
git commit -m "feat(web): add app-auth helpers (code gen + callback URL builder + DB issue/redeem)"
```

---

### Task 58: /api/auth/exchange-code/issue endpoint

**Files:**
- Create: `web/src/app/api/auth/exchange-code/issue/route.ts`

- [ ] **Step 1: Implement issue route**

This endpoint runs **after** Auth.js completes signin — Auth.js redirects to here when `?source=app` was in the original signin URL. It pulls the current session, mints an exchange code, and 302s the browser to `lisna://callback?code=...`.

```ts
// web/src/app/api/auth/exchange-code/issue/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { issueExchangeCode, buildCallbackUrl } from '@/lib/app-auth';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/signin', req.url));
  }
  const callback = req.nextUrl.searchParams.get('app_callback') ?? 'lisna://callback';
  if (!callback.startsWith('lisna://')) {
    return new NextResponse('invalid scheme', { status: 400 });
  }
  const code = await issueExchangeCode(session.user.id);
  const url = buildCallbackUrl(callback, code);
  // 302 the browser to the lisna:// URL — macOS routes it to Lisna.app.
  // Also include a fallback HTML body in case the OS does not handle the redirect cleanly.
  return new NextResponse(
    `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${url}" /><title>Returning to Lisna…</title></head>
<body><p>Returning to Lisna… <a href="/auth/success">Continue in browser</a></p>
<script>window.location.href = ${JSON.stringify(url)};</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/auth/exchange-code/issue
git commit -m "feat(web): add /api/auth/exchange-code/issue (mint code + redirect to lisna://)"
```

---

### Task 59: /api/auth/exchange-code/redeem endpoint

**Files:**
- Create: `web/src/app/api/auth/exchange-code/redeem/route.ts`
- Test: `web/src/app/api/auth/exchange-code/redeem/route.test.ts`

- [ ] **Step 1: Write failing test (mocking redeemExchangeCode)**

```ts
// web/src/app/api/auth/exchange-code/redeem/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/app-auth', () => ({
  redeemExchangeCode: vi.fn(),
}));

const { redeemExchangeCode } = await import('@/lib/app-auth');
const { POST } = await import('./route');

describe('POST /api/auth/exchange-code/redeem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on missing code', async () => {
    const req = new Request('http://x/api/auth/exchange-code/redeem', { method: 'POST', body: JSON.stringify({}) });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 401 on invalid code', async () => {
    (redeemExchangeCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid'));
    const req = new Request('http://x/api/auth/exchange-code/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'bad' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns token on valid code', async () => {
    (redeemExchangeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u1', deviceToken: 'devtok123' });
    const req = new Request('http://x/api/auth/exchange-code/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'good' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('devtok123');
    expect(body.userId).toBe('u1');
  });
});
```

- [ ] **Step 2: Implement route**

```ts
// web/src/app/api/auth/exchange-code/redeem/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { redeemExchangeCode } from '@/lib/app-auth';

export async function POST(req: NextRequest) {
  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: 'missing_code' }, { status: 400 });
  }
  try {
    const { userId, deviceToken } = await redeemExchangeCode(code);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    return NextResponse.json({ token: deviceToken, userId, expiresAt });
  } catch {
    return NextResponse.json({ error: 'invalid_or_consumed' }, { status: 401 });
  }
}
```

- [ ] **Step 3: Run tests — expect 3/3 pass**

```bash
cd web && pnpm test src/app/api/auth/exchange-code/redeem
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/auth/exchange-code/redeem
git commit -m "feat(web): add /api/auth/exchange-code/redeem (code → device token)"
```

---

### Task 60: Auth.js redirect callback — forward to /api/auth/exchange-code/issue on source=app

**Files:**
- Modify: `web/src/lib/auth.ts`

- [ ] **Step 1: Add redirect callback to Auth.js config**

In `web/src/lib/auth.ts`, extend the `NextAuth({...})` call with:

```ts
callbacks: {
  async redirect({ url, baseUrl }) {
    // If signin was started with source=app, the resend flow sets redirectTo to
    // /api/auth/exchange-code/issue?app_callback=...  Auth.js calls redirect()
    // with that URL once verification is complete. Pass it through unchanged.
    if (url.startsWith('/api/auth/exchange-code/issue')) {
      return `${baseUrl}${url}`;
    }
    // Default: allow same-origin redirects, otherwise go to /dashboard
    if (url.startsWith(baseUrl)) return url;
    if (url.startsWith('/')) return `${baseUrl}${url}`;
    return `${baseUrl}/dashboard`;
  },
},
```

- [ ] **Step 2: Typecheck**

```bash
cd web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth.ts
git commit -m "feat(web): forward source=app signins through /api/auth/exchange-code/issue"
```

---

### Task 61: Custom URL scheme handshake — manual smoke checklist

**Files:**
- Create: `web/docs/handshake-smoke.md`

The web side of the handshake is now complete. Full e2e validation requires the desktop side (Phase M). Document the smoke procedure for when both sides are ready.

- [ ] **Step 1: Write the smoke checklist**

````md
# App ↔ web handshake smoke checklist

Prereqs: Phase M desktop integration complete (URL scheme registered, sign-in button wired).

## Web side check (Phase K only)

1. Sign in via browser:
   - `http://localhost:3000/signin?source=app&app_callback=lisna%3A%2F%2Fcallback`
2. After magic-link or OAuth completes, the browser is redirected to `/api/auth/exchange-code/issue?app_callback=lisna%3A%2F%2Fcallback`.
3. Inspect the response — it should contain a `<meta http-equiv="refresh">` and a script redirecting to `lisna://callback?code=<64-hex>`.
4. Without the desktop app running, the browser prints "site can't be reached." Verify the URL bar shows `lisna://callback?code=...`.

## End-to-end (Phase M + K together)

1. Launch Lisna.app (Phase M build with URL scheme registered).
2. On first launch, click "Sign in to start."
3. Default browser opens to `/signin?source=app&app_callback=lisna%3A%2F%2Fcallback`.
4. Complete magic link / OAuth.
5. Browser shows the meta-refresh page momentarily, then macOS routes the `lisna://callback?code=...` URL to Lisna.app.
6. Lisna.app posts to `/api/auth/exchange-code/redeem` with the code and stores the returned token in Keychain.
7. App UI mounts (recording view).
8. Browser navigates to `/auth/success` with auto-close countdown.

## Failure cases to verify

- Code used twice → second redeem returns 401.
- Code older than 10 minutes → redeem returns 401.
- App callback scheme not `lisna://` → issue returns 400.
````

- [ ] **Step 2: Commit**

```bash
git add web/docs/handshake-smoke.md
git commit -m "docs(web): add handshake smoke checklist for Phase K + M integration"
```

---

## Phase L — Dashboard (Tasks 62-66)

Goal: `/dashboard` authenticated entry point with download card, plan card, devices list, Discord card, AvatarMenu nav dropdown. Device revoke endpoint. Sign-out flow.

### Task 62: AvatarMenu component

**Files:**
- Create: `web/src/components/ui/avatar-menu.tsx`

- [ ] **Step 1: Implement avatar menu**

```tsx
// web/src/components/ui/avatar-menu.tsx
'use client';
import Link from 'next/link';
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from './dropdown';

export interface AvatarMenuProps {
  name: string;
  email: string;
  image?: string | null;
  prefix: string;
  onSignOut: () => Promise<void>;
}

export function AvatarMenu({ name, email, image, prefix, onSignOut }: AvatarMenuProps) {
  return (
    <Dropdown>
      <DropdownTrigger className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-accent-tan text-cream-50 text-body-sm grid place-items-center font-serif overflow-hidden">
          {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : (name[0]?.toUpperCase() ?? '·')}
        </span>
        <span>{name}</span>
        <span className="text-[10px]">▾</span>
      </DropdownTrigger>
      <DropdownContent align="end">
        <div className="px-3 py-2">
          <p className="text-body-sm text-ink-900">{name}</p>
          <p className="text-hint text-ink-700/70">{email}</p>
        </div>
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href={`${prefix}/dashboard`}>Dashboard</Link>
        </DropdownItem>
        <DropdownItem asChild>
          <form action={onSignOut} className="w-full">
            <button type="submit" className="w-full text-left">Sign out</button>
          </form>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
```

- [ ] **Step 2: Replace NavBar's inline avatar with AvatarMenu**

In `web/src/components/ui/navbar.tsx`, replace the authenticated-state link with `<AvatarMenu ... />`:

```tsx
<AvatarMenu
  name={authState.name}
  email={authState.email}
  image={authState.image}
  prefix={prefix}
  onSignOut={async () => {
    'use server';
    const { signOut } = await import('@/lib/auth');
    await signOut({ redirectTo: '/' });
  }}
/>
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/components/ui/avatar-menu.tsx web/src/components/ui/navbar.tsx
git commit -m "feat(web): add AvatarMenu dropdown + wire into NavBar auth state"
```

---

### Task 63: /dashboard page

**Files:**
- Create: `web/src/app/[locale]/dashboard/page.tsx`

- [ ] **Step 1: Implement dashboard**

```tsx
// web/src/app/[locale]/dashboard/page.tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import type { Locale } from '@/i18n/routing';

export default async function DashboardPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale === 'en' ? '' : locale + '/'}signin?next=/dashboard`);

  const devices = await db
    .select()
    .from(appDevices)
    .where(and(eq(appDevices.userId, session.user.id), isNull(appDevices.revokedAt)))
    .orderBy(appDevices.lastSeenAt);

  const firstName = (session.user.name ?? session.user.email ?? '').split(' ')[0] || 'there';

  return (
    <DashboardShell locale={locale}>
      <h1 className="font-serif text-h2 text-ink-900">
        Hi, <em className="italic text-accent-tan">{firstName}</em>.
      </h1>
      <p className="mt-2 text-body-sm text-ink-700">You're in the alpha. Here's your dashboard.</p>

      <div className="mt-12 grid lg:grid-cols-[2fr_1fr] gap-6">
        <Card className="lg:row-span-2">
          <p className="text-meta uppercase text-accent-tan">YOUR APP</p>
          <h3 className="mt-2 font-serif text-h2-sm text-ink-900">Lisna for macOS</h3>
          <p className="mt-3 text-body text-ink-700">The latest desktop build.</p>
          <div className="mt-6">
            <Button asChild><Link href="/dl/dmg/latest">Download for Mac →</Link></Button>
          </div>
          <p className="mt-2 text-hint text-ink-700/60">v0.1.0 · 537 MB · Apple Silicon</p>
          <div className="mt-6 border-t border-ink-900/10 pt-4">
            <p className="text-meta uppercase text-ink-700/60">Files</p>
            <ul className="mt-2 space-y-1 text-body-sm text-ink-700">
              <li>· <a href="/dl/dmg/latest" className="underline">Lisna-0.1.0.dmg</a></li>
              <li>· <a href="https://github.com/May1350/Lisna/releases" className="underline">ggml-large-v3-q5_0.bin (Whisper)</a></li>
              <li>· <a href="https://github.com/May1350/Lisna/releases" className="underline">Llama-3.2-3B-Instruct-Q4_K_M.gguf</a></li>
            </ul>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <p className="text-meta uppercase text-accent-tan">COMMUNITY</p>
            <h3 className="mt-2 font-serif text-grid-title text-ink-900">Discord</h3>
            <p className="mt-2 text-body-sm text-ink-700">Join the alpha channel for updates, support, and feedback.</p>
            <div className="mt-4">
              <Button asChild variant="text-arrow">
                <a href="https://discord.gg/69NkqBTbS" target="_blank" rel="noreferrer">Join the alpha channel →</a>
              </Button>
            </div>
          </Card>
          <Card>
            <p className="text-meta uppercase text-accent-tan">PLAN</p>
            <span className="mt-2 inline-block text-meta uppercase tracking-[0.12em] px-2 py-0.5 rounded-sm bg-margin-red/10 text-margin-red">FREE ALPHA</span>
            <p className="mt-3 font-serif text-display-2 text-ink-900">$0</p>
            <p className="text-body-sm text-ink-700/70">/ forever during alpha</p>
            <p className="mt-4 text-body-sm text-ink-700">We'll give you 30 days notice before pricing kicks in.</p>
          </Card>
        </div>
      </div>

      <Card className="mt-12">
        <p className="text-meta uppercase text-accent-tan">DEVICES</p>
        <h3 className="mt-2 font-serif text-grid-title text-ink-900">Connected Macs</h3>
        {devices.length === 0 ? (
          <p className="mt-4 text-body-sm text-ink-700/70">No devices yet. Open Lisna.app to register this Mac.</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink-900/10">
            {devices.map((d) => {
              const recent = d.lastSeenAt && new Date(d.lastSeenAt).getTime() > Date.now() - 1000 * 60 * 30;
              return (
                <li key={d.id} className="py-3 flex items-center gap-3 text-body-sm">
                  <span className={recent ? 'w-2 h-2 rounded-full bg-accent-sage' : 'w-2 h-2 rounded-full bg-ink-700/30'} />
                  <span className="flex-1 text-ink-900">{d.name ?? 'Mac'}</span>
                  <span className="text-ink-700/70">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}</span>
                  <form action={async () => {
                    'use server';
                    const { db } = await import('@/lib/db');
                    const { appDevices } = await import('@/db/schema');
                    const { and: a, eq: e } = await import('drizzle-orm');
                    await db.update(appDevices).set({ revokedAt: new Date() }).where(a(e(appDevices.id, d.id), e(appDevices.userId, session.user!.id!)));
                  }}>
                    <button type="submit" className="underline text-ink-700/70 hover:text-margin-red">sign out</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add 'web/src/app/[locale]/dashboard'
git commit -m "feat(web): add /dashboard (download card + plan card + devices list with inline revoke)"
```

---

### Task 64: Device revoke API endpoint

**Files:**
- Create: `web/src/app/api/auth/revoke-device/route.ts`
- Test: `web/src/app/api/auth/revoke-device/route.test.ts`

- [ ] **Step 1: Write test**

```ts
// web/src/app/api/auth/revoke-device/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 'd1' }])) })) })) })),
  },
}));

const { auth } = await import('@/lib/auth');
const { POST } = await import('./route');

describe('POST /api/auth/revoke-device', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns 401 without session', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ id: 'd1' }), headers: { 'Content-Type': 'application/json' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });
  it('returns 200 on successful revoke', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ id: 'd1' }), headers: { 'Content-Type': 'application/json' } }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Implement route**

```ts
// web/src/app/api/auth/revoke-device/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const result = await db
    .update(appDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(appDevices.id, body.id), eq(appDevices.userId, session.user.id)))
    .returning({ id: appDevices.id });
  if (result.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ id: result[0].id });
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && pnpm test src/app/api/auth/revoke-device
git add web/src/app/api/auth/revoke-device
git commit -m "feat(web): add /api/auth/revoke-device endpoint (auth-gated owner-only)"
```

---

### Task 65: Device token refresh endpoint

**Files:**
- Create: `web/src/app/api/auth/refresh/route.ts`

- [ ] **Step 1: Implement**

```ts
// web/src/app/api/auth/refresh/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await db
    .update(appDevices)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(appDevices.deviceToken, m[1]), isNull(appDevices.revokedAt)))
    .returning({ id: appDevices.id });
  if (result.length === 0) return NextResponse.json({ error: 'invalid_or_revoked' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && pnpm exec tsc --noEmit
git add web/src/app/api/auth/refresh
git commit -m "feat(web): add /api/auth/refresh (bearer token validity ping + lastSeenAt bump)"
```

---

### Task 66: Sign-out smoke

**Files:** (verification only)

- [ ] **Step 1: Manual smoke**

```bash
cd web && pnpm dev
```

Sign in via `/en/signin`. Open `/en/dashboard`. Click avatar → Sign out. Verify:
- Redirect to `/`
- Subsequent visit to `/dashboard` redirects to `/signin?next=/dashboard`

- [ ] **Step 2: Run full test suite**

```bash
cd web && pnpm test
```

Expected: all tests pass.

---

## Phase M — Desktop app integration (Tasks 67-71)

Goal: `lisna://` URL scheme registered, "Sign in to start" button wired, exchange-code redeem in app, token storage in macOS Keychain, token loaded on app boot.

### Task 67: Register URL scheme in electron-builder.yml

**Files:**
- Modify: `desktop/electron-builder.yml`

- [ ] **Step 1: Inspect**

```bash
cat desktop/electron-builder.yml | head -80
```

- [ ] **Step 2: Add CFBundleURLTypes**

Under the `mac:` key, add (or merge into existing `extendInfo`):

```yaml
mac:
  extendInfo:
    CFBundleURLTypes:
      - CFBundleURLName: lisna
        CFBundleURLSchemes:
          - lisna
```

- [ ] **Step 3: Rebuild + verify**

```bash
cd desktop && JOBS=1 pnpm run package 2>&1 | tail -10
plutil -p dist/mac/Lisna.app/Contents/Info.plist | grep -A 4 CFBundleURLTypes
```

Expected: `CFBundleURLName = lisna` + `CFBundleURLSchemes = ["lisna"]`.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron-builder.yml
git commit -m "feat(desktop): register lisna:// URL scheme in Info.plist"
```

---

### Task 68: URL scheme handler in main process

**Files:**
- Create: `desktop/src/main/url-scheme.ts`
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Implement url-scheme.ts**

```ts
// desktop/src/main/url-scheme.ts
import { app, BrowserWindow } from 'electron';

export type UrlSchemeHandler = (url: string) => void | Promise<void>;

let pendingUrl: string | null = null;
let handler: UrlSchemeHandler | null = null;

export function registerUrlScheme(onUrl: UrlSchemeHandler): void {
  handler = onUrl;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith('lisna://'));
    if (url) dispatch(url);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatch(url);
  });
  const coldUrl = process.argv.find((a) => a.startsWith('lisna://'));
  if (coldUrl) pendingUrl = coldUrl;
}

export function flushPendingUrl(): void {
  if (pendingUrl) {
    dispatch(pendingUrl);
    pendingUrl = null;
  }
}

function dispatch(url: string): void {
  if (!handler) {
    pendingUrl = url;
    return;
  }
  void handler(url);
}
```

- [ ] **Step 2: Wire into main/index.ts**

Add near app startup, before `app.whenReady()`:

```ts
import { registerUrlScheme, flushPendingUrl } from './url-scheme';
import { handleAuthCallback } from './auth/exchange';

registerUrlScheme(async (url) => {
  const parsed = new URL(url);
  if (parsed.host === 'callback') {
    const code = parsed.searchParams.get('code');
    if (code) await handleAuthCallback(code);
  }
});

app.whenReady().then(() => {
  // ... existing window creation ...
  flushPendingUrl();
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd desktop && pnpm exec tsc --noEmit
git add desktop/src/main/url-scheme.ts desktop/src/main/index.ts
git commit -m "feat(desktop): wire lisna:// URL scheme handler (cold-start + single-instance)"
```

---

### Task 69: Keychain wrapper + exchange-code redeem

**Files:**
- Create: `desktop/src/main/auth/keychain.ts`
- Create: `desktop/src/main/auth/exchange.ts`
- Modify: `desktop/package.json` (add keytar)

- [ ] **Step 1: Install keytar**

```bash
cd desktop && pnpm add keytar
```

- [ ] **Step 2: Implement keychain.ts**

```ts
// desktop/src/main/auth/keychain.ts
import keytar from 'keytar';

const SERVICE = 'com.lisna.desktop';
const ACCOUNT = 'device_token';

export async function storeToken(token: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, token);
}
export async function loadToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}
export async function clearToken(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
```

- [ ] **Step 3: Implement exchange.ts**

```ts
// desktop/src/main/auth/exchange.ts
import { BrowserWindow } from 'electron';
import { storeToken } from './keychain';

const REDEEM_URL = process.env.LISNA_WEB_URL ?? 'https://lisna.jp';

export async function handleAuthCallback(code: string): Promise<void> {
  const res = await fetch(`${REDEEM_URL}/api/auth/exchange-code/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    console.error('exchange-code redeem failed:', res.status);
    return;
  }
  const { token } = await res.json() as { token: string };
  await storeToken(token);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('auth/signed-in');
  }
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd desktop && pnpm exec tsc --noEmit
git add desktop/src/main/auth desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): add Keychain wrapper + exchange-code redeem on lisna:// callback"
```

---

### Task 70: Sign-in view + boot token load

**Files:**
- Create: `desktop/src/renderer/routes/SignInView.tsx`
- Modify: `desktop/src/main/ipc.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/App.tsx`

- [ ] **Step 1: Renderer SignInView**

```tsx
// desktop/src/renderer/routes/SignInView.tsx
import * as React from 'react';

export function SignInView() {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>Welcome to Lisna</h1>
      <p style={{ marginBottom: 24, color: '#3a3025' }}>Sign in to start.</p>
      <button
        onClick={() => window.lisna?.signIn()}
        style={{ padding: '14px 28px', background: '#1a1410', color: '#f8f3e9', border: 0, borderRadius: 6, cursor: 'pointer' }}
      >
        Sign in to start
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Main IPC handler for sign-in**

```ts
// desktop/src/main/ipc.ts — add:
import { shell, ipcMain } from 'electron';
import { loadToken } from './auth/keychain';

ipcMain.handle('auth/sign-in', async () => {
  const webUrl = process.env.LISNA_WEB_URL ?? 'https://lisna.jp';
  const callback = encodeURIComponent('lisna://callback');
  await shell.openExternal(`${webUrl}/signin?source=app&app_callback=${callback}`);
});

ipcMain.handle('auth/get-state', async () => ({
  signedIn: (await loadToken()) !== null,
}));
```

- [ ] **Step 3: Preload exposure**

```ts
// desktop/src/preload/index.ts — extend the existing contextBridge.exposeInMainWorld('lisna', {...}):
signIn: () => ipcRenderer.invoke('auth/sign-in'),
getAuthState: () => ipcRenderer.invoke('auth/get-state'),
onSignedIn: (cb: () => void) => ipcRenderer.on('auth/signed-in', cb),
```

- [ ] **Step 4: App.tsx gate**

```tsx
// desktop/src/renderer/App.tsx — wrap the existing main view in an auth gate
import * as React from 'react';
import { SignInView } from './routes/SignInView';

export function App() {
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    window.lisna?.getAuthState().then((s: { signedIn: boolean }) => setSignedIn(s.signedIn));
    window.lisna?.onSignedIn(() => setSignedIn(true));
  }, []);

  if (signedIn === null) return null;
  if (!signedIn) return <SignInView />;
  // Replace with existing main view (the v2 alpha Recording UI):
  return <ExistingMainView />;
}
```

(Replace `<ExistingMainView />` with whatever the current top-level view is.)

- [ ] **Step 5: Typecheck + commit**

```bash
cd desktop && pnpm exec tsc --noEmit
git add desktop/src/renderer/routes/SignInView.tsx desktop/src/main/ipc.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add sign-in view + boot token check + auth/signed-in event"
```

---

### Task 71: End-to-end handshake smoke

**Files:** (verification only)

- [ ] **Step 1: Build + launch**

```bash
cd desktop && JOBS=1 pnpm run package
LISNA_WEB_URL=http://localhost:3000 open desktop/dist/mac/Lisna.app
```

(In parallel, run `cd web && pnpm dev` with `.env.local` configured for OAuth + Resend.)

- [ ] **Step 2: Run through the smoke checklist (see `web/docs/handshake-smoke.md`)**

Verify each step in the doc. Capture any failures, fix, re-build, re-smoke.

- [ ] **Step 3: Mark Phase M complete**

---

## Phase N — Analytics + CD + production env (Tasks 72-76)

Goal: Plausible script integration, custom event firing, GitHub Actions release workflow that builds DMG + publishes to GH Release, `latest-mac.yml` for electron-updater, Vercel env wiring.

### Task 72: Plausible script + event helper

**Files:**
- Modify: `web/src/app/layout.tsx`
- Create: `web/src/lib/plausible.ts`

- [ ] **Step 1: Add Plausible script to root layout**

In `web/src/app/layout.tsx`, add `<Script>` in `<head>`:

```tsx
import Script from 'next/script';
import { env } from '@/lib/env';
// ... existing imports + fonts

return (
  <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
    <head>
      <Script
        defer
        data-domain={env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
        src="https://plausible.io/js/script.tagged-events.js"
      />
    </head>
    <body>{children}</body>
  </html>
);
```

- [ ] **Step 2: Create plausible.ts helper**

```ts
// web/src/lib/plausible.ts
declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
  }
}

export function track(event: string, props?: Record<string, string>): void {
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible(event, props ? { props } : undefined);
  }
}

export const Events = {
  DownloadClick: 'download_click',
  SigninInitiated: 'signin_initiated',
  SigninCompleted: 'signin_completed',
  DiscordClick: 'discord_click',
} as const;
```

- [ ] **Step 3: Wire `download_click` event on Hero + CTAStrip + Pricing + Dashboard download buttons**

Use `className="plausible-event-name=download_click"` on the `<a>` (Plausible's tagged-events plugin auto-fires from class). Or use programmatic `track('download_click')` in `onClick`.

Apply to:
- `Hero` button `<Link>` (add `className="plausible-event-name=download_click"`)
- `CTAStrip` button
- `PricingCards` alpha plan CTA
- `/dashboard` Download for Mac button

- [ ] **Step 4: Wire `discord_click` similarly on Footer Discord link + Dashboard Discord card link**

- [ ] **Step 5: Commit**

```bash
git add web/src/app/layout.tsx web/src/lib/plausible.ts web/src/components/marketing web/src/components/ui/footer.tsx 'web/src/app/[locale]/dashboard'
git commit -m "feat(web): integrate Plausible analytics + tag download_click and discord_click events"
```

---

### Task 73: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Implement release workflow**

```yaml
# .github/workflows/release.yml
name: Release desktop

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: pnpm/action-setup@v3
        with: { version: 9 }

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install workspace deps
        run: pnpm install --frozen-lockfile

      - name: Build sidecars
        run: |
          cd desktop
          JOBS=1 ./scripts/build.sh

      - name: Typecheck + tests
        run: |
          cd desktop && pnpm exec tsc --noEmit && pnpm test

      - name: Build + package Electron
        env:
          # Codesigning + notarization stay OFF for alpha — flip on in Side Track A
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: |
          cd desktop && JOBS=1 pnpm run package

      - name: Compute SHA256
        run: |
          cd desktop/dist
          shasum -a 256 *.dmg > SHA256SUMS.txt
          cat SHA256SUMS.txt

      - name: Publish GH Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            desktop/dist/*.dmg
            desktop/dist/*.dmg.blockmap
            desktop/dist/latest-mac.yml
            desktop/dist/SHA256SUMS.txt
          generate_release_notes: true
```

- [ ] **Step 2: Verify electron-builder produces `latest-mac.yml`**

In `desktop/electron-builder.yml`, ensure publish config exists:

```yaml
publish:
  provider: github
  owner: May1350
  repo: Lisna
  releaseType: release
```

(electron-builder auto-generates `latest-mac.yml` only when `publish` is configured and the build is run with `--publish` flag. For this workflow we publish manually via softprops/action-gh-release, so we also need `pnpm run package` to be `electron-builder --publish never` so it generates `latest-mac.yml` locally without pushing.)

Verify `desktop/package.json` `package` script:

```json
"package": "electron-builder --mac --publish never"
```

- [ ] **Step 3: Smoke locally (without tag)**

```bash
cd desktop && JOBS=1 pnpm run package
ls desktop/dist/
# Expect: Lisna-<version>.dmg, Lisna-<version>.dmg.blockmap, latest-mac.yml
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml desktop/electron-builder.yml desktop/package.json
git commit -m "feat(desktop): add release workflow (GH Actions tag → DMG + latest-mac.yml)"
```

---

### Task 74: electron-updater integration in desktop

**Files:**
- Modify: `desktop/package.json` (add electron-updater)
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Install electron-updater**

```bash
cd desktop && pnpm add electron-updater
```

- [ ] **Step 2: Wire auto-update check on app ready**

```ts
// desktop/src/main/index.ts — add:
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  // ... existing window creation ...

  // Auto-update check (alpha: silent, in-background; surface a notification when ready)
  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Auto-update check failed:', err);
  });
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd desktop && pnpm exec tsc --noEmit
git add desktop/package.json desktop/pnpm-lock.yaml desktop/src/main/index.ts
git commit -m "feat(desktop): integrate electron-updater (auto-check on launch)"
```

---

### Task 75: Vercel env wiring + production deploy verification

**Files:**
- (no source changes; only env management + smoke)

- [ ] **Step 1: Generate NEXTAUTH_SECRET**

```bash
openssl rand -base64 32
```

Copy the value (do not write it into any file or commit). Add to Vercel:

```bash
cd web && vercel env add NEXTAUTH_SECRET production
# Paste the value when prompted (Vercel CLI never writes to disk in your repo).
```

- [ ] **Step 2: Add remaining required env vars to Vercel**

For each variable listed in `web/.env.example`, add to Vercel production. Treat each as `vercel env add <NAME> production`. Required for alpha launch:

- `NEXTAUTH_URL=https://lisna.jp`
- `NEXTAUTH_SECRET` (generated above)
- `RDS_PROXY_ENDPOINT`, `RDS_USERNAME`, `AWS_REGION` (RDS Proxy IAM details — fetch from CDK outputs / AWS console)
- `RESEND_API_KEY` (fetch from Resend dashboard)
- `EMAIL_FROM=auth@lisna.jp`
- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=lisna.jp`
- `GITHUB_OWNER=May1350`, `GITHUB_REPO=Lisna`

OAuth provider values (defer if not provisioned yet — `auth.ts` already skips providers that have no env vars):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` (Apple Dev Program gated — defer)

- [ ] **Step 3: Pull env to local for last dev smoke**

```bash
cd web && vercel env pull .env.local
```

Confirm the file exists, contains all the keys you added. (Don't commit `.env.local` — it's in `.gitignore`; reconfirm.)

```bash
grep -q '^.env.local$' web/.gitignore || echo '.env.local' >> web/.gitignore
```

- [ ] **Step 4: Deploy preview**

```bash
cd web && vercel  # interactive — creates preview deployment
```

Smoke the preview URL (e.g., `lisna-jp-<hash>.vercel.app`):
- `/` renders, hero loads, fonts apply
- `/en/signin` renders, magic-link form submits + Check-Email branch appears
- `/dl/dmg/latest` 302s to GH Release (or releases page if no release yet)

- [ ] **Step 5: Promote to production**

```bash
cd web && vercel --prod
```

Verify `https://lisna.jp/` renders the new home.

- [ ] **Step 6: Commit any .gitignore changes only**

```bash
git add web/.gitignore
git commit -m "chore(web): gitignore .env.local"
```

---

### Task 76: DNS + Resend domain verification

**Files:** (DNS / Resend dashboard — out of repo)

- [ ] **Step 1: Verify Resend sender domain**

Go to https://resend.com/domains → Add `lisna.jp` → copy SPF + DKIM + DMARC records.

- [ ] **Step 2: Add DNS records on お名前.com**

For each record Resend provides, add to lisna.jp DNS:
- SPF: TXT `@` `v=spf1 include:resend.dev ~all`
- DKIM: 3 CNAME records as Resend specifies
- DMARC: TXT `_dmarc` `v=DMARC1; p=none;`

- [ ] **Step 3: Wait for verification + send test**

```bash
cd web && pnpm exec tsx -e "
import { Resend } from 'resend';
const r = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await r.emails.send({
  from: 'auth@lisna.jp',
  to: 'test@example.com',
  subject: 'Lisna smoke',
  text: 'verification smoke',
});
console.log({ data, error });
"
```

Replace `test@example.com` with a real inbox you own. Expect delivery within seconds.

- [ ] **Step 4: Document the runbook**

```bash
# Append to web/docs/oauth-setup.md a "Resend domain verification" section listing the steps above.
```

- [ ] **Step 5: Commit doc**

```bash
git add web/docs/oauth-setup.md
git commit -m "docs(web): add Resend domain verification runbook for lisna.jp DKIM/SPF"
```

---

## Phase O — Final smoke + launch (Tasks 77-80)

Goal: end-to-end smoke against production, fix discovered issues, declare alpha launch.

### Task 77: Production smoke — anonymous download

**Files:** (smoke checklist execution)

- [ ] **Step 1: Visit https://lisna.jp/ from incognito**

Verify:
- Hero renders with cream background + Fraunces + Inter fonts
- "Download for Mac →" button is the dominant CTA
- All 12 home sections present
- Trust strip shows "Keio University" only
- Privacy section dark with `100%` stat in tan italic
- Pricing shows Alpha highlighted + Pro placeholder
- FAQ expands/collapses
- Footer has Discord/GitHub/Bluesky links + locale switcher

- [ ] **Step 2: Locale smoke**

Visit `/`, `/ja`, `/ko`. Verify URL changes, content translates, fonts switch (Noto Serif JP only for `/ja`).

- [ ] **Step 3: Download click → DMG download**

Click "Download for Mac". Verify:
- Browser starts a `.dmg` download from GH Releases
- Plausible records `download_click` event (check dashboard)

- [ ] **Step 4: Mobile responsive**

iPhone 15 Pro emulation:
- Hero stacks vertically, font scales down
- Nav collapses cleanly
- Pricing cards stack
- Footer columns stack to 2-col or 1-col

- [ ] **Step 5: Capture any visual issues; fix and redeploy**

For each issue: file → fix → `vercel --prod`. Re-smoke.

---

### Task 78: Production smoke — sign-in flow (web only)

**Files:** (smoke checklist execution)

- [ ] **Step 1: Magic link smoke**

Visit `https://lisna.jp/signin`. Enter your email. Submit. Verify:
- "Check your email" branch renders
- Email arrives at the inbox within ~30s
- Email rendered correctly (Notebook Craft tone HTML)
- Click magic link → browser opens `/dashboard` (after Auth.js verifies)
- Dashboard renders with avatar in nav + Hi, <name>. heading

- [ ] **Step 2: OAuth smoke (Google + GitHub)**

Sign out. From `/signin`, click "Continue with Google". Complete OAuth. Verify:
- Redirected back to `/dashboard`
- Avatar shows Google profile picture
- Plausible records `signin_initiated` + `signin_completed`

Repeat for GitHub. (Apple deferred until Apple Dev Program.)

- [ ] **Step 3: Sign out smoke**

Click avatar → Sign out. Verify redirect to `/`, session cookie cleared, `/dashboard` redirects to `/signin?next=/dashboard`.

---

### Task 79: Production smoke — handshake (web + desktop)

**Files:** (full e2e with desktop app)

Prereq: Task 73 release workflow shipped a DMG. Or build the desktop app locally with `LISNA_WEB_URL=https://lisna.jp` and install manually.

- [ ] **Step 1: Install Lisna.app on a Mac that has never seen Lisna**

- [ ] **Step 2: Launch — verify Sign-in view appears**

- [ ] **Step 3: Click "Sign in to start"**

Verify:
- Default browser opens `https://lisna.jp/signin?source=app&app_callback=lisna%3A%2F%2Fcallback`

- [ ] **Step 4: Complete magic link signin**

Verify:
- Browser shows meta-refresh page momentarily
- macOS prompts "Open Lisna?" or routes directly to Lisna.app
- Lisna.app's renderer transitions from SignInView to main UI
- Browser navigates to `/auth/success` with auto-close countdown

- [ ] **Step 5: Quit + relaunch Lisna.app**

Verify:
- Main UI mounts immediately (token loaded from Keychain)

- [ ] **Step 6: Sign out from web dashboard, then test app behavior**

- Go to `https://lisna.jp/dashboard`
- Click the "sign out" link next to this Mac in the Devices list
- Back in Lisna.app, the next API call to `/api/auth/refresh` returns 401
- App should clear Keychain and return to SignInView
  - (If not implemented, document as known limitation — defer 401-handling to a Phase 2 polish task)

---

### Task 80: Production verification + launch announcement

**Files:**
- Create: `web/src/content/changelog/2026-05-XX-public-alpha.mdx` (date matches launch day)

- [ ] **Step 1: Full repo test suite**

```bash
cd web && pnpm test && pnpm exec tsc --noEmit
cd desktop && pnpm test && pnpm exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 2: Lighthouse + accessibility audit on `https://lisna.jp/`**

```bash
# Use Chrome DevTools or pnpm dlx lighthouse
pnpm dlx lighthouse https://lisna.jp --output html --output-path /tmp/lh.html
open /tmp/lh.html
```

Targets:
- Performance: > 90 (mostly static SSG should make this easy)
- Accessibility: > 95
- Best Practices: > 95
- SEO: > 95

Fix any major regressions before launch.

- [ ] **Step 3: Add launch changelog entry**

```mdx
---
date: 2026-05-XX
version: 0.1.0
category: feature
title: v0.1.0 — Mac desktop alpha (public)
---

Lisna is now public alpha. The full website lives at https://lisna.jp.

- [Download](/download) — 537 MB · macOS 13+ · Apple Silicon
- 100% on-device: Whisper + Llama 3.2 run locally
- Markdown / Obsidian export
- [Join Discord](https://discord.gg/69NkqBTbS)

Known limitations:
- Apple notarization pending; first-launch requires right-click → Open
- Whisper occasionally hallucinates on silent input — fix in progress
- Windows / Linux post-alpha
```

- [ ] **Step 4: Tag release and deploy**

```bash
git tag -a v0.1.0 -m "Public alpha launch"
git push --tags
# GH Actions release workflow fires automatically (Task 73)
```

(Note: only the founder should run `git push --tags` — per global rule, never push without explicit user consent.)

- [ ] **Step 5: Commit changelog**

```bash
git add web/src/content/changelog/
git commit -m "feat(web): add v0.1.0 public alpha launch changelog entry"
```

- [ ] **Step 6: Final go/no-go**

Review all of the following with the founder:
- [ ] All marketing pages load cleanly in 3 locales
- [ ] Sign-in (magic link + Google + GitHub OAuth) works end-to-end
- [ ] Desktop handshake works end-to-end on a fresh Mac
- [ ] Dashboard renders correctly post-signin
- [ ] Download link points to a real DMG
- [ ] Plausible records events
- [ ] Resend delivers magic links reliably (test from 3 different inboxes)
- [ ] Lighthouse scores within targets

If green, **announce alpha launch** in Discord + tweet/Bluesky.

---

## Self-Review Checklist (run BEFORE handing plan to executor)

### 1. Spec coverage

- [ ] §1.1-1.3 Goal/scope → Phase A bootstrap + plan scope statement ✓
- [ ] §2 Phased rollout B' → captured in plan intro + side tracks called out ✓
- [ ] §3 Site IA (13 pages) → Phase E (shells) + Phase F (home) + Phase G (functional) + Phase H (legal) + Phase J (signin/success) + Phase L (dashboard) ✓
- [ ] §4 D3 user flow → Phase F hero CTA + Phase J signin + Phase K handshake + Phase M desktop ✓
- [ ] §5 Hero locked → Task 26 ✓
- [ ] §6 12-section home → Tasks 26-35 ✓
- [ ] §7 Functional pages → Phase G (7.4 download, 7.5 docs, 7.6 changelog, 7.7 compare, 7.8 pricing) + Phase H (7.9 legal) + Phase J (7.1 signin, 7.2 success) + Phase L (7.3 dashboard) ✓
- [ ] §8 Design system → Phase A (tokens) + B (foundation) + C (Radix) ✓
- [ ] §9 Architecture → Phase A (Tailwind setup) + I (DB) + J (Auth) + K (handshake) + N (CD + analytics) ✓
- [ ] §10 i18n → Phase D ✓
- [ ] §11 Legal → Phase H (Task 44) ✓
- [ ] §12 Deferred Q1-Q10 → reflected as out-of-scope notes in respective phase intros ✓
- [ ] §13 References → referenced inline (mockup files for visual ground truth at Task 26+) ✓
- [ ] §14 Self-review → mirrored here ✓

### 2. Placeholder scan

No TBD / TODO / "implement later" / "similar to Task N" without showing the code. ✓
A few "see spec §X" pointers exist for legal-page v2 content — acceptable because the spec is committed and the executor can read it; alternative is duplicating 200 lines of legal copy here. Document the trade-off explicitly: founder review of v2 legal additions on smoke is the gate.

### 3. Type consistency

- `Locale` type imported consistently from `@/i18n/routing` across all pages
- `authState` discriminator (`'guest' | { name, email, image }`) consistent in NavBar + AvatarMenu + getAuthState
- `Button` `variant` enum: `primary-ink` | `ghost` | `text-arrow` used consistently
- Drizzle schema: `appExchangeCodes.userId` vs `app_exchange_codes.user_id` — Drizzle handles SQL casing via column name; TS access stays camelCase
- `track(event)` event names use `Events` const enum — no magic strings in implementation tasks

### 4. Phase dependency graph

```
A (bootstrap)
  ↓
B (design foundation) ──→ C (Radix) ──→ D (i18n) ──→ E (shells)
                                                         ↓
                                                     F (home) ──→ G (marketing pages)
                                                                       ↓
                                                                   H (legal)
                                                                       ↓
                                                                   I (DB) ──→ J (Auth) ──→ K (handshake)
                                                                                                 ↓
                                                                                             L (dashboard)
                                                                                                 ↓
                                                                                             M (desktop) ──→ N (CD) ──→ O (launch)
```

No phase depends on a later phase. Each phase ends with a commit that leaves the repo in a working state.

### 5. Trade-offs and open risks (re-confirmed)

- **Apple Sign-In deferred** until Apple Dev Program enrollment lands. Auth.js config in Task 51 silently skips the Apple provider when env vars are absent — fine for alpha.
- **Codesign + notarize** still deferred — Gatekeeper workaround documented in `/docs/troubleshooting`. Acceptable for alpha audience (technical users + Discord support).
- **JP/KO translations** for home-page features are stubbed in Task 34 — founder fills during smoke (Task 77 §2). Acceptable per spec §10.1 (founder is bilingual JP-resident).
- **`web` workspace tests** use Vitest (not Jest) for consistency with desktop. New convention; no migration needed because `web/` has no existing tests.
- **RDS Proxy IAM** path is the production default; `DATABASE_URL` fallback is for local dev only. The two-mode `makePool()` in Task 47 keeps both clean.

---

**Plan complete.** ~80 tasks across 15 phases. Each task has explicit file paths, code snippets, verification commands, and a commit step. Self-review confirms spec coverage and dependency ordering.

**Implementation: Subagent-Driven Development recommended.** Per skill instructions, two-stage review between tasks catches drift early; SDD fits this scope (frontend + auth + IPC across 3 workspaces).

