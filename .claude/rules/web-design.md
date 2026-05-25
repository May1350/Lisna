# Web design rules

Lisna marketing site (`web/`) uses a legal-pad notebook design system.
Open this file before:
- Changing tokens in `web/tailwind.config.ts`
- Adding utility classes to `web/src/styles/globals.css`
- Building a new marketing component
- Changing the page surface, NavBar, or a screenshot frame

Spec captured 2026-05-24 (PR #32 + #33). Mockup iteration sessions live
under `docs/superpowers/specs/2026-05-19-lisna-jp-fullsite-design.md`.

## Tokens (canonical — defined in `web/tailwind.config.ts`)

| Token | HEX | Role | Don't use for |
|---|---|---|---|
| `cream.50/100/200/300` | `#fefbf5` → `#ebe2cf` | Paper-family backgrounds, surfaces on burgundy | Text on cream pad |
| `ink.700` / `ink.900` | `#3a3025` / `#1a1410` | Body text, primary text | Decorative |
| `print.red` | `#c8333a` | **Printed** red margin line + eyebrow labels | Hand-drawn accents |
| `pencil.red` | `#dc2626` | **Hand-drawn** accents (`.pencil-circle`, `.pencil-line`, `.pencil-star`, marginalia) | Printed text / margin |
| `margin.red` | `#b85050` | Legacy text-label color (kept for backwards compat) | New code — prefer `print.red` |
| `burgundy` | `#6e1e1e` | NavBar binding | Anywhere outside the header |
| `accent.tan` | `#8a6a3a` | Italic emphasis (headline `<em>`) | Body text |
| `accent.sage` | `#5fa872` | Pricing checkmarks, success states | Decorative |
| `postit.main` | `#ffeb6b` | `<Postit>` body | Anywhere outside `.postit` |
| `postit.adhesive` | `#f5d850` | Post-it top adhesive band gradient | Solid surfaces |
| `postit.shadow` | `#f0d055` | Post-it bottom edge | Solid surfaces |
| `fontFamily.hand` | Caveat | Marginalia + post-it captions ONLY | Body, headings |

**Red hierarchy** (darkest → brightest): `burgundy #6e1e1e` (NavBar)
→ `print.red #c8333a` (margin line) → `pencil.red #dc2626` (accents).
All hue ~0°, same family. Don't add a fourth red without re-justifying.

## Utility classes (canonical — defined in `web/src/styles/globals.css`)

- **`.pad-paper`** — page surface. Cream background + ruled lines every
  32px + printed red margin via `background-image: linear-gradient(...)`
  at `var(--margin-offset)` (96px desktop, 32px mobile). The margin is
  encoded in `background-image` (NOT `::before`) so child sections with
  their own background-color naturally cover it. **NEVER** redraw the
  margin with `::before` — see `pitfalls.md (css-stacking)`. The ruled
  layer MUST set `background-size: ..., 100% 32px` so it tiles one clean
  32px cell; without an explicit size the repeating gradient is computed
  over the full element height and beats into 1–5px lines at fractional
  DPR. This is the **only** legal-pad surface — apply it (not the older
  `notebook-bg`/`ruled-paper`) to any new full-page surface (auth, etc.).
- **`.postit` + `.postit__inner` + `.postit__caption`** — yellow post-it
  screenshot frame. Use via `<Postit>`. V2-B shadow stack (em-scaled,
  `y = blur` so no upward bleed). Modifiers: `.postit--reverse`
  (rotate +1°), `.postit--wide` (5/4), `.postit--portrait` (4/5).
- **`.pencil-circle`** — Hero headline emphasis. Place inside an
  `inline-block` `<em>`. Single instance per page (Hero only).
- **`.pencil-line`** — body emphasis underline. Text-width fitted via
  `::after` (not SVG — SVG `viewBox` width drifts from text width).
- **`.pencil-star`** — pricing emphasis next to a highlighted price.
- **`.hl`** — highlighter. CSS background-image with
  `box-decoration-break: clone` so multi-line wraps stay natural.
  Default pink, switch via `--hl-rgb` CSS variable.
- **`.marginalia-hand`** — handwritten side-note. Stays inside body
  flow (does NOT bleed across the printed red margin). Color: pencil red.

## SVG filter (shared, inline at root)

`#pencil-rough` is defined ONCE in `web/src/app/layout.tsx` body (hidden
SVG with `feTurbulence` + `feDisplacementMap`). All `.pencil-*` classes
reference it via `filter: url(#pencil-rough)`. **Do NOT** redefine in a
component — it'll generate a duplicate ID + may not resolve from CSS.

## Component placement rules

- **`<Postit>`** replaces `<ScreenshotFrame>` on marketing surfaces
  (`Hero`, `FeatureBlock` image prop). `ScreenshotFrame` is still used
  outside marketing — don't delete it.
- **`<Marginalia>`** stays inside body flow with `margin-left: 0`. Do
  NOT pull it negative-margin into the page margin gutter — text
  collides with the printed red margin and characters get clipped.
  Distinguish via Caveat handwriting + rotation + pencil-red color.
- **NavBar** uses `bg-burgundy` solid. No `border` or `backdrop-blur`
  (no purpose under opaque color). Text is `cream-100` with white
  hover. Wordmark is `font-serif text-[26px]`.
- **`AuthShell`** (signin / auth pages) uses the SAME legal-pad surface
  (`.pad-paper`) + burgundy binding nav as the marketing site — not the
  old `notebook-bg`/blurred-cream nav. Keep the two bindings in sync
  (burgundy, `cream-100` wordmark `text-[26px]`).
- **`<LocaleSwitcher>`** uses `text-inherit` so it inherits whatever the
  parent sets (both NavBar and AuthShell are now burgundy → `cream-100`).
  Hover dims via opacity. Don't hardcode a text color again.

## Rules

- [2026-05-24] (postit) `<Postit>` font-size is `clamp(11px, 1.5vw, 17px)` and all box-shadow / filter values are em-scaled. Don't override the font-size in a wrapping div — it changes shadow proportion. Use modifier classes (`--wide`, `--portrait`) which re-set font-size. Reason: shadow stays proportional across viewports. last-cited: 2026-05-24
- [2026-05-24] (postit) Post-it shadow stack uses V2-B: three `drop-shadow()` with `y = blur` exactly. Do NOT add a fourth layer with `y < blur` or the cast shadow bleeds above the element (looks like a halo). See `pitfalls.md (css-shadow)`. Reason: cast shadows fall down, not up. last-cited: 2026-05-24
- [2026-05-24] (pad-paper) Page surface red margin is `background-image`, NOT `::before`. If you need to draw a horizontal line on `.pad-paper`, add another `linear-gradient` layer to the same `background-image` stack — don't introduce a positioned pseudo-element. Reason: stacking context predictability with child section backgrounds. last-cited: 2026-05-24
- [2026-05-24] (hand-font) `font-family: theme('fontFamily.hand')` is for **marginalia + post-it captions only**. Never body text, never UI labels. Caveat reads poorly below 18px. Reason: legibility hierarchy. last-cited: 2026-05-24
- [2026-05-24] (pencil-accents) Max 4 pencil-red accents per page (Hero circle + 1 body underline + pricing star + marginalia arrow). More = strikethrough inflation, the page reads as "scribbled" instead of "studied". Reason: visual restraint = perceived quality. last-cited: 2026-05-24
- [2026-05-24] (red-family) Don't introduce a fifth red. The four reds (`burgundy` / `margin.red` / `print.red` / `pencil.red`) already cover header / labels / printed / hand-drawn roles. New red shade → ask "which of these four is it actually?" first. Reason: token sprawl. last-cited: 2026-05-24
- [2026-05-24] (verify) For non-trivial design changes, run the visual verification loop via `.claude/commands/visual-verify.md` (Playwright + Chromium at desktop/tablet/mobile + Read-tool screenshot inspection). Catches CSS bugs (shadow bleed, stacking, overflow) that `tsc` and tests can't. Reason: design correctness ≠ code correctness. last-cited: 2026-05-24
- [2026-05-25] (pad-paper) `.pad-paper` ruled layer MUST carry an explicit `background-size: ..., 100% 32px`. Without it the repeating gradient renders over the full page height and Chromium beats it into 1–5px lines with uneven gaps at fractional DPR (measured 1.5×/2×). A fixed 32px tile rasterizes one cell and repeats on integer bounds. Reason: uniform line weight across DPRs. last-cited: 2026-05-25
- [2026-05-25] (auth-surface) Auth pages use `.pad-paper` + burgundy binding (same as marketing), NOT `notebook-bg`/`ruled-paper`/`red-margin`. The `ruled-paper` utility still exists for cards but is NOT the page surface. Reason: one legal-pad surface, consistent across marketing + auth. last-cited: 2026-05-25
- [2026-05-25] (oauth-buttons) Social sign-in buttons use each provider's conventional treatment — Google (white + 4-color G), Apple (black + apple mark), GitHub (`#24292f` + octocat) — via `Button variant="ghost"` + per-provider `className` override (twMerge wins) + icon from `provider-icons.tsx`. Keep `size` default (don't shrink). Reason: recognizable trust cues; deviating from convention hurts conversion. last-cited: 2026-05-25
