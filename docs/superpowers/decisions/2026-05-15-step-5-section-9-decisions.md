# Step 5 §9 — Open Decisions (1–4)

**Date**: 2026-05-15
**Status**: Decided by AI stand-in under founder delegation (Step 5 §9 items 1–4). Item 5 (GGUF + JA audio) escalated separately — see end of file.
**Parent spec**: `docs/superpowers/specs/2026-05-15-step-5-alpha-distribution-gate-design.md`
**Authority**: Founder explicitly delegated all §9 items 1–4 to AI for the Step 5 run. Item 5 requires real GGUF artifacts which only founder can provision; flagged as escalation.

These four decisions unblock Phases B–F implementation. They are reversible — none lock the codebase into a vendor or paid contract. If founder disagrees on any item post-implementation, the change cost is < 1 day each.

---

## 1. §5.1 Model packaging — **First-run file-picker, no CDN**

**Choice**: Alpha ships an Electron DMG that contains **no model files**. On first launch, if the resolver finds no GGUF in `app.getPath('userData')/models/`, the renderer shows a "First-run setup" view with a file-picker for each of the two models (STT and LLM). Selected paths are persisted into a small JSON config in `userData/`. Subsequent launches read that config; if either GGUF moved/deleted, re-prompt.

**Rationale**:
- v2.0 alpha audience = founder + ~5 hand-picked JA-speaking testers, all technically capable of downloading a GGUF.
- Bundling 3GB in DMG triples the upload/download cost for every iteration on app code itself — at this stage we expect 5+ DMG rebuilds before the app is alpha-stable.
- A first-run **CDN** download adds three engineering tasks (progress UI, retry, license-acceptance flow) that are pure overhead for an alpha of this size. Defer until public beta.
- The file-picker variant is the cheapest path to a working alpha. Founder hosts the two GGUFs on Drive/GitHub-release/personal-server (founder's choice — outside this decision's scope); alpha onboarding doc links to them.
- Reversible: switching to bundled-in-DMG later is just adding `extraResources` to `electron-builder.yml`. Switching to first-run-CDN later is also additive (the file-picker can stay as escape hatch).

**Implementation note**: The `MODELS_NOT_CONFIGURED` error path stays; the resolver runs at app boot and registers paths into `registerIpc` deps before `createWindow()` returns. If picker is dismissed, app stays on the setup view (does not transition to Recording). Detailed sub-spec deferred to a follow-up.

---

## 2. §3.1 Prompt rewrite target — **Plain-text JA with `【…】` section headers, `・` bullets, polite-desu/masu form**

**Choice**: Replace `defaultPrompt`'s `"Output Markdown"` instruction with a JA prompt that requests structured **plain text** using these conventions:
- Section headers wrapped in full-width brackets: `【要点】`, `【次のアクション】`, `【決定事項】`
- Bullet items prefixed with `・` (middle-dot, U+30FB)
- Section separation = single blank line
- Body text in polite **desu/masu** form (です・ます調) — not casual, not formal-keigo
- No `#`, `**`, `-`, `>`, backticks, or any Markdown syntax tokens

**Rationale**:
- `NoteView` renders via `<pre>` which preserves whitespace literally. Markdown tokens display as raw characters → terrible UX (already cited as R2 finding E).
- `【…】` is the standard Japanese convention for section headers in plain-text business documents. Renders cleanly in monospace + falls back gracefully to any future rich renderer.
- `・` is the canonical JA bullet glyph (vs. `-` which reads as Latin and breaks visual rhythm in JA text).
- Polite-desu/masu matches the register of Japanese workplace meeting notes — formal-keigo (お〜になります) feels servile for a personal productivity tool; casual (だ・である) feels rude for shared notes.
- Section names (`要点` / `次のアクション` / `決定事項`) cover the three load-bearing meeting-note categories without forcing the LLM to invent structure when content doesn't fit a category — the prompt instructs "omit any section without content."

**Phase B scaffolding**: prompt template lives in `desktop/src/main/sidecar/prompts/ja-note-v1.ts` (committed in Phase B). Final wording will be tuned post-§6-manual-smoke once we see what kotoba-whisper transcripts actually look like end-to-end. The eval-anchor structure + golden-note placeholder land in `desktop/docs/manual-verification.md` alongside the scaffold.

---

## 3. §3.2 ErrorView lang/tone — **JA-only, polite-desu/masu**

**Choice**: All ErrorView copy is **Japanese only**. No EN fallback in user-visible strings. Tone matches §2 above (polite desu/masu). Specific copy per error code is finalized in Phase E (after §3.6 give-up codes exist).

**Rationale**:
- v2.0 concept-lock = JA-only product. Adding EN copy now is dead code that will rot.
- Polite-desu/masu register matches the rest of the in-app voice (consistent register avoids tonal whiplash within one screen).
- Internal docs (`manual-verification.md`, ADRs, this file) stay EN/KO mixed — only user-facing copy is JA-locked.
- The interim friendly-fallback map in `ErrorView.tsx:24-33` currently uses EN. That gets replaced wholesale in Phase E; no migration cost.

**Note for Phase E implementer**: Each of the 7 known codes (`EMPTY_TRANSCRIPT`, `MODELS_NOT_CONFIGURED`, `SIDECAR_DOWN`, `UNSUPPORTED_LANGUAGE`, `APP_QUIT`, `SESSION_ACTIVE`, `NO_ACTIVE_SESSION`, `SESSION_NOT_READY`) plus new Phase C codes (`STT_TIMEOUT`, `LLM_LOAD_TIMEOUT`, `GENERATE_TIMEOUT`, `SIDECAR_GAVE_UP`) needs a 1–2 sentence JA string. Pick the cleanest variant per code; iterate post-alpha based on tester feedback.

---

## 4. §5.3 Alpha distribution channel — **Discord (private channel)**

**Choice**: Distribute the alpha .dmg and collect feedback via a **private Discord channel** dedicated to the alpha cohort. Onboarding doc (`desktop/docs/alpha-onboarding.md`) includes channel-invite instructions and the bug-report template (paste screenshot + drag `~/Library/Logs/Lisna/main.log.zip`).

**Rationale**:
- Discord infrastructure is **already set up** in the founder's environment (per session MCP tooling). Zero new external service.
- Real-time chat shortens the feedback loop vs. async (email / GitHub Issues).
- File-drop UX in Discord is native — testers can zip their log file and drag it in. Email loses attachments; GitHub requires a tester account.
- Private channel = access-controlled distribution. Avoids the "leaked alpha" problem of public GitHub Releases.
- Reversible: future cohorts can move to a private GitHub Releases repo (signed-DMG hosting) once we hit ~50 testers and Discord's noise/signal degrades.

**Note**: DMG hosting itself is a separate decision (founder owns — could be Discord file attachment, Drive share, GitHub release of a private repo). This decision only locks the *feedback channel*, not the *distribution surface*. Alpha onboarding doc punts hosting URL to founder until that's decided.

---

## §9 Item 5 — Escalation (not decided here)

**§6 Manual smoke prerequisites**: founder must provide:
1. A real Whisper GGUF (recommended: `ggml-kotoba-whisper-v2.0-q5_0.bin`, already at `~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin` per `manual-verification.md` line 49 — usable as-is).
2. A real instruction-tuned LLM GGUF (recommended size budget: ~2–3 GB, Q4_K_M; e.g. Llama 3.2 3B Instruct Q4_K_M, or a JA-tuned variant if founder prefers).
3. A ~2 min JA audio recording exercising the full Start→record→Stop loop (the 30s `tests/fixtures/audio/ja-30s.wav` exists but is TTS-generated; founder should record real speech for prompt tuning input).

**What we tried**: searched the repo for any existing LLM GGUF dev paths or a JA recording > 30s — none found. The 30s TTS fixture is good for STT regression tests but too short and too clean to surface real-world prompt-quality issues (silence-hallucinations, code-switching, register drift).

**Action requested from founder**:
- Provide the absolute path to the LLM GGUF (or download URL + license confirmation).
- Provide path to (or instructions to record) the JA test audio.
- After that, AI can resume from §6 manual smoke → §3.1 prompt finalization without further founder gating.

This is the only §9 item that cannot be decided without founder time. All four above are decided.
