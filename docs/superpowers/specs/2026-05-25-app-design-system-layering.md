# App Design System — Layering & Reuse Strategy

**Date**: 2026-05-25
**Status**: Decided by founder (this session). Awaiting app-design work to begin; desktop is `parked`, extension is `frozen` — implementation starts when desktop is un-parked.
**Authority**: Founder chose the layered model over (a) forcing the web legal-pad system onto the app and (b) a fully separate app-only design system.
**Related**: `.claude/rules/web-design.md` (the `(scope-boundary)` rule), backlog "Extract design tokens to `shared/`" + "App design layer (desktop)".

---

## 1. Question

Can / should the legal-pad **web design system + the brand-layer-vs-work-layer boundary rule** be applied to the **app** (desktop v2; extension is frozen)? And should the app get its own design system + rules, or share the web's?

## 2. Findings (grounded in the code)

- **Desktop app (v2, `desktop/`)** has **no design system**: `electron-vite` + React 18, but zero Tailwind/CSS/tokens — screens use bare HTML + inline styles (`#888`, `<pre>`, raw `<button>/<fieldset>`). It is a functional skeleton. So there is nothing to "keep" — it is a blank slate that needs a system.
- **Extension (`extension/`)** already has its own Tailwind paper-ish tokens (`ink-900`, `paper-edge`), separate from the web legal-pad set. It is **frozen** and being phased out — not the target.
- The web design system is built on **framework-agnostic primitives** — Tailwind tokens, plain CSS utilities (`.pad-paper`/`.postit`/`.pencil-*`), an inline `#pencil-rough` SVG, and Google-font families — all of which run in the Electron (Chromium) renderer. The only Next-specific piece is **font loading** (`next/font/google`).

## 3. Decision — 3-layer system (NOT one shared system, NOT two separate ones)

| Layer | Home | Shared? |
|---|---|---|
| **Foundation tokens** — color, type families, type scale, spacing, radii | `shared/design` (to be extracted) | ✅ single source, web + app both consume |
| **Web expression layer** — legal-pad decoration (`.pad-paper`, `.postit`, `.pencil-*`, `.marginalia-hand`) + marketing components | `web/` + `web-design.md` | web-only |
| **App product layer** — product component library (menus, dialogs, lists, settings, recording controls…) + app UI rules (density, keyboard nav, long-session a11y, dark mode?) | `desktop/` + new `app-design.md` | app-only, **built on the shared tokens** |

**Rationale**: brand unity must live in the **tokens** (forking them → web and app drift into looking like different products). But the web's *components/decoration* are marketing devices (Postit/pencil/Hero) that don't belong in a dense work UI, and the app needs a much larger component set the marketing site never had. So: share the foundation, give the app its own component + rules layer.

## 4. Per-screen intent (from the app-UI review)

- **SignIn / Setup (model picker) / Error / Finalizing** — low-density / transitional → mirror the web auth legal-pad (`.pad-paper` + burgundy binding) for brand continuity.
- **NoteView** — reading a generated markdown note = the one in-app place a *restrained* paper nod fits (subtle cream surface, faint rule lines, serif headings). No post-it / pencil. (Also needs real markdown rendering — currently `<pre>`.)
- **Recording** — live-updating captions + audio controls = function-first. **Tokens only**, no paper texture (legibility + no churn while text streams).

## 5. Implementation sequence (when un-parked)

1. **Extract tokens** → `shared/design/tokens.ts` (color/type/scale/spacing); both `web/tailwind.config.ts` and a new `desktop/tailwind.config.ts` import from it.
2. **Set up Tailwind v4 in `desktop/`** (electron-vite + the v4 Vite plugin). Web + extension are already v4 → version-aligned.
3. **Self-host fonts** — bundle Fraunces / Inter / Caveat / Noto Serif JP as `.woff2` (e.g. `@fontsource/*`). The app is offline/on-device, so NOT `next/font` and NOT a runtime CDN `<link>`.
4. **Optionally share the legal-pad CSS** (`shared/design/legal-pad.css` + the `#pencil-rough` SVG) for the low-density app screens that reuse it.
5. **Build the app product-component layer** + write `.claude/rules/app-design.md` (density scale, interaction/keyboard/a11y conventions, the brand/work boundary applied in-app).

## 6. Caveats

- Scope: desktop `parked`, extension `frozen` — no implementation until founder un-parks desktop. This spec is the launchpad.
- `app-design.md` should be written *from* real app-design decisions (density scale, components), not pre-emptively — it captures conventions as they solidify.
- All the web legal-pad CSS (gradients, `aspect-ratio`, `filter: url(#…)`, `clamp()`, `box-decoration-break`) is modern-Chromium-safe → works in the Electron renderer as-is.
