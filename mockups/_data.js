// Shared data for all mockups — based on the user's actual K-LMS test
// session ("持続可能性とガバナンス"). Keeping it identical across mockups
// so visual differences between proposals are purely about layout/IA,
// not content.

window.SH_DATA = {
  title: '持続可能性とガバナンス',
  refreshedSecondsAgo: 12,
  sections: [
    {
      heading: '持続可能性の定義',
      ts: 0,
      summary: 'サステナビリティは多層構造で、地球環境から個人の寿命まで包含する',
      key_terms: [
        { term: 'サステナビリティ', definition: '地球の環境・個人の寿命・組織の持続可能性などを多層的に含む概念', ts: 5 },
        { term: '持続可能性', definition: 'サステナビリティの日本語訳。階層的に存在する', ts: 12 },
      ],
      examples: [
        { text: '地球の環境（温暖化・資源枯渇）', ts: 18 },
        { text: '個人の寿命と家族形成', ts: 32 },
        { text: '組織の長期存続', ts: 48 },
      ],
      points: [
        { text: '持続可能性は地球→国→企業→地域→個人と階層化される', ts: 65, important: true },
        { text: 'サステナビリティ＝環境問題というイメージは狭すぎる', ts: 88, important: false },
      ],
    },
    {
      heading: '価値創造と価値確保',
      ts: 120,
      summary: '企業はビジネスモデルで価値を創造し、社会に分配する',
      key_terms: [
        { term: '価値創造', definition: 'ビジネスモデルを通じて新しい価値を生み出すプロセス', ts: 135 },
        { term: '価値確保', definition: '創造した価値を持続的に獲得する仕組み', ts: 162 },
      ],
      examples: [
        { text: '商品・サービスの提供を通じた収益創出', ts: 145 },
        { text: '株主への配当', ts: 175 },
        { text: '労働者への報酬', ts: 188 },
      ],
      points: [
        { text: '価値創造＝顧客への価値提供＋自社の収益確保', ts: 150, important: true },
        { text: '産業競争の中で生き残るため持続的な価値創造が必要', ts: 200, important: false },
      ],
    },
    {
      heading: 'ガバナンスの定義',
      ts: 240,
      summary: '経営者を監督し、企業が不祥事を起こさないための制度設計',
      key_terms: [
        { term: 'ガバナンス', definition: '経営者・企業を監督し、適切に運営させるための制度設計', ts: 248 },
      ],
      examples: [
        { text: '社外取締役による監督', ts: 280 },
        { text: '監査委員会のレビュー', ts: 305 },
      ],
      points: [
        { text: 'ガバナンスの3要素＝モニタリング・監督・経営助言', ts: 260, important: true },
        { text: '不祥事防止の仕組みは事前的・事後的の両方が必要', ts: 320, important: false },
      ],
    },
    {
      heading: '持続可能性とガバナンスの関係',
      ts: 380,
      summary: 'ガバナンスは持続可能性を実現する制度的基盤',
      key_terms: [
        { term: 'ESG', definition: '環境(E)・社会(S)・ガバナンス(G)を統合した経営評価軸', ts: 410 },
      ],
      examples: [
        { text: 'ESG投資の拡大', ts: 425 },
        { text: '統合報告書の普及', ts: 458 },
      ],
      points: [
        { text: 'ガバナンスが弱い企業は長期的な持続可能性も失う', ts: 395, important: true },
      ],
    },
  ],
  liveTranscripts: [
    { ts: 380, text: 'ここで持続可能性とガバナンスの関係について整理しておきましょう' },
    { ts: 390, text: 'ガバナンスというのは制度設計の話ですよね' },
    { ts: 400, text: '一方で持続可能性はもっと大きな概念で' },
    { ts: 410, text: '実はESGという考え方がここで重要になってきます' },
    { ts: 420, text: 'ESGは環境のE、社会のS、ガバナンスのGを合わせた' },
    { ts: 430, text: '企業評価の新しい軸ですね' },
    { ts: 440, text: '近年ESG投資が急速に拡大していますが' },
    { ts: 450, text: 'これは投資家が企業の長期的な持続可能性を' },
    { ts: 460, text: '評価するようになったからです' },
  ],
}

function fmtTs(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
window.fmtTs = fmtTs
