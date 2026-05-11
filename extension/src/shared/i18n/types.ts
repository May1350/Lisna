// Translation type contract — every locale (ja / en / ko / zh) must
// implement this shape exactly. TypeScript enforces completeness, so
// adding a new key in any locale immediately surfaces "missing key"
// errors in all other locales until they're filled in.
//
// Categories are grouped by the UI surface where they appear, not by
// individual component, so a string used in two places (e.g. "ノート
// 生成中…" in both the manual button and the curating spinner) gets
// a single canonical key and stays in sync automatically.

export type LanguageCode = 'ja' | 'en' | 'ko' | 'zh'

// `auto` = use the lecture's audio language (curator infers from the
// transcript). Distinct from any specific locale code.
export type NoteLanguageCode = 'auto' | LanguageCode

export interface Translations {
  // ── Common / shared atoms ──────────────────────────────────────
  common: {
    cancel: string
    confirm: string
    save: string
    close: string
    edit: string
    delete: string
    loading: string
    retry: string
    optional: string
    beta: string
    minutes: string         // "分" / "min" / "분" / "分钟"
    hours: string           // "時間" / "hr" / "시간" / "小时"
    seconds: string         // "秒"
    remaining: string       // "残り" / "Remaining" / "남음" / "剩余"
  }

  // ── Inline button tooltip / labels ─────────────────────────────
  inlineButton: {
    activate: string                     // "この動画を要約"
    onboarding: string                   // "ここをクリックで録音開始 →"
    processing: string                   // "クリックで再表示 (録音中)" — sparkle + recording badge
    disable_tooltip: string              // hover title on the × badge — generic, no {hours} (we can't read it sync at mount)
    disable_aria: string                 // aria-label for screen readers
    disabled_toast: string               // confirmation toast body ("Lisna は {hours} 時間オフになりました")
    disabled_undo: string                // undo link inside the toast ("元に戻す")
  }

  // ── Modal capture states (IdleSessionState) ────────────────────
  capture: {
    pausedTitle: string                  // "動画は一時停止中です"
    pausedHint: string                   // "再生して講義が進むと..."
    recordingTitle: string                // "録音中"
    recordingHint: string                 // "下に字幕が流れます。一時停止すると..."
    waiting: string                       // "講義の再生を待っています…"
  }

  // ── Curate state (CuratingState + button) ──────────────────────
  curate: {
    spinnerTitle: string                 // "ノート生成中…"
    spinnerHint: string                  // "これまでの講義内容を AI が..."
    timeHint: string                     // "通常 20〜60 秒ほどかかります"
    button_generate: string              // "📝 ノートを生成"
    button_regenerate: string            // "📝 ノートを再生成"
    button_busy: string                  // "ノート生成中…"
    button_title: string                 // "現時点までの内容でノートを生成 / 再生成"
    endButton_title: string              // "セッションを終了します（次の動画で再度開始）"
  }

  // ── EditableFilename ──────────────────────────────────────────
  filename: {
    fallback: string                     // "講義ノート"
  }

  // ── Post-session hint banner ───────────────────────────────────
  postSession: {
    title: string                        // "✓ 録音は終了しました"
    hint: string                         // "ノートを更新したい場合は「📝...」を、保存する場合は..."
  }

  // ── Session controls (pause/resume/end + confirm) ──────────────
  controls: {
    pause: string                        // "⏸ 一時停止"
    resume: string                       // "▶ 再生を続ける"
    end: string                          // "✕ 終了"
    confirm: {
      title: string                      // "セッションを終了しますか?"
      body: string                       // "ここまでの内容で..."
      cancel: string                     // "キャンセル"
      confirm: string                    // "終了する"
    }
  }

  // ── Export menu ─────────────────────────────────────────────────
  export: {
    busy: string                         // "処理中…"
    fileName: string                     // "📝 ファイル名"
    fileNameTooltip: string              // "クリックしてファイル名を編集"
    zip: { primary: string; menu: string; subtitle_withSlides: string; subtitle_noSlides: string }
    html: { primary: string; menu: string; subtitle_withSlides: string; subtitle_noSlides: string }
    obsidian: { primary: string; menu: string; subtitle: string }
    success_zip: string                  // "✓ {n} 枚のスライドと共に保存"
    success_html: string                 // "✓ ダウンロードしました"
    success_obsidian: string             // "✓ Obsidian に送信 ({n} ファイル)"
    failPrefix: string                   // "✕ 失敗: "
    failObsidian: string                 // "✕ {error}"
    obsidianFallback: string             // "Obsidian 送信失敗"
    formatPickerAria: string             // "エクスポート形式を選択"
    pdfButton: string                    // "📄 PDFで保存" (embedded in exported HTML)
    pdfButtonAria: string                // "PDF として保存"
  }

  // ── Quota banner stages ─────────────────────────────────────────
  quota: {
    plan_free: string                    // "Free プラン"
    plan_pro: string                     // "Pro プラン"
    remainingTooltip: string             // "今月の残り時間 (リアルタイム)"
    upgradeButton: string                // "Pro にアップグレード"
    // Banner headlines (no emojis, single short phrase — usage
    // numbers live in the bar caption underneath, not the headline)
    blocked_label: string                // "月間使用量の上限に達しました"
    warn_label: string                   // "月間使用量の上限に近づいています"
    reset_note: string                   // "翌月 1 日に自動リセット"
  }

  // ── Quota-exhausted modal surfaces (no emojis, plain text) ─────────
  // Used by QuotaExhaustedIdle (replaces IdleSessionState when there's
  // no saved data) and by SessionControls' inactive-gray-button mode
  // (replaces the pause / end controls when there IS saved data).
  // Two-tier copy: free user gets the upgrade CTA, Pro user gets the
  // "wait until reset" message with no upgrade button.
  quotaExhausted: {
    free_title: string                   // "月間 30 分制限に達しました"
    free_body: string                    // multiline; \n preserved via whitespace-pre-line
    upgrade_cta: string                  // "Pro にアップグレード ¥980/月"
    upgrade_busy: string                 // "準備中…"
    pro_title: string                    // "月間 30 時間制限に達しました"
    pro_body: string                     // explains automatic monthly reset
    // Inline gray button copy (in SessionControls slot)
    inline_main: string                  // "自動字幕生成は停止中"
    inline_sub_free: string              // "月間制限に達しました — Pro で継続 →"
    inline_sub_pro: string               // "翌月に自動でリセットされます"
    // ── 2-hour trial flow ──────────────────────────────────────
    trial_offer_title: string            // "2 時間無料で続けますか?"
    trial_offer_body: string             // multiline explanation of the trial
    trial_offer_cta: string              // "2時間無料 受け取る (カードのみ登録)"
    trial_offer_cta_busy: string         // "Stripe へリダイレクト中…"
    trial_offer_safety: string           // "今すぐ請求はありません · いつでも解約可"
    // Trial active state — header badge
    trial_badge_label: string            // "Trial"
    // Trial near-end inline banner (90 % used)
    trial_nudge_title: string            // "残り 12 分"
    trial_nudge_body: string             // "Pro 加入で途切れず続けられます"
    trial_nudge_cta: string              // "Pro に加入"
    // Trial 100% — end-of-trial decision modal
    trial_end_title: string              // "2 時間が終了しました"
    trial_end_body: string               // multiline summary + decision request
    trial_end_subscribe: string          // "Pro 加入 ¥980/月 (ワンクリック)"
    trial_end_subscribe_busy: string     // "加入処理中…"
    trial_end_decline: string            // "加入しない"
    trial_end_decline_busy: string       // "登録カードを削除中…"
    trial_end_subscribe_failed: string   // "加入処理に失敗しました — 通常ページから再試行してください"
  }

  // ── Panel header ───────────────────────────────────────────────
  panelHeader: {
    notLoggedIn: string                  // "未ログイン"
    settingsTitle: string                // "設定"
    settingsAria: string                 // "設定を開く"
    openSidePanelTitle: string           // "サイドパネルを開く" — shortcut to Chrome side panel from modal header (embed-only)
    openSidePanelAria: string            // "サイドパネルを開く"
    closeTitle: string                   // "閉じる"
    closeAria: string                    // "閉じる"
    logoutTooltip: string                // "ログアウト"
    planLogoutCombo: string              // "{plan} · ログアウト"
    toggleAria: string                   // "拡張機能の有効/無効"
    toggleOnTitle: string                // "OFF にする"
    toggleOffTitle: string               // "ON にする"
    on: string                           // "ON"
    off: string                          // "OFF"
    remainingPrefix: string              // "残り"
  }

  // ── Live transcript ────────────────────────────────────────────
  liveTranscript: {
    header: string                       // "ライブ字幕"
    statusRecording: string              // "● 録音中"
    statusPaused: string                 // "⏸ 停止中"
    statusRecordingShort: string         // "録音中" (no leading dot, used in pill)
    statusPausedShort: string            // "⏸ 停止中"
    placeholder_paused: string           // "動画は一時停止中です。再生すると字幕が流れます。"
    placeholder_waiting: string          // "音声を待っています…"
    placeholder_processing: string       // "音声を処理しています…"
    placeholder_idle: string             // "講義の再生を待っています…"
    collapseAria: string                 // chevron aria when expanded
    expandAria: string                   // chevron aria when collapsed
    collapseTitle: string                // tooltip when expanded
    expandTitle: string                  // tooltip when collapsed
  }

  // ── Outline view (curator output labels) ──────────────────────
  outline: {
    important_heading: string            // "重要事項 ⭐"
    summary_label: string                // "要旨"
    terms_label: string                  // "用語"
    points_label: string                 // "ポイント"
    examples_inline: string              // "例" (used as "例: ...")
    related_label: string                // "関連"
    checklist_heading: string            // "学習チェックリスト"
    related_lectures: string             // "関連リンク"
    refreshIndicator: string             // "{relativeTime}に更新"
    refreshTooltip: string               // "ノートはバックグラウンドで..."
    confirm_label: string                // "確認" (callout in lecture)
    info_label: string                   // "講義情報"
    emptyHint: string                    // "処理中... 講義を再生してください。"
    refresh_just: string                 // "更新したて"
    refresh_secAgo: string               // "{n}秒前に更新"
    refresh_minAgo: string               // "{n}分前に更新"
    refresh_hrAgo: string                // "{n}時間前に更新"
    relatedTermsTitle: string            // "関連用語"
    tsBackTitle: string                  // "この時点に戻る"
    slideThumbTitle: string              // "スライド {ts} — クリックで拡大"
    lightboxAria: string                 // "スライドビューア ({i} / {n} ・ {ts})"
    lightboxPrev: string                 // "← 前"
    lightboxNext: string                 // "次 →"
    lightboxPrevAria: string             // "前のスライド"
    lightboxNextAria: string             // "次のスライド"
    lightboxJump: string                 // "▶ 動画のこの場面へ"
    lightboxClose: string                // "閉じる"
    // ── DESIGN.md §7 follow-up features ─────────────────────
    metaSectionsOne: string              // "section" (singular) — meta-row counter label
    metaSectionsMany: string             // "sections" (plural)
    metaHighlights: string               // "highlights" — count of important points
    compactToggle: string                // "Compact" — exam-cram view button label
    compactToggleTitle: string           // tooltip when not active
    quizLabel: string                    // "Review Questions" — quiz roll-up header
    quizCountSingular: string            // "question"
    quizCountPlural: string              // "questions"
    quizJumpTitle: string                // tooltip on the → NN link
    expandSectionAria: string            // "section-collapse aria-label expand"
    collapseSectionAria: string          // "section-collapse aria-label collapse"
    expandSectionTitle: string           // "click to expand"
    collapseSectionTitle: string         // "click to collapse"
  }

  // ── Speed selector ─────────────────────────────────────────────
  speed: {
    auto: string                         // "プレイヤー最高速 (推奨)"
    selectorTitle: string                // "再生速度"
  }

  // ── Login screen ───────────────────────────────────────────────
  login: {
    title: string                        // "Lisna"
    tagline: string                      // "講義動画をリアルタイムで\n要約・整理します"
    button: string                       // "Google でログイン"
    busy: string                         // "サインイン中…"
    failPrefix: string                   // "ログインに失敗しました: "
    privacyNote: string                  // "メールアドレスのみ取得します。\nパスワードを保存することはありません。"
  }

  // ── Consent modal ──────────────────────────────────────────────
  consent: {
    title: string                        // "重要なお知らせ"
    body: string                         // long copyright disclosure
    bullet_terms_institution: string     // "所属機関の利用規約および学則"
    bullet_terms_content: string         // "視聴対象コンテンツの利用規約"
    bullet_terms_law: string              // "著作権法その他関連法令"
    disclaimer: string                   // "本ツールの使用により…責任を負いません。"
    agree: string                         // "上記に同意します"
    personalUse: string                  // "個人の学習目的のみに使用します"
    accept: string                        // "同意して始める"
  }

  // ── Side panel — non-embed account view ────────────────────────
  sidePanel: {
    inlineHint: string                   // "動画ページで ✨ アイコン を..."
    historyHeader: string                // "履歴 ({n})"
    historyEmpty_title: string           // bold heading for empty state
    historyEmpty_body: string            // softer body line below the heading
    historyLoading: string               // "履歴を読み込み中…"
    historyFetchFailed: string           // "履歴の取得に失敗しました: "
    historyFetchFailedAgain: string      // copy after 3 consecutive failures
    historyTitle_untitled: string        // "(無題のノート)"
    historyMeta_withOutline: string      // "📝 ノート ✓"
    historyMeta_recordOnly: string       // "録音のみ"
    historyMeta_slidesOnly: string       // "📷 {n} 枚"
    historyMeta_outline_withSlides: string // "📝 ノート ✓  📷 {n}"
    relativeDate: { now: string; minAgo: string; hrAgo: string; dayAgo: string }
    inlineHintIcon: string               // "✨ アイコン"
    // Search / filter
    searchPlaceholder: string            // input placeholder when ≥8 sessions
    searchEmpty: string                  // "No lectures match {q}"
    searchClear: string                  // "Clear"
    // Time grouping headers (visible when ≥5 sessions and no search)
    timeGroup_today: string
    timeGroup_yesterday: string
    timeGroup_thisWeek: string
    timeGroup_thisMonth: string
    timeGroup_earlier: string
    // Per-row delete (inline confirm)
    deleteAria: string                   // aria-label for trash icon
    deleteConfirmBody: string            // body text in inline confirm strip
    deleteConfirm: string                // destructive confirm button label
    deleteFailed: string                 // toast/inline message on delete API failure
    // Per-row "open source video" icon button (sibling of trash icon)
    openSourceAria: string               // aria-label / title for the external-link icon
    // NotesViewer (history row click → renders the saved outline in side panel)
    notesViewer_back: string             // back button label
    notesViewer_loading: string          // skeleton/loading copy
    notesViewer_notFound: string         // session row exists in history but /v1/session?url= returned null
    notesViewer_noOutline: string        // session exists but outline is null (recording only)
    notesViewer_loadFailed: string       // API call failed
    notesViewer_openSource: string       // header button — open source URL at the timestamp
  }

  // ── Options page ───────────────────────────────────────────────
  options: {
    pageTitle: string                    // "Lisna 設定"
    section_language: string             // "言語"
    label_systemLanguage: string         // "システム言語"
    label_noteLanguage: string           // "ノート生成言語"
    noteLanguage_auto: string            // "講義の言語に従う (自動)"
    section_speed: string                // "再生速度"
    speedHint: string                    // "要約モード起動時に自動で適用される速度です。"
    section_export: string               // "エクスポート"
    exportHint: string                   // "講義が終わったら、ノートとスライドを..."
    autoDownloadLabel: string            // "講義終了時に自動で .zip をダウンロードする"
    autoDownloadHint: string             // "手動で「⬇ .zip」ボタンを..."
    section_disableTimer: string         // "一時オフ時間 / 잠시 끄기 시간"
    disableTimer_hint: string            // explanation of × badge auto-resume timer
    disableTimer_label_hours: string     // "{n} 時間 / {n} 시간 / etc" — interpolated
    section_obsidian: string             // "Obsidian 連携"
    obsidian_intro: string
    obsidian_setupHeader: string         // "セットアップ手順"
    obsidian_step1: string
    obsidian_step1_safemode: string      // "(セーフモードがオンの場合は先に解除)"
    obsidian_step2: string
    obsidian_step3: string
    obsidian_step4: string
    obsidian_docs: string                // "プラグインのドキュメント (GitHub)"
    obsidian_docsNote: string            // "— インストールは Obsidian 内の..."
    obsidian_label_apiUrl: string
    obsidian_apiUrl_default_note: string // "ほとんどのユーザーはデフォルトのままで OK..."
    obsidian_url_edit: string            // "編集"
    obsidian_url_reset: string           // "デフォルトに戻す" (also used as tooltip via title=)
    obsidian_url_confirmEdit: string     // "API URL は通常変更不要です..."
    obsidian_label_apiKey: string
    obsidian_apiKey_placeholder: string
    obsidian_label_folder: string
    obsidian_folder_optional: string     // "(空欄で vault ルート)"
    obsidian_folder_placeholder: string
    obsidian_folder_pathPreview: string  // "講義ごとに <folder>/<lecture>/ フォルダが..."
    obsidian_folder_helpHeader: string   // "フォルダのパスを Obsidian から取得する方法"
    obsidian_folder_help_step1: string
    obsidian_folder_help_step1_note: string
    obsidian_folder_help_step2: string
    obsidian_folder_help_step3: string
    obsidian_folder_help_warning: string
    obsidian_test: string                // "接続テスト"
    obsidian_test_busy: string           // "テスト中…"
    obsidian_test_ok: string             // "✓ 接続成功"
    obsidian_test_fail: string           // "✗ 接続失敗"
    obsidian_test_apiUrl_empty: string
    obsidian_test_apiKey_empty: string
    obsidian_test_unauth: string
    obsidian_test_404: string
    obsidian_test_network: string
    obsidian_autoSync: string            // "ノート生成のたびに Obsidian へ自動送信"
    obsidian_autoSync_hint: string       // "オフでも..."
    obsidian_unconfigured: string        // "Obsidian の設定が未完了です"
    obsidian_slidesSendFail: string      // "{n} 枚のスライド送信に失敗" — push error msg
    obsidian_markdownPutFail: string     // "markdown PUT {status}"
    section_plan: string                 // "プラン"
    plan_loading: string                 // "プラン情報を取得中…"
    plan_currentLabel: string            // "現在のプラン"
    plan_usageThisMonth: string          // "今月の使用量"
    plan_resetMonthly: string            // "毎月 1 日にリセット"
    plan_pro_header: string              // "Pro プランで広く長く使う"
    plan_pro_price: string               // "¥980 / 月" (price stays JPY for all locales — pricing is JPY in Stripe)
    plan_pro_priceNote: string           // tiny note under the price ("月額 / billed monthly / 월 결제 / 按月计费")
    plan_pro_feature1: string
    plan_pro_feature2: string
    plan_pro_feature3: string
    plan_usage_pro: string               // "{used} / {limit} 時間"
    plan_usage_free: string              // "{used} / {limit} 分"
    plan_upgradeButton: string           // "Pro にアップグレード →"
    plan_upgrade_busy: string            // "準備中…"
    plan_upgradeFailPrefix: string
    section_account: string              // "アカウント"
    account_currentLabel: string         // "ログイン中のアカウント"
    account_emailHint: string            // "Pro にアップグレードしたアカウントと違う場合は…"
    logout: string                       // "ログアウト"
    logout_busy: string                  // "ログアウト中…"
    logout_done: string                  // "ログアウトしました。"
    switchAccount: string                // "別の Google アカウントでログイン"
    switchAccount_busy: string           // "切り替え中…"
    switchAccount_done: string           // "ログアウトしました。サイドパネルから別のアカウントで…"
    // ── Feedback section (Options page) ─────────────────────────
    section_feedback: string              // "フィードバック"
    feedback_intro: string                // help text under the section header
    feedback_categoryLabel: string        // "種類"
    feedback_category_bug: string
    feedback_category_feature: string
    feedback_category_other: string
    feedback_messageLabel: string         // "ご意見・ご要望"
    feedback_messagePlaceholder: string
    feedback_charCount: string            // "{n} / 2000"
    feedback_submit: string
    feedback_submit_busy: string
    feedback_thanks: string               // "送信ありがとうございました。"
    feedback_failPrefix: string           // "送信に失敗しました: "
    feedback_emptyError: string           // "メッセージを入力してください。"
  }

  // ── Curate failure reason map (humanised in the modal) ─────────
  curateError: {
    no_transcripts_yet: string
    timeout_no_signal: string
    request_failed: string
    curator_failed: string
    no_outline_returned: string
    curate_cooldown: string
    curate_in_progress: string           // backend lock held by concurrent curate
    // Backend classified the failure as an upstream LLM provider issue
    // (Anthropic / OpenAI / Groq auth, quota, or sustained rate limit).
    // Operator already received an SNS notification — copy here is a
    // user-side reassurance, not a request for the user to take action.
    service_unavailable: string
    fallback: string                     // unknown reason fallback
    // CTA on error banners that aren't user-resolvable. Only shown for
    // a small whitelist of reasons (see ERROR_REPORTABLE in App.tsx).
    reportButton: string                 // "💡 報告する" / "💡 Report"
  }

  // ── ErrorToast translation map (regex match on backend message → friendly copy) ──
  errorToast: {
    unauthorized: string                  // HTTP 401 / unauthorized / invalid token
    forbidden: string                     // HTTP 403
    rateLimit: string                     // HTTP 429 / rate limit
    server: string                        // HTTP 5xx
    quotaExceeded: string                 // quota / limit reached / exceeded
    audioCapture: string                  // no audio / getUserMedia / mic permission
    permission: string                    // permission denied / NotAllowed
    network: string                       // network / fetch / failed to fetch
    oauthCancelled: string                // sign-in cancelled / oauth cancel
    timeout: string                       // aborted / timeout
  }

  // ── Error boundary ─────────────────────────────────────────────
  errorBoundary: {
    title: string
    body: string
    detailsLabel: string
    reload: string
    ignore: string
  }

  // ── Language picker (used inside Options) ─────────────────────
  languageNames: {
    ja: string  // "日本語"
    en: string  // "English"
    ko: string  // "한국어"
    zh: string  // "中文"
    auto: string // "自動 (講義の言語)"
  }
}
