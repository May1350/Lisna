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
  it('idle renders the start button + size disclosure, no picker link', () => {
    const html = renderToStaticMarkup(<ModelDownloadStep onReady={() => {}} />);
    expect(html).toContain('data-testid="start"');
    expect(html).toContain('はじめる');
    expect(html).not.toContain('use-picker');
    // Size disclosure computed from DEFAULT_MODELS catalog (574_041_195 +
    // 2_019_377_696 bytes ≈ 2.6 GB) — NOT a stale literal.
    expect(html).toContain('約2.6GB');
  });

  it('does not render the error strip or progress lines on idle', () => {
    const html = renderToStaticMarkup(<ModelDownloadStep onReady={() => {}} />);
    expect(html).not.toContain('data-testid="download-error"');
    expect(html).not.toContain('data-testid="download-retry"');
  });
});
