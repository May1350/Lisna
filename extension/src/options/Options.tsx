import { Fragment, useEffect, useState } from 'react'
import {
  getPlaybackSpeed, setPlaybackSpeed,
  getAutoDownload, setAutoDownload,
  getDisableDurationHours, setDisableDurationHours,
  getObsidianConfig, setObsidianConfig, type ObsidianConfig,
} from '../shared/storage'
import { testObsidianConnection } from '../side-panel/lib/export'
import { callApi } from '../side-panel/api-client'
import { ObsidianMark } from '../side-panel/components/ObsidianMark'
import type { User, QuotaSnapshot } from '../shared/types'
import { useT, interpolate, getLang, getNoteLang, setLang, setNoteLang, type LanguageCode, type NoteLanguageCode } from '../shared/i18n'
import type { Translations } from '../shared/i18n'

// Default URL for the Obsidian Local REST API plugin's HTTP endpoint.
// This is the same value for every user — 127.0.0.1 means "this
// computer", so each user's URL resolves to their OWN local Obsidian
// regardless of the literal string. Only users who've customised the
// port in the plugin settings need to change this; everyone else can
// (and should) leave it alone, hence the read-only-by-default UI.
const DEFAULT_OBSIDIAN_URL = 'http://127.0.0.1:27123'

// SPEED_OPTIONS now built per-render so the auto label tracks the
// active locale. Numeric labels are universal so they don't need
// translation.
function buildSpeedOptions(T: Translations): Array<{ value: 'auto' | number; label: string }> {
  return [
    { value: 'auto', label: T.speed.auto },
    { value: 1.5, label: '1.5×' },
    { value: 2.0, label: '2.0×' },
    { value: 2.5, label: '2.5×' },
    { value: 3.0, label: '3.0×' },
  ]
}

export function Options() {
  const T = useT()
  const SPEED_OPTIONS = buildSpeedOptions(T)
  const [speed, setSpeed] = useState<'auto' | number>('auto')
  const [autoDl, setAutoDl] = useState(false)
  const [disableHours, setDisableHours] = useState<number>(24)
  const [loggingOut, setLoggingOut] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [me, setMe] = useState<{ user: User; quota: QuotaSnapshot } | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [obsidian, setObsidian] = useState<ObsidianConfig>({ apiUrl: DEFAULT_OBSIDIAN_URL, apiKey: '', folder: '', autoSync: false })
  const [testStatus, setTestStatus] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })
  // Language picker state. Hydrated from i18n module (which itself is
  // already bootstrapped from chrome.storage at app start).
  const [systemLang, setSystemLangState] = useState<LanguageCode>(getLang())
  const [noteLang, setNoteLangState] = useState<NoteLanguageCode>(getNoteLang())

  // Keep the browser tab title in sync with the active locale. Without
  // this, switching language in the picker leaves the tab still showing
  // the previous language's title until the user reloads.
  useEffect(() => { document.title = T.options.pageTitle }, [T.options.pageTitle])

  const onChangeSystemLang = async (lang: LanguageCode) => {
    setSystemLangState(lang)
    await setLang(lang)  // notify subscribers → all open surfaces re-render
  }
  const onChangeNoteLang = async (lang: NoteLanguageCode) => {
    setNoteLangState(lang)
    await setNoteLang(lang)  // persisted; consumed at next curate call
  }
  // URL field is locked behind a confirmation by default — the value
  // is correct for >99% of users (everyone running the plugin with
  // default port). Users who've customised the port can unlock by
  // clicking the 編集 link and confirming.
  const [urlEditable, setUrlEditable] = useState(false)

  useEffect(() => {
    // Fetch current plan + quota for the plan section. Failure is
    // silent — the plan section just stays in its loading state
    // (showing a small spinner) which is acceptable for an Options
    // page section that's not on the critical path.
    void callApi<{ user: User; quota: QuotaSnapshot }>('/v1/auth/me', 'GET')
      .then(setMe)
      .catch(() => { /* ignore — surface only on real interaction */ })
    void getPlaybackSpeed().then(setSpeed)
    void getAutoDownload().then(setAutoDl)
    void getDisableDurationHours().then(setDisableHours)
    void getObsidianConfig().then(c => {
      // First-run hydration: persist the default URL so the API call
      // works the moment the user pastes their API key. Without this
      // the apiUrl would be '' and pushToObsidian would refuse.
      if (!c.apiUrl) {
        void setObsidianConfig({ apiUrl: DEFAULT_OBSIDIAN_URL })
        setObsidian({ ...c, apiUrl: DEFAULT_OBSIDIAN_URL })
      } else {
        setObsidian(c)
        // If the stored URL differs from the default, the user has
        // already customised it on a prior visit — show it editable
        // so they can see / further tweak without an extra click.
        if (c.apiUrl !== DEFAULT_OBSIDIAN_URL) setUrlEditable(true)
      }
    })
  }, [])

  const onUpgrade = async () => {
    setUpgrading(true)
    try {
      const r = await callApi<{ url: string }>('/v1/billing/checkout', 'POST', {})
      // Open Stripe Checkout in a NEW tab so the user can come back
      // to this page after paying. window.location.assign would
      // navigate away and lose the in-progress page state.
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      alert(T.options.plan_upgradeFailPrefix + (e instanceof Error ? e.message : 'unknown'))
    } finally {
      setUpgrading(false)
    }
  }

  const onUrlEditClick = () => {
    const ok = window.confirm(T.options.obsidian_url_confirmEdit)
    if (ok) setUrlEditable(true)
  }
  const onUrlReset = async () => {
    setUrlEditable(false)
    await onObsidianChange({ apiUrl: DEFAULT_OBSIDIAN_URL })
  }

  const onObsidianChange = async (patch: Partial<ObsidianConfig>) => {
    const next = { ...obsidian, ...patch }
    setObsidian(next)
    await setObsidianConfig(patch)
    // Any field change invalidates the previous test result.
    setTestStatus({ kind: 'idle' })
  }
  const onTestObsidian = async () => {
    setTestStatus({ kind: 'testing' })
    const r = await testObsidianConnection(obsidian)
    setTestStatus(r.ok ? { kind: 'ok' } : { kind: 'error', message: r.error })
  }

  const onSpeedChange = async (v: 'auto' | number) => {
    setSpeed(v)
    await setPlaybackSpeed(v)
  }
  const onAutoDlChange = async (v: boolean) => {
    setAutoDl(v)
    await setAutoDownload(v)
  }
  const onDisableHoursChange = async (h: number) => {
    setDisableHours(h)
    await setDisableDurationHours(h)
  }
  const onLogout = async () => {
    setLoggingOut(true)
    try {
      await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
      alert(T.options.logout_done)
    } finally {
      setLoggingOut(false)
    }
  }
  // Sign-out + clear Chrome's cached OAuth tokens. Used when the user
  // is on the wrong Google account (e.g. paid as A@... but Chrome is
  // signed in as B@...) — without the cache wipe the next login would
  // silently re-grab the same Google account.
  const onSwitchAccount = async () => {
    setSwitchingAccount(true)
    try {
      await chrome.runtime.sendMessage({ type: 'AUTH_SWITCH_ACCOUNT' })
      alert(T.options.switchAccount_done)
    } finally {
      setSwitchingAccount(false)
    }
  }

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">{T.options.pageTitle}</h1>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">{T.options.section_language}</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-gray-700 mb-1">{T.options.label_systemLanguage}</span>
            <select
              value={systemLang}
              onChange={(e) => void onChangeSystemLang(e.target.value as LanguageCode)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white"
            >
              <option value="ja">{T.languageNames.ja}</option>
              <option value="en">{T.languageNames.en}</option>
              <option value="ko">{T.languageNames.ko}</option>
              <option value="zh">{T.languageNames.zh}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-gray-700 mb-1">{T.options.label_noteLanguage}</span>
            <select
              value={noteLang}
              onChange={(e) => void onChangeNoteLang(e.target.value as NoteLanguageCode)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white"
            >
              <option value="auto">{T.options.noteLanguage_auto}</option>
              <option value="ja">{T.languageNames.ja}</option>
              <option value="en">{T.languageNames.en}</option>
              <option value="ko">{T.languageNames.ko}</option>
              <option value="zh">{T.languageNames.zh}</option>
            </select>
          </label>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">{T.options.section_speed}</h2>
        <p className="text-sm text-gray-600 mb-4">{T.options.speedHint}</p>
        {SPEED_OPTIONS.map(o => (
          <label key={String(o.value)} className="flex gap-2 items-center mb-2">
            <input
              type="radio"
              name="speed"
              checked={speed === o.value}
              onChange={() => onSpeedChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">{T.options.section_export}</h2>
        <p className="text-sm text-gray-600 mb-4">
          {T.options.exportHint}
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={autoDl}
            onChange={(e) => onAutoDlChange(e.target.checked)}
            className="mt-1"
          />
          <span>
            {T.options.autoDownloadLabel}
            <span className="block text-xs text-gray-500 mt-0.5">
              {T.options.autoDownloadHint}
            </span>
          </span>
        </label>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2">{T.options.section_disableTimer}</h2>
        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {T.options.disableTimer_hint}
        </p>
        <select
          value={disableHours}
          onChange={(e) => void onDisableHoursChange(Number(e.target.value))}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white"
        >
          {[1, 4, 12, 24, 72, 168].map(h => (
            <option key={h} value={h}>
              {interpolate(T.options.disableTimer_label_hours, { n: h })}
            </option>
          ))}
        </select>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-2 flex items-center gap-2">
          <ObsidianMark size={20} />
          <span>{T.options.section_obsidian}</span>
          <span className="text-xs font-normal text-gray-500">{T.common.beta}</span>
        </h2>
        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {T.options.obsidian_intro}
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-xs font-semibold text-blue-900 mb-1.5">{T.options.obsidian_setupHeader}</p>
          <ol className="text-xs text-blue-900 space-y-1 list-decimal list-inside leading-relaxed">
            <li>
              {T.options.obsidian_step1}
              <span className="block text-[10px] text-blue-700/70 mt-0.5">
                {T.options.obsidian_step1_safemode}
              </span>
            </li>
            <li>
              {T.options.obsidian_step2}
            </li>
            <li>
              {T.options.obsidian_step3}
            </li>
            <li>{T.options.obsidian_step4}</li>
          </ol>
          <p className="text-[10px] text-blue-700/70 mt-2 leading-relaxed">
            <a href="https://github.com/coddingtonbear/obsidian-local-rest-api" target="_blank" rel="noopener noreferrer" className="underline">
              {T.options.obsidian_docs}
            </a>
            {' '}{T.options.obsidian_docsNote}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{T.options.obsidian_label_apiUrl}</label>
            {urlEditable ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={obsidian.apiUrl}
                  onChange={(e) => void onObsidianChange({ apiUrl: e.target.value })}
                  placeholder={DEFAULT_OBSIDIAN_URL}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 font-mono"
                />
                <button
                  type="button"
                  onClick={onUrlReset}
                  className="text-xs text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
                  title={T.options.obsidian_url_resetTooltip}
                >
                  {T.options.obsidian_url_reset}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm">
                <code className="text-gray-700 font-mono">{obsidian.apiUrl || DEFAULT_OBSIDIAN_URL}</code>
                <button
                  type="button"
                  onClick={onUrlEditClick}
                  className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                >
                  {T.options.obsidian_url_edit}
                </button>
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-1">
              {T.options.obsidian_apiUrl_default_note}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{T.options.obsidian_label_apiKey}</label>
            <input
              type="password"
              value={obsidian.apiKey}
              onChange={(e) => void onObsidianChange({ apiKey: e.target.value })}
              placeholder={T.options.obsidian_apiKey_placeholder}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 font-mono"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {T.options.obsidian_label_folder} <span className="text-gray-400 font-normal">{T.options.obsidian_folder_optional}</span>
            </label>
            <input
              type="text"
              value={obsidian.folder}
              onChange={(e) => void onObsidianChange({ folder: e.target.value })}
              placeholder={T.options.obsidian_folder_placeholder}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
            />
            <p
              className="text-[11px] text-gray-500 mt-1"
              dangerouslySetInnerHTML={{
                // The path-preview template embeds an inline <u> tag.
                // We feed the locale-specific template directly to the
                // DOM via dangerouslySetInnerHTML so each language can
                // place the <u>講義名</u> token wherever the sentence
                // structure demands. The substitution data is the
                // user-controlled folder string, escaped before
                // splicing — no XSS surface.
                __html: interpolate(T.options.obsidian_folder_pathPreview, {
                  path: obsidian.folder
                    ? `<code>${escapeHtml(obsidian.folder.replace(/\/+$/, ''))}/</code>`
                    : '<code></code>',
                }),
              }}
            />

            <details className="mt-2 group">
              <summary className="cursor-pointer text-[11px] text-blue-600 hover:text-blue-800 select-none list-none flex items-center gap-1 w-fit">
                <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                {T.options.obsidian_folder_helpHeader}
              </summary>
              <div className="mt-2 pl-4 pr-2 py-2.5 text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded leading-relaxed space-y-2">
                <p>
                  <strong>1.</strong> {T.options.obsidian_folder_help_step1}
                  <span className="block text-gray-500 mt-0.5">
                    {T.options.obsidian_folder_help_step1_note}
                  </span>
                </p>
                <p>
                  <strong>2.</strong> {T.options.obsidian_folder_help_step2}
                </p>
                <p>
                  <strong>3.</strong> {T.options.obsidian_folder_help_step3}
                </p>
                <p className="pt-1 border-t border-gray-200 text-amber-800">
                  ⚠️ {T.options.obsidian_folder_help_warning}
                </p>
              </div>
            </details>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onTestObsidian}
                disabled={!obsidian.apiUrl || !obsidian.apiKey || testStatus.kind === 'testing'}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                {testStatus.kind === 'testing' ? T.options.obsidian_test_busy : T.options.obsidian_test}
              </button>
              {testStatus.kind === 'ok' && (
                <span className="text-xs text-emerald-700 font-medium">{T.options.obsidian_test_ok}</span>
              )}
              {testStatus.kind === 'error' && (
                <span className="text-xs text-red-700 font-medium">{T.options.obsidian_test_fail}</span>
              )}
            </div>
            {testStatus.kind === 'error' && testStatus.message && (
              <div className="mt-2 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded whitespace-pre-line leading-relaxed">
                {testStatus.message}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 pt-2">
            <input
              type="checkbox"
              checked={obsidian.autoSync}
              onChange={(e) => void onObsidianChange({ autoSync: e.target.checked })}
              className="mt-0.5"
              disabled={!obsidian.apiUrl || !obsidian.apiKey}
            />
            <span className="text-sm">
              {T.options.obsidian_autoSync}
              <span className="block text-xs text-gray-500 mt-0.5">
                {/* Inline brand mark — splits the locale string on the
                    {icon} placeholder so each language can position the
                    Obsidian gem wherever the sentence structure
                    demands. The placeholder pattern mirrors the
                    {path} substitution in obsidian_folder_pathPreview. */}
                {T.options.obsidian_autoSync_hint.split('{icon}').map((part, i, arr) => (
                  <Fragment key={i}>
                    {part}
                    {i < arr.length - 1 && <ObsidianMark size={12} />}
                  </Fragment>
                ))}
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">{T.options.section_plan}</h2>
        {!me ? (
          <p className="text-sm text-gray-500">
            <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin align-[-2px] mr-1.5" />
            {T.options.plan_loading}
          </p>
        ) : !me.quota ? (
          // Defense-in-depth: an older backend deploy (or a transient
          // partial response) may return `{ user }` without the `quota`
          // field. Without this guard PlanSection accesses
          // `quota.used_secs` on undefined → React unmounts → blank
          // page. Fall back to plan-only rendering so the rest of the
          // Options surface stays usable.
          <p className="text-sm text-gray-500">{T.options.plan_loading}</p>
        ) : (
          <PlanSection
            plan={me.user.plan}
            quota={me.quota}
            onUpgrade={onUpgrade}
            upgrading={upgrading}
            T={T}
          />
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">{T.options.section_account}</h2>

        {/* Identity card — shows the email + name of whichever Google
         *  account is currently signed in. Critical surface: Pro users
         *  whose Chrome is signed into a different Google account would
         *  otherwise silently see Free-plan limits without realising
         *  they're on the wrong account. Putting the email front and
         *  centre makes the mismatch impossible to miss. */}
        {me?.user && (
          <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3">
            <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              {T.options.account_currentLabel}
            </div>
            <div className="text-sm font-semibold text-gray-900 break-all">
              {me.user.email}
            </div>
            {me.user.name && (
              <div className="text-xs text-gray-600 mt-0.5">{me.user.name}</div>
            )}
          </div>
        )}

        <p className="text-xs text-gray-600 mb-3 leading-relaxed">
          {T.options.account_emailHint}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSwitchAccount}
            disabled={switchingAccount || loggingOut}
            className="px-4 py-2 text-sm rounded border border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            {switchingAccount ? T.options.switchAccount_busy : T.options.switchAccount}
          </button>
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut || switchingAccount}
            className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {loggingOut ? T.options.logout_busy : T.options.logout}
          </button>
        </div>
      </section>
    </div>
  )
}

// Minimal HTML-escape for path strings spliced into the
// pathPreview template. The folder field is user-controlled text
// from chrome.storage; we inject it via dangerouslySetInnerHTML so
// each locale can position the <u>...</u> tag freely. This stays
// on the safe side of XSS by escaping every input character that
// has special meaning in HTML.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Plan / quota section — shown inside the Options page (a "pull"
// surface: user came here actively). Deliberately calm, not pushy:
// no auto-popup, no aggressive comparison ad copy. The aggressive
// upgrade CTA still lives in QuotaBanner at 90%+ which catches the
// users for whom the upgrade decision is now-or-never.
function PlanSection({
  plan, quota, onUpgrade, upgrading, T,
}: {
  plan: 'free' | 'pro'
  quota: QuotaSnapshot
  onUpgrade: () => void
  upgrading: boolean
  T: Translations
}) {
  const usedMin = Math.floor(quota.used_secs / 60)
  const limitMin = Math.floor(quota.limit_secs / 60)
  const usedHr = Math.floor(quota.used_secs / 3600)
  const limitHr = Math.floor(quota.limit_secs / 3600)
  const isPro = plan === 'pro'

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-sm text-gray-700">{T.options.plan_currentLabel}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isPro ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
          }`}>
            {isPro ? 'Pro' : 'Free'}
          </span>
        </div>
        <div className="text-xs text-gray-600 mb-2">
          {T.options.plan_usageThisMonth}{' '}
          <span className="font-mono tabular-nums text-gray-900">
            {isPro
              ? interpolate(T.options.plan_usage_pro, { used: usedHr, limit: limitHr })
              : interpolate(T.options.plan_usage_free, { used: usedMin, limit: limitMin })}
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              quota.percent_used >= 95 ? 'bg-red-500'
                : quota.percent_used >= 80 ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, quota.percent_used)}%` }}
          />
        </div>
        <div className="text-[11px] text-gray-500 mt-1">
          {T.options.plan_resetMonthly}
        </div>
      </div>

      {!isPro && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm font-semibold text-indigo-900">{T.options.plan_pro_header}</span>
          </div>
          <ul className="text-xs text-gray-700 space-y-1.5 mb-4">
            <li>{T.options.plan_pro_feature1}</li>
            <li>{T.options.plan_pro_feature2}</li>
            <li>{T.options.plan_pro_feature3}</li>
          </ul>
          <button
            type="button"
            onClick={onUpgrade}
            disabled={upgrading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition"
          >
            {upgrading ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {T.options.plan_upgrade_busy}
              </>
            ) : (
              T.options.plan_upgradeButton
            )}
          </button>
        </div>
      )}
    </div>
  )
}
