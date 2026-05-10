// Shared canned data used by multiple fixtures.
//
// Keep these realistic — the gallery is also our visual regression
// reference, so e.g. an outline used to demo OutlineView should look
// like a *plausible* lecture, not "section 1 / section 2 / lorem".

import type { Outline, OutlineSection, LiveTranscriptItem } from '../../side-panel/api-client'
import type { SlideItem, User, QuotaSnapshot } from '../../shared/types'

export const FREE_USER: User = {
  id: 'usr_dev_free',
  email: 'student@example.com',
  name: 'Yuki Tanaka',
  plan: 'free',
}

export const PRO_USER: User = {
  id: 'usr_dev_pro',
  email: 'pro@example.com',
  name: 'Pro Sample',
  plan: 'pro',
}

const HOUR = 3600
export const QUOTA_FREE_OK: QuotaSnapshot = {
  used_secs: HOUR * 0.8,
  limit_secs: HOUR * 5,
  remaining_secs: HOUR * 5 - HOUR * 0.8,
  percent_used: (HOUR * 0.8) / (HOUR * 5) * 100,
  plan: 'free',
}
export const QUOTA_FREE_80: QuotaSnapshot = {
  used_secs: HOUR * 4.1,
  limit_secs: HOUR * 5,
  remaining_secs: HOUR * 5 - HOUR * 4.1,
  percent_used: (HOUR * 4.1) / (HOUR * 5) * 100,
  plan: 'free',
}
export const QUOTA_FREE_95: QuotaSnapshot = {
  used_secs: HOUR * 4.78,
  limit_secs: HOUR * 5,
  remaining_secs: HOUR * 5 - HOUR * 4.78,
  percent_used: (HOUR * 4.78) / (HOUR * 5) * 100,
  plan: 'free',
}
export const QUOTA_FREE_100: QuotaSnapshot = {
  used_secs: HOUR * 5,
  limit_secs: HOUR * 5,
  remaining_secs: 0,
  percent_used: 100,
  plan: 'free',
}
export const QUOTA_PRO_OK: QuotaSnapshot = {
  used_secs: HOUR * 12,
  limit_secs: HOUR * 30,
  remaining_secs: HOUR * 18,
  percent_used: 40,
  plan: 'pro',
}
export const QUOTA_PRO_100: QuotaSnapshot = {
  used_secs: HOUR * 30,
  limit_secs: HOUR * 30,
  remaining_secs: 0,
  percent_used: 100,
  plan: 'pro',
}

export const TRANSCRIPT_EMPTY: LiveTranscriptItem[] = []

export const TRANSCRIPT_SHORT: LiveTranscriptItem[] = [
  { ts: 12, text: 'では、今日はベイズの定理について話していきます。' },
  { ts: 30, text: '事前確率と尤度をかけて、それを正規化したものが事後確率です。' },
  { ts: 58, text: '具体例として、医療検査の偽陽性問題を見てみましょう。' },
]

export const TRANSCRIPT_LONG: LiveTranscriptItem[] = Array.from({ length: 24 }, (_, i) => ({
  ts: 30 + i * 18,
  text: [
    'ベイズの定理の応用について続けます。',
    'まず事前確率を P(A) と書きます。これは検査前の信念です。',
    '尤度 P(B|A) は、もし仮説が真なら証拠が観測される確率。',
    'ベイズの定理: P(A|B) = P(B|A) * P(A) / P(B)',
    '医療検査の例を考えます。病気の有病率は 1% としましょう。',
    '検査の感度は 99%、特異度も 99% と仮定します。',
    'では陽性が出た人が実際に病気である確率は?',
    '直感的には 99% に思えるかもしれませんが、計算すると約 50% です。',
    'これは事前確率(有病率)が低いと、偽陽性が多数を占めるためです。',
    'スパムフィルタも同じ原理で動作しています。',
    '単語の出現確率を観測して、メールのクラス事後確率を更新します。',
    'ナイーブベイズは独立性仮定を置くので計算が単純化されます。',
    '実際にはこの仮定は厳密には成立しませんが、それでも実用的には機能します。',
    '次回は MAP 推定と最尤推定の違いを扱います。',
    'MAP は事前分布を考慮し、ML は尤度のみを最大化します。',
    'データが少ないときは MAP のほうが安定します。',
    'では今日のクイズです。100人中3人がある病気を持っています。',
    '感度 90%, 特異度 95% の検査で陽性のとき、病気である確率は?',
    'ヒント: 偽陽性率と真陽性数を比較してください。',
    '答えは次のスライドにあります。',
    '計算結果は約 35.7% でした。意外に低い数字に感じるかもしれません。',
    '事前確率が低い病気では、検査の精度がよほど高くないと確定できません。',
    '次回までに教科書 4.3 節を読んできてください。',
    '質問は授業後かフォーラムで受け付けます。',
  ][i],
}))

const baseSection = (
  ts: number,
  heading: string,
  summary: string,
  withImportant = false,
  withQuiz = false
): OutlineSection => ({
  ts,
  heading,
  summary,
  key_terms: [
    { term: '事前確率', definition: 'データを観測する前の信念の度合い', ts: ts + 5 },
    { term: '事後確率', definition: 'データを観測した後の更新された信念', ts: ts + 12 },
  ],
  examples: [
    { text: '医療検査で陽性が出ても、病気である確率は意外と低いことがある', ts: ts + 18 },
  ],
  points: [
    { text: 'ベイズの定理は条件付き確率を逆向きに扱う', ts: ts + 25, important: false },
    { text: '事前確率の選び方が結果に大きく影響する', ts: ts + 40, important: withImportant },
    { text: '対数尤度を使うと数値的に安定する', ts: ts + 55, important: false },
  ],
  takeaway: '小さな事前確率は強い証拠でしか覆らない。',
  ...(withQuiz ? { check_question: '感度99%・特異度99%の検査で陽性。有病率1%なら病気の確率は?' } : {}),
})

export const OUTLINE_SHORT_2: Outline = {
  title: 'ベイズの定理 入門',
  course: '統計学基礎',
  lecturer: '田中先生',
  tldr: '事前確率と尤度から事後確率を計算する考え方を学ぶ。',
  sections: [
    baseSection(0, '導入: なぜベイズか', '頻度論的アプローチとの違いを概観する。'),
    baseSection(420, '基本公式とその直感', '式の各項が何を表すかを丁寧に確認する。', true, true),
  ],
}

export const OUTLINE_LONG_8: Outline = {
  title: 'ベイズ統計フルセッション',
  course: '統計学応用',
  lecturer: '田中先生',
  tldr: '基礎から MAP 推定・MCMC まで一気に通す。',
  sections: [
    baseSection(0, '1. 導入と動機', '今日扱うトピックの全体像を確認。'),
    baseSection(360, '2. ベイズの定理の式', '記号と直感の対応関係を整理。', true),
    baseSection(720, '3. 医療検査の例', '具体例で偽陽性問題を可視化。', false, true),
    baseSection(1080, '4. ナイーブベイズ', '独立性仮定とその実用上の挙動。', true),
    baseSection(1440, '5. MAP vs ML', '事前分布の有無で何が変わるか。'),
    baseSection(1800, '6. 共役事前分布', 'Beta-Binomial を例に計算が閉形式になる嬉しさ。', false, true),
    baseSection(2160, '7. MCMC の概念', 'Metropolis-Hastings の動機づけ。', true),
    baseSection(2520, '8. まとめと課題', '次回の予習範囲とクイズ。', false, true),
  ],
}

export const SLIDES_FEW: SlideItem[] = [
  { ts: 60, key: 's1', url: 'https://placehold.co/240x135/1a1a1a/ffffff?text=Slide+1' },
  { ts: 480, key: 's2', url: 'https://placehold.co/240x135/2a2a2a/ffffff?text=Slide+2' },
]

export const SLIDES_MANY: SlideItem[] = Array.from({ length: 12 }, (_, i) => ({
  ts: 120 * (i + 1),
  key: `slide-${i}`,
  url: `https://placehold.co/240x135/${['1a1a1a', '2a2a2a', '3a3a3a'][i % 3]}/ffffff?text=Slide+${i + 1}`,
}))
