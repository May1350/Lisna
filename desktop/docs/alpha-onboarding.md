# Lisna v2 アルファ版 — はじめに / Alpha Onboarding (Draft)

**Status**: DRAFT — Phase G (model packaging) と Phase H (codesign) 完了後に最終化。
**ADR**: `docs/superpowers/decisions/2026-05-15-step-5-section-9-decisions.md` §1, §4

このドキュメントは Lisna v2 デスクトップ版のアルファテスター向け案内です。配布チャネル (Discord) のメッセージから直接リンクされる前提で書いています。

This document is the onboarding guide for Lisna v2 desktop alpha testers. Linked directly from the distribution channel (Discord) per ADR §4.

---

## 必要なもの / What you need

- **macOS 13 以降** (macOS 14.4+ ではシステム音声録音も可能 / system audio capture available on macOS 14.4+)
- **マイク使用許可** (初回起動時に確認 / macOS will prompt on first launch)
- **約 5 GB の空きディスク** (.dmg + 2 つのモデルファイル / for .dmg + 2 model files)
- **8 GB 以上の RAM** (M1 8GB は最低ライン / M1 8GB is the floor — see "M1 8GB note" below)

## インストール / Install

1. Discord に投稿された最新の `.dmg` をダウンロード / download the latest `.dmg` from Discord.
2. `.dmg` を開き、`Lisna.app` を Applications フォルダにドラッグ / open the `.dmg` and drag `Lisna.app` to Applications.
3. `Lisna.app` を初回起動 — Gatekeeper の警告が出る場合は右クリック→「開く」 / right-click → "Open" if Gatekeeper warns (only until Phase H codesign lands).

## 初回セットアップ — モデルファイル / First-run setup — model files

ADR §1 のとおり、アルファ版はモデルファイルを **同梱せず**、初回セットアップで自分の手元のファイルを選択する形になります。

Per ADR §1, the alpha .dmg does **not** bundle model files. First-run setup picks files from your local disk.

Discord に投稿された 2 つのモデルファイルをダウンロードしてください / download these 2 model files from Discord:

1. **STT (音声→文字起こし)**: `ggml-kotoba-whisper-v2.0-q5_0.bin` (約 538 MB)
2. **LLM (文字起こし→ノート)**: `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (約 2.0 GB)

Lisna を起動 → "First-run setup" 画面でそれぞれのファイルを選択 / launch Lisna → on the "First-run setup" screen pick each file.

## 使い方 / Usage

1. マイクを許可 / grant microphone access (macOS のダイアログ)
2. ソースを選択 (マイク / システム音声) / pick source (Microphone / System audio)
3. "Start" → 話す / speak → "Stop"
4. ノートが生成されるまで 10–30 秒待つ / wait 10–30s for the note to generate
5. 完成したノートを保存 (コピー & ペースト) / save the note (copy + paste — persistence is v2.1)

## バグ報告 / Reporting bugs

1. 問題が起きた直後のログをコピー / copy the log right after the issue:

   ```
   ~/Library/Logs/Lisna/main.log
   ```

2. ログを zip にしてください / zip the log:

   ```bash
   cd ~/Library/Logs && zip -r lisna-log.zip Lisna/
   ```

3. Discord チャンネルに以下を投稿してください / post to the Discord channel:
   - スクリーンショット / screenshot
   - `lisna-log.zip` を添付 / attach `lisna-log.zip`
   - 何をしようとしていたか (1-2 文) / what you were trying to do (1-2 sentences)
   - もし可能なら macOS バージョン (`macOS 14.x` 等) / macOS version if you know

ログには文字起こし内容そのものは含まれません — タイムスタンプ、フェーズ、エラーコードのみです / Logs are **shape-only** — no transcript text, no audio. Just timestamps, phase names, error codes (privacy-by-default per the v2 concept lock).

## よくあるエラー / Common errors

| エラー (JA) | What it means | Recovery |
|------------|---------------|----------|
| 音声を検出できませんでした | No speech detected | 話してから Stop を押してください |
| 録音エンジンを再起動しています | Sidecar respawning | 数秒待って Try Again |
| 録音エンジンを復旧できませんでした | Sidecar gave up | "Lisna を再起動" ボタン |
| 文字起こしモデルの応答に時間がかかりすぎています | STT timeout | Try Again |
| ノート生成モデルの読み込みに時間がかかりすぎています | LLM load timeout | Try Again |
| この言語はまだサポートされていません | Non-JA language requested | v2.0 は日本語のみ |

## M1 8GB note

M1 8GB マシンでは、Llama 3.2 3B (Q4) と Whisper を同居させると **スワップ発生 → 速度低下** の可能性があります。Lisna は STT と LLM を直列に切替えるため通常は問題ありませんが、長時間 (>30 分) のセッションで遅さを感じたら Discord に報告してください — Phase 5 のメモリ計装はそのデータをもとに調整します。

On M1 8GB, Llama 3.2 3B (Q4) + Whisper co-resident can trigger swap. Lisna serializes STT↔LLM so this is usually fine, but if sessions >30 min feel slow, report to Discord — Phase 5 memory instrumentation tunes from real data.

## 既知の制約 / Known limits (v2.0)

- 日本語のみ / JA-only (concept lock)
- ノートは保存されない (コピペが必要) / Notes do not persist — copy/paste them
- システム音声は macOS 14.4+ のみ / system audio capture requires macOS 14.4+
- 1 つのセッションのみアクティブ — 同時複数録音は不可 / one session at a time

## フィードバック歓迎 / Feedback welcome

特に知りたい点 / Especially:
- ノートの文体 (です/ます調の硬さ、見出しの分かりやすさ) / Note tone (desu/masu register, header clarity)
- 30 秒以下の短い録音での品質 / quality on short (<30s) recordings
- STT が無音をどう扱うか / how STT handles silence

Discord で気軽に共有してください。
