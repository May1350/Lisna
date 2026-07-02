# App design — native-Mac (MacWhisper-style) with Lisna brand tokens

**Date**: 2026-07-02
**Status**: Direction decided by founder this session ("balanced" option). Visual reference produced (mockups). This spec codifies it. Implementation is a **separate future phase** (the app is stylistically a blank slate).
**Authority**: Founder brief — the desktop app should feel like a refined, simple **native Mac utility (MacWhisper)**. Confirmed the "balanced" brand-presence level.
**Related**: `docs/superpowers/specs/2026-05-25-app-design-system-layering.md` (this REFINES its section 4), `.claude/rules/web-design.md` (the `scope-boundary` rule), memory `legal_pad_identity` (the identity rule — see section 1).

---

## 1. Direction + relationship to prior decisions

The desktop app adopts a **native-Mac, minimal, refined** aesthetic: native window chrome, the system font (SF), generous whitespace, hairline borders, native controls (segmented pickers, pill buttons), and almost no decoration — the MacWhisper feel. The **single brand signal is the accent color: Lisna burgundy (`#6e1e1e`) replaces macOS blue** on the primary action, active states, the recording pulse, and timestamps. Two smaller nods: a Fraunces "Lisna" wordmark in the toolbar, and a whisper of warm-cream in the toolbar surface (not the legal-pad ruled paper).

**This refines the 2026-05-25 layering spec, it does not overturn it.** The 3-layer model (foundation tokens shared / web legal-pad expression / app product layer) STANDS. What changes: that spec's section 4 leaned toward *legal-pad brand continuity* + a *restrained paper nod* on the app's calmer screens. The founder's MacWhisper brief moves the **work app** to native-minimal instead. Brand unity now lives entirely in the **shared tokens** (burgundy, ink, the Fraunces wordmark), not in decoration — which is exactly what `web-design.md`'s `scope-boundary` rule already prescribed for dense work surfaces ("tokens only, NOT the decoration").

**Identity-rule note.** The `legal_pad_identity` HARD memory says "site/app must feel unmistakably legal pad." The founder has now **scoped that to the marketing site**: the legal-pad system is the brand/marketing identity; the app is native-minimal, kept recognizably Lisna via the burgundy accent + wordmark. The memory is updated to reflect this split.

## 2. Non-goals

- **No legal-pad decoration in the app**: no `.pad-paper` ruled surface, no post-it, no pencil accents, no marginalia. Those stay marketing-only.
- No skeuomorphism, no heavy drop-shadows, no gradients. Flat, native, quiet.
- Not a change to the marketing site (`web/`) — unchanged.
- Not implementation. This spec is the target; restyling every screen is a later effort.

## 3. Foundation tokens

Native-Mac neutrals + Lisna brand accent. All values are targets; the extract-to-`shared/design` step (section 7) is where they become code.

### 3.1 Color — light

| Role | Hex | Use |
|---|---|---|
| canvas | `#eae8e3` | behind the window (OS desktop in reality) |
| surface | `#ffffff` | window content |
| toolbar | `#faf9f6` | title bar / toolbar (faint warm-cream) |
| raised / hover | `#f4f2ec` | row hover, grouped-control track `#efeee7` |
| accent-tint | `#f4eaea` | selected / active-family tint (pale burgundy) |
| text-primary | `#1d1b17` | body, headings (warm ink) |
| text-secondary | `#86847d` | meta, secondary |
| text-hint | `#b0aea6` | captions, chevrons, placeholders |
| line-hairline | `#eeece6` | dividers, toolbar underline |
| border | `#e2e0d9` | window / control borders; strong `#dcdad2` |
| **accent (brand)** | `#6e1e1e` | primary button, active, pulse, arrows; hover `#82302f` |
| accent-quiet | `#b39b9b` | timestamps (a muted burgundy) |
| success | `#5fa872` | done / transcript-family tint `#eef3ee` + `#4d8c62` |

### 3.2 Color — dark (mandatory)

| Role | Hex |
|---|---|
| surface | `#201e1a` · toolbar `#272420` · raised `#2c2925` |
| accent-tint | `#3a2626` |
| text | primary `#efece6` · secondary `#a6a299` · hint `#807c73` |
| line | hairline `#302d27` · border `#34312b` |
| **accent** | fill `#8f3033` (record button, white text) · text/stroke `#d98b8b` (lightened burgundy for on-dark contrast) |
| success | `#7fbf95` |

Native apps lighten the accent in dark mode: burgundy → rose-burgundy `#d98b8b` for text/strokes, `#8f3033` for fills. Test every text token against near-black.

### 3.3 Typography

- **UI family**: system — `-apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`. This is the native default; no bundle needed.
- **Wordmark only**: Fraunces (self-hosted `.woff2`) — the "Lisna" toolbar mark. The only serif in the app.
- **Mono** (timer, timestamps): `ui-monospace, "SF Mono", Menlo, monospace`.
- **Weights**: 400 regular / 500 medium / 600 semibold (HIG-native; unlike the marketing 2-weight rule).
- **Scale**: heading 15px/600 · body 13.5px/400 · control 12.5px · label 11px/500 uppercase +0.06em (`#a29f97`) · caption 11.5px · timer 26px/500 mono.
- **Line-height**: body 1.7–1.75. Sentence case; JA/EN/KO copy per the language.

### 3.4 Spacing / radii

Window `11px` · card/pane `12px` · control `8px` · pill `9px` · segmented `8px` (inner pills `6px`). Content padding `24–28px`. Row padding `9–12px`. Gaps `8 / 12 / 16 / 20`.

## 4. Component patterns

- **Window chrome** — rounded `11px`, hairline border, `39px` toolbar: traffic-light dots (OS) + Fraunces "Lisna" wordmark left, icon actions right. Real app: hidden-inset title bar + custom toolbar.
- **Segmented control** — grouped track; active segment = white (light) / raised (dark) pill, medium weight, hairline. Used for Source + Language.
- **Buttons** — primary = burgundy fill + white text, pill (Record / confirm — **at most one per view**); secondary/ghost = surface/transparent + hairline; icon buttons = bare, muted, `aria-label`.
- **List row** — family-tinted icon tile + title (13.5/500) + meta (12/secondary) + chevron; **hairline dividers, not cards**; hover = raised tint.
- **Choice / picker row** — icon tile + label (13.5/600) + one-line description; the recommended/default row gets a `1.5px` burgundy border + a burgundy arrow.
- **Generation chip** — the shipped `backgroundJob` chip: floating bottom-right pill, hairline + faint shadow, burgundy dot + "生成中" + progress (`チャンク 2/3` / `N%`) + dismiss; states running / done (sage check) / error.
- **Level meter** — `5px` track, burgundy fill. **Timer** — `26px` mono.
- **Reading typography** (Note) — semibold section headings, 13.5/1.75 ink body, muted-mono timestamps for anchored items, generous spacing, **no paper texture**.

## 5. Per-screen intent

- **SignIn** — native, centered, Fraunces wordmark, provider buttons in their conventional treatment; calm, not legal-pad.
- **Setup / model picker** — native list/steps, wordmark, clear model rows + pick buttons.
- **Recording — idle (home)** — toolbar; Source + Language segmented; big burgundy Record; History list below.
- **Recording — active** — recording indicator + timer + level meter; Stop (burgundy) + クイック字幕; generation-chip overlay.
- **FamilyPicker** — "ノートの種類を選ぶ" + choice rows (会議 / 講義 / インタビュー / ブレスト / 文字起こしのみ); default highlighted.
- **Note** — toolbar (back, title, copy/export, new session); meta line; family-rendered structured note in the reading type; restrained.
- **Transcript** — subtitle-style rows (mono ts + text), inline-editable; toolbar copy/edit.
- **History** — list lives on the idle Recording screen; detail = transcript + regenerate (family choice) + edit.
- **Error** — native alert-quiet; permanent (give-up) → Restart.
- **Terms / glossary** — native list editor.

## 6. Dark mode

Mandatory (native apps expect it). Token-driven via section 3.2. Default: follow the OS appearance; a manual toggle is an optional later add. Mental test: every text token readable on near-black.

## 7. Implementation relationship (future phase — NOT this spec)

Follows the 2026-05-25 sequence, with the values updated to the native-Mac + dark palette here:

1. Extract foundation tokens → `shared/design/tokens.ts` (color incl. dark, type, scale, spacing).
2. Set up Tailwind v4 in `desktop/` (electron-vite + v4 Vite plugin).
3. Self-host **Fraunces** `.woff2` (wordmark only; SF is system → no bundle).
4. Build the app product-component layer (window/toolbar, segmented, buttons, list/choice rows, chip, meter, note typography) + write `.claude/rules/app-design.md` capturing these patterns as they solidify.
5. Restyle screens in the section-5 order (Recording first — the hero).

This is a large effort (every screen) and is gated on a founder greenlight. The visual mockups from this session are the target reference.

## 8. Levers (confirmed "balanced" 2026-07-02)

Accent intensity · surface warmth (cream ↔ neutral) · Fraunces scope (wordmark-only, as chosen, vs also note headings) · dark-mode auto-follow-OS vs manual toggle. All easy to shift later; balanced is the baseline.
