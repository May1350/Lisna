# Lisna Design System (Concept 1+)

> Single source of truth for visual language. Anything that disagrees
> with this document is wrong unless this document is updated first.
> Originating mockups: `docs/design-mockups/notes-v2.html` &
> `docs/design-mockups/full-system.html`.

---

## 1. Philosophy

**Calm productivity, warm paper.** Lisna sits next to a video the user
is trying to focus on. The design must:

- **Disappear into reading** — no alert-y full-bleed colors, no
  decorative chrome, no emoji clutter.
- **Reward attention to detail** — typographic hierarchy, tabular
  numbers, hairline borders, generous whitespace. Premium feel comes
  from craft, not visual noise.
- **Stay readable on small surfaces** — the modal is ~360 px wide.
  Information density matters more than empty space.
- **Differentiate via warmth** — most SaaS uses cool gray + indigo.
  Lisna uses warm cream paper + earthy terracotta. Same blueprint as
  Linear / Notion, but instantly distinguishable when seen side-by-side.

Three signature moves separate Lisna from "another SaaS card":

1. **Warm paper surface** instead of cool gray
2. **Earthy terracotta accent** reserved for value-bearing actions (Pro,
   takeaway emphasis), instead of the corporate indigo default
3. **Numbers in monospace** with tabular-nums everywhere — quiet
   precision signal

---

## 2. Tokens

### 2.1 Color

All tokens live as CSS variables on `:root` in
`extension/src/side-panel/index.css`. Tailwind utilities reference them
through `tailwind.config.ts`.

```
Surface (warm paper, not cool gray)
  --paper-100  #FFFEFB   primary card / modal surface
  --paper-200  #FBFAF7   secondary surface / subtle fills
  --paper-300  #F4F2EC   tertiary surface / chip backgrounds
  --paper-edge #E8E4DC   hairline 1px borders (almost invisible)

Ink (warm charcoal, not pure black)
  --ink-900    #1A1614   headlines / primary text / primary buttons
  --ink-700    #3D3733   body text
  --ink-500    #6E6660   secondary text / metadata
  --ink-300    #A39A93   tertiary text / placeholders
  --ink-200    #C8C0B7   disabled / subtle dot fills

Brand (terracotta — earthy, warm, distinctive)
  --terra      #C2410C   solid accent (rare; reserved for Pro CTA)
  --terra-700  #9A330A   hover / pressed terra
  --terra-soft #FED7AA   border on emphasis cards
  --terra-tint #FFF7ED   surface fill for emphasis cards

State
  --warn-red   #B91C1C   blocking / 100% / failures
  --warn-amber #B45309   warning / 90-99% / drift
  --ok-green   #4F7C5C   recording / success indicators
```

#### 2.1.1 Color Reservation Rule (CRITICAL)

`--terra` solid is **reserved for value-bearing payment / Pro
affordances**. Specifically:

- ✅ Pro plan price text, upgrade-card prices
- ✅ Solid CTA buttons that lead to checkout
- ❌ Decorative use, generic emphasis, "fun pop"

For **content emphasis** (Take, important point, TLDR), use the soft
end of the same family:

- ✅ `--terra-tint` background + `--terra-soft` border + `--terra`
  3px leftbar = "this is a takeaway"
- ✅ `--terra` 6px dot for important bullet points (with 2px
  `--terra-tint` ring)
- ✅ `--terra-soft` highlighter on important bullet text (solid block,
  `box-decoration-break: clone`)

This way: same hue family, three intensity tiers — payment surfaces,
content emphasis, and decorative ring.

**Primary buttons** (Stop, Save, Send, Confirm) use `--ink-900`, NOT
`--terra`. Solid black on cream feels deliberate; a button in
`--terra` would compete visually with the Pro upgrade slot.

### 2.2 Typography

```
Sans:  'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI',
       'Hiragino Sans', 'Apple SD Gothic Neo', sans-serif
Mono:  ui-monospace, 'SF Mono', Menlo, Consolas, monospace
```

We use the system Inter/SF stack to avoid extension CSP / network
font-loading risk. Geist is the design reference — Inter renders close
enough in mixed CJK contexts and ships zero bytes.

#### 2.2.1 Scale

| Use                    | Size  | Weight | Family | Notes                    |
| ---------------------- | ----- | ------ | ------ | ------------------------ |
| Page heading (Options) | 18px  | 700    | sans   | letter-spacing -0.015em  |
| Section heading        | 14px  | 600    | sans   | letter-spacing -0.005em  |
| Note title             | 17px  | 700    | sans   | letter-spacing -0.015em  |
| Body                   | 12.5px| 400    | sans   | line-height 1.6          |
| Body emphasis          | 12px  | 500    | sans   | for Take / important     |
| Number (price / time)  | varies| 500-600| MONO   | tabular-nums always      |
| Eyebrow / label        | 9.5–11px | 500-600 | mono | uppercase, letter-spacing 0.16em |
| Tooltip / micro        | 10–11px | 400  | sans   | gray ink-300 / ink-500   |

#### 2.2.2 Hard rules

- **Every number in mono** (`font-family: var(--font-mono)`) **with
  tabular-nums** (`font-variant-numeric: tabular-nums`). Includes
  timestamps, percents, prices, durations.
- **Body text in sans.** Headings in sans. Eyebrow labels in mono with
  uppercase + 0.16em tracking.
- **No serif.** Earlier mockups experimented with serif headlines —
  ultimately rejected for CJK-fallback inconsistency.
- **No emoji in user-visible UI.** Emojis read AI-generated and clutter
  on small surfaces. Exception: log lines / dev console (audit-only).

### 2.3 Spacing & Radius

```
Radius
  --radius-sm   6px   chips, badges, small buttons
  --radius-md  10px   cards, banners, primary buttons
  --radius-lg  14px   modal, large dialog cards

Spacing — use Tailwind defaults (4px-base scale).
Gap inside a card row:  8-10px
Gap between sections:   14-22px
Padding inside a card:  10-16px (small) / 18-22px (large)
```

### 2.4 Shadow

```
--shadow-sm   0 1px 0 rgba(26, 22, 20, 0.02),
              0 8px 24px -12px rgba(26, 22, 20, 0.08)
--shadow-md   0 1px 0 rgba(26, 22, 20, 0.04),
              0 16px 32px -16px rgba(26, 22, 20, 0.12)
```

Cards inside the modal: `--shadow-sm`. The modal itself: `--shadow-md`.
Nothing else gets shadow. We rely on hairline borders + warm paper for
depth.

---

## 3. Component Baseline

### 3.1 Buttons

Three roles. Pick by intent, not by color preference.

| Role            | Background       | Text         | Use                                        |
| --------------- | ---------------- | ------------ | ------------------------------------------ |
| Primary         | `--ink-900`      | `--paper-100`| Main action (Stop, Send, Continue, Pause)  |
| Secondary       | `--paper-100`    | `--ink-700`  | Alternate action with `--paper-edge` border|
| Soft pill (text)| `--paper-300`    | `--ink-700`  | Small secondary controls (e.g. "2×" speed) |
| Soft icon       | transparent      | `--ink-700`  | Header icon-only (sidebar, settings, ×)    |
| Quiet           | transparent      | `--ink-500`  | Tertiary affordance (chevron, dismiss)     |

Hover for soft icon: lift to `--paper-300` background + ink-900 text.

Disabled: `--ink-200` background, `--ink-300` text, `cursor:
not-allowed`.

Padding: `9px 12px` for primary/secondary, `5px 10px` for soft pill,
`30×30 min` for icon-only.

### 3.2 Card

```css
background: var(--paper-100);
border: 1px solid var(--paper-edge);
border-radius: var(--radius-md);
padding: 14px 16px;        /* default */
box-shadow: var(--shadow-sm);   /* only when card floats */
```

Variants:
- **Default card** (above) — neutral content
- **Emphasis card** — Take / TLDR / important content highlight:
  ```css
  background: var(--terra-tint);
  border: 1px solid var(--terra-soft);
  border-left: 3px solid var(--terra);
  ```
- **Pro upgrade chunk** — same as emphasis but the `--terra` price text
  + `--ink-900` solid CTA button beneath.

### 3.3 Progress Bar

```
Track:  4px tall, --paper-300 bg, rounded-full
Fill:   100% — --warn-red
        90-99% — --warn-amber
        50-89% — --ink-700 (or hide entirely)
        <50% — hide entirely (no banner)
Caption row below bar:
  used / limit (mono, tabular-nums)  •  pct% (mono, ink-900)
Reset note:
  small (10–11px) ink-300 mono, "resets …"
```

The bar is the SOLE visual conveyor of "how full are you". Don't
also describe it in body text — just the bar caption + reset note.

### 3.4 Chip / Tag / Badge

| Element        | Style                                                |
| -------------- | ---------------------------------------------------- |
| ts chip        | `--paper-200` bg + `--paper-edge` border, mono 10.5px, ▶ icon prefix; hover invert to `--ink-900` fill |
| Section number | 22×22 circle, `--paper-300` bg, mono 10px 600        |
| Tag pill       | 11px sans, `--paper-200` bg, `--paper-edge` border, rounded-full (HIDDEN inside the modal — see 4.2) |
| Plan pill      | 10px mono uppercase, `--paper-300` bg or `--terra` for Pro |

### 3.5 Toggle (chevron)

Two intentional patterns. Don't mix.

**Tree disclosure** (section heading collapse):
```
Expanded:  ▼ (down chevron)
Collapsed: rotate(-90deg) → points right
```
Use for inline content (sections in OutlineView).

**Panel collapse** (bottom-anchored panel):
```
Expanded:  ▼ (down chevron) — "click to push down / collapse"
Collapsed: rotate(180deg) → ▲ — "click to pull up / expand"
```
Use for fixed surfaces docked at top/bottom (LiveTranscript).

Why different: the metaphor differs. Sections are tree nodes; panels
are dock strips. ▼/▶ communicates "child shown/hidden"; ▼/▲
communicates "panel pushed away/coming back".

---

## 4. Surface-Specific Rules

### 4.1 Modal Header (PanelHeader)

```
[Avatar 30×30]  takgun@keio.jp        [2×] [⊞] [⚙] [×]
                Free                  ↑    ↑   ↑   ↑
                                      pill icon icon icon
```

- Avatar: `--ink-900` solid circle, single-letter initial in
  `--paper-100`.
- Email (12.5px, 600, ink-900) + plan label (10.5px, 500, ink-500;
  Pro adds `--terra` dot prefix).
- Action buttons: only **2×** keeps a `--paper-300` pill. The icon
  buttons (sidebar / settings / close) are transparent by default,
  `--paper-300` fill on hover. Icon size 18×18, stroke-width 2.
- Buttons gap 2px (icons feel grouped) but the 2× pill carries 4px
  separation visually via padding.

### 4.2 OutlineView (Notes)

Top-down structure of a single lecture note:

1. **Eyebrow + Title row** — mono uppercase eyebrow ("Lecture · 3B1B"),
   17px 700 title; `updated Xm ago` mono stamp on the right.
2. **TLDR card** — emphasis card variant. 2-line clamp with "더보기" /
   "접기" toggle. Label "TL;DR" in mono `--terra-700`.
3. **Meta strip** — `8 sections` `14 key terms` `~17m total` in mono
   gray. (Future: also hosts Compact-mode toggle.)
4. **Section list** — each section:
   - `[01]` 22×22 circle badge + 14px 600 heading + ▶ ts chip + ⌃
     chevron (tree pattern).
   - One-paragraph 12.5px summary (`--ink-700`).
   - Take card (emphasis card) + label `Take`.
   - Key terms list with dashed dividers.
   - `e.g.` examples (mono prefix label).
   - Points list:
     - regular: 4px `--ink-200` dot
     - important: 6px `--terra` dot + 2px `--terra-tint` ring + body
       text wrapped in `<span class="hl">` for solid `--terra-soft`
       highlighter (must use `box-decoration-break: clone` so multi-line
       wraps highlight per line correctly)
   - Optional Check card (`--paper-200` bg, `--paper-edge` border) —
     reserved for important sections, not every section.
5. **Tags** — HIDDEN inside the modal (`display: none`). They exist
   only for Obsidian export wikilinks.
6. **Quiz roll-up** (Future / C5) — review questions aggregated.

### 4.3 LiveTranscript

Bottom panel, single source of "mic is hot, transcript is flowing".

```
[label]      [ recording ●pulse]      [⌃ chevron]
[caption line 1]
[caption line 2]
```

- Label: mono uppercase 9.5px `--ink-300`.
- Status: `--ok-green` 10px mono, dot pulses.
- Caption lines: ts mono `--ink-300` + body 11.5px `--ink-500`.
- Chevron: tree-pattern flipped (panel pattern). Default ▼, collapsed
  rotates 180° → ▲.

### 4.4 Quota surfaces

Three states in the same family (paper card + progress bar):

| State        | Trigger                | Chrome                                           |
| ------------ | ---------------------- | ------------------------------------------------ |
| Hidden       | <90% used              | nothing renders                                  |
| Warn (amber) | 90-99% used            | paper card + amber bar + Pro CTA                 |
| Blocked (red)| 100% / 402 received    | paper card + red bar + Pro CTA                   |
| Idle (full)  | 100% + URL has no notes| QuotaExhaustedIdle full card replacing IdleSession |

Critical: when the QuotaExhaustedIdle card renders, the standalone
QuotaBanner is suppressed (otherwise the same message appears twice).

### 4.5 Settings (Options page)

Sections separated by 16px padding + 1px `--paper-edge` divider:

1. Language (system + note language selectors)
2. Feedback form
3. Playback Speed
4. Plan (current plan card + Pro upsell card)
5. Obsidian export
6. Disable timer
7. Account (logout, switch account)

Each section header: 12px 600 mono uppercase letter-spacing 0.04em
`--ink-500`.

The Pro upsell card uses the **emphasis card** variant (terra-tint +
terra-soft border) with a large `--terra` mono price + features list +
solid `--ink-900` upgrade button.

### 4.6 Toasts

Top-of-viewport, single line + optional action button. Dark variant
(`--ink-900` bg) for primary alerts, light variant (`--paper-100` +
border) for non-critical confirmations, `--terra-tint` variant for
Pro-related notifications.

---

## 5. Interaction Patterns

### 5.1 Hover affordance

Every interactive surface lifts on hover:

- Background gets one tone darker (`--paper-200` → `--paper-300`)
- Or text color darkens (`--ink-500` → `--ink-900`)
- 120–160ms ease transition

No scale/transform animations (overdone in modern SaaS, distracting on
secondary surfaces).

### 5.2 Focus

Use `outline: 2px solid var(--terra); outline-offset: -1px` on inputs
and serious actions. Buttons can rely on visible bg change.

### 5.3 Smooth scroll

`scroll-behavior: smooth` on the OutlineView container. Quiz links and
Section rail clicks scroll-into-view.

### 5.4 Highlighter

Solid block highlight via:

```css
background: var(--terra-soft);
color: var(--ink-900);
-webkit-box-decoration-break: clone;
box-decoration-break: clone;
padding: 1px 3px;
margin: 0 -1px;
border-radius: 3px;
```

Why solid (not gradient): linear-gradient bands fall in line-height
padding for CJK glyphs (kana/kanji have negligible descenders, so
55-92% bands miss the actual character box). Solid block with
`box-decoration-break: clone` is robust across CJK + Latin + line
wraps.

---

## 6. Accessibility

- **Color contrast**: `--ink-900` on `--paper-100` is 14.7:1 (AAA).
  `--ink-500` on `--paper-100` is 4.7:1 (AA). Don't go below
  `--ink-500` for body text.
- **Tabular nums** for time-display ensures screen readers don't
  re-read flicker on every chunk update.
- **aria-label** on all icon-only buttons. Header buttons already
  have it.
- **role="log"** on LiveTranscript with `aria-live="polite"` so screen
  readers announce new caption lines without re-reading the entire
  region.
- **Keyboard navigation** — every clickable card / chip / link is
  reachable via Tab; primary CTA is the first tab stop in each surface.

---

## 7. Future Iterations (NOT in current PR)

These stayed in the mockup but are deferred for follow-up so the
visual baseline lands first cleanly:

- **A1 Section Rail** — sticky vertical dot/text mini-TOC on the left
  edge of OutlineView, active-section tracking via scroll position.
- **C2 Compact Mode** — meta-row toggle that hides everything except
  TLDR / Take / important points. CSS class on the OutlineView root.
- **C5 Quiz Section** — review questions roll-up at the end of the
  notes, with `→ NN` smooth-scroll-back links to source sections.
- **D2 Section Collapse** — chevron on each section heading; default
  expanded, click collapses content (heading-only).
- **D3 Modal Resize** — drag handle on the modal's right edge.
  Persists chosen width to `chrome.storage`.

When implementing, follow the patterns documented above (chevron
direction rules, color reservation, button hierarchy) — those rules
were derived assuming these features exist.

---

## 8. When in doubt

Default actions when faced with a design call this doc doesn't cover:

1. **Choose neutral over expressive.** Lisna is a study tool, not a
   marketing surface.
2. **Choose mono for numbers.** Tabular-nums everywhere makes the
   product feel quietly precise.
3. **Choose ink-900 over terra.** Reserve terra for moments that
   directly tie to value (Pro, takeaway).
4. **Choose paper over color.** Most surfaces should be `--paper-100`
   or `--paper-200`. Color carries meaning; absence of color is the
   default.
5. **Test in dev modal at 360px.** That's the actual viewport. If a
   detail breaks at 360px, it's wrong regardless of how it looks at
   1440px.

---

## 9. Reference mockups

Source of truth, in order of recency:

1. `docs/design-mockups/notes-v2.html` — full notes + all interactive
   features (Sections A+B+C+D2+D3 applied)
2. `docs/design-mockups/full-system.html` — every modal surface
   (header / banners / quota states / Options / toasts) at once
3. `docs/design-mockups/concept-1-plus.html` — original-vs-refined
   comparison demonstrating the 3 signature moves

When this document and a mockup disagree, **the document wins** —
update the mockup to match. The mockups are reference renderings; the
document is the spec.
