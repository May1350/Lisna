/**
 * Static structural tests (renderToStaticMarkup — vitest config has no DOM env;
 * the live updating bar is verified via the running app per CLAUDE.md UI
 * guidance). LevelMeter is a pure presentational meter for the recording screen
 * (STT Phase 2 E): role="meter", dBFS→percent fill, CLIP indicator.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LevelMeter, CLIP_DBFS } from '../LevelMeter';

describe('LevelMeter', () => {
  it('exposes meter semantics with the correct aria-valuenow', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={-30} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuemin="-60"');
    expect(html).toContain('aria-valuemax="0"');
    expect(html).toContain('aria-valuenow="-30"');
  });

  it('maps dBFS to fill width: -60 → 0%', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={-60} />);
    expect(html).toContain('width:0%');
  });

  it('maps dBFS to fill width: 0 → 100%', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={0} />);
    expect(html).toContain('width:100%');
  });

  it('shows the CLIP indicator at full scale', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={CLIP_DBFS} />);
    expect(html).toContain('data-testid="level-clip"');
  });

  it('hides the CLIP indicator at a normal level', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={-30} />);
    expect(html).not.toContain('data-testid="level-clip"');
  });

  it('includes deviceName in the aria-label when provided', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={-30} deviceName="Microphone" />);
    expect(html).toContain('aria-label="音声レベル — Microphone"');
  });

  it('uses a plain aria-label when no deviceName is provided', () => {
    const html = renderToStaticMarkup(<LevelMeter dbfs={-30} />);
    expect(html).toContain('aria-label="音声レベル"');
  });
});
