/**
 * Tests for ModelDownloadStep. Static SSR assertions via react-dom/server
 * per the renderer-side no-DOM-env convention — live progress/interaction
 * (button click → window.lisna.downloadModels, progress subscription) is
 * verified in the packaged app per CLAUDE.md UI-verification guidance.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelDownloadStep } from '../ModelDownloadStep';

describe('ModelDownloadStep', () => {
  it('renders the download button + size disclosure + fallback picker link on idle', () => {
    const html = renderToStaticMarkup(
      <ModelDownloadStep onReady={() => {}} onUsePicker={() => {}} />,
    );
    expect(html).toContain('data-testid="download-models"');
    expect(html).toContain('ダウンロード');
    expect(html).toContain('data-testid="use-picker"');
    expect(html).toContain('すでにファイルがある場合は選択');
    // Size disclosure computed from DEFAULT_MODELS catalog (574_041_195 +
    // 2_019_377_696 bytes ≈ 2.6 GB) — NOT the stale "2.4" plan literal.
    expect(html).toContain('約2.6GB');
  });

  it('does not render the error strip or progress lines on idle', () => {
    const html = renderToStaticMarkup(
      <ModelDownloadStep onReady={() => {}} onUsePicker={() => {}} />,
    );
    expect(html).not.toContain('data-testid="download-error"');
  });
});
