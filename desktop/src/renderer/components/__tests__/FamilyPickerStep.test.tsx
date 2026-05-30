/**
 * Tests for FamilyPickerStep.
 *
 * Static structural assertions via react-dom/server — vitest config has
 * no DOM env. Interactivity (radio change, continue click) is verified
 * via the live app per CLAUDE.md system-prompt guidance for UI changes.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FamilyPickerStep } from '../FamilyPickerStep';

describe('FamilyPickerStep', () => {
  it('renders all 4 families with JA labels', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    expect(html).toContain('講義 (Lecture)');
    expect(html).toContain('ミーティング (Meeting)');
    expect(html).toContain('インタビュー (Interview)');
    expect(html).toContain('ブレスト (Brainstorm)');
  });

  it('defaults to lecture selected', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    // The lecture radio is checked, others are not.
    expect(html).toMatch(/data-testid="family-radio-lecture"[^>]*checked/);
    expect(html).not.toMatch(/data-testid="family-radio-meeting"[^>]*checked/);
  });

  it('enables all 4 family radios (Plan 6 cores + renderers landed)', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    // React renders attrs in declaration order; `disabled` can land before
    // `data-testid` in the markup, so assert both attrs are present in the
    // same `<input ... />` tag via per-input substring extraction.
    const inputTag = (id: string): string => {
      const m = html.match(new RegExp(`<input[^>]*value="${id}"[^>]*/?>`));
      if (!m) throw new Error(`No input tag for value=${id}`);
      return m[0];
    };
    expect(inputTag('lecture')).not.toContain('disabled');
    expect(inputTag('meeting')).not.toContain('disabled');
    expect(inputTag('interview')).not.toContain('disabled');
    expect(inputTag('brainstorm')).not.toContain('disabled');
  });

  it('does not show the "(coming soon)" hint after Plan 6 lands', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    // The `{f.disabled && <small>(coming soon)</small>}` JSX clause stays
    // so a future temporary disable surfaces the hint, but with all
    // families enabled it must render zero times.
    const matches = html.match(/\(coming soon\)/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it('exposes a continue button labelled 続行', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    expect(html).toContain('続行');
    expect(html).toContain('data-testid="family-continue"');
  });

  it('renders the continue button enabled on first paint (in-flight guard is post-click)', () => {
    // The submitting state only flips after the first click — SSR initial
    // markup must NOT pre-disable the button (would make it permanently
    // unclickable since interactivity needs a DOM).
    const html = renderToStaticMarkup(<FamilyPickerStep onPick={() => {}} />);
    const m = html.match(/<button[^>]*data-testid="family-continue"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m?.[0]).not.toContain('disabled');
  });
});
