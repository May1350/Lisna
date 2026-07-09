/**
 * Tests for FamilyPickerStep.
 *
 * Static structural assertions via react-dom/server — vitest config has
 * no DOM env. Interactivity (radio change, continue click) is verified
 * via the live app per CLAUDE.md system-prompt guidance for UI changes.
 *
 * Task 9 — connectorConnected/onOpenConnector are now required props. The
 * component reads the upsell-dismissal flag from localStorage via a lazy
 * useState initializer, which runs synchronously during
 * renderToStaticMarkup — same localStorage-stub requirement as
 * Recording.test.tsx's 'lisna.language' stub. Pick-handler target
 * resolution, upsell visibility, and the ✕ button's persistence are pure/
 * injectable functions (resolveGenerationTarget / shouldShowClaudeUpsell /
 * persistClaudeUpsellDismissed), unit-tested directly rather than simulated
 * through a click.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FamilyPickerStep,
  resolveGenerationTarget,
  shouldShowClaudeUpsell,
  persistClaudeUpsellDismissed,
  CLAUDE_UPSELL_DISMISSED_KEY,
} from '../FamilyPickerStep';

// Minimal localStorage stub — the upsell-dismissal flag is read at init via a
// useState lazy initializer (synchronous, runs during render). Mirrors
// Recording.test.tsx's 'lisna.language' stub.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

// Not-connected is the default shape used by most pre-existing tests below —
// they only care about family-list structure, unaffected by the connector axis.
const NOT_CONNECTED = { connectorConnected: false, onOpenConnector: () => {} };

describe('FamilyPickerStep', () => {
  it('renders all 4 families with JA labels', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    expect(html).toContain('講義 (Lecture)');
    expect(html).toContain('ミーティング (Meeting)');
    expect(html).toContain('インタビュー (Interview)');
    expect(html).toContain('ブレスト (Brainstorm)');
  });

  it('defaults to lecture selected', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    // The lecture radio is checked, others are not.
    expect(html).toMatch(/data-testid="family-radio-lecture"[^>]*checked/);
    expect(html).not.toMatch(/data-testid="family-radio-meeting"[^>]*checked/);
  });

  it('enables all 4 family radios (Plan 6 cores + renderers landed)', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
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
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    // The `{f.disabled && <small>(coming soon)</small>}` JSX clause stays
    // so a future temporary disable surfaces the hint, but with all
    // families enabled it must render zero times.
    const matches = html.match(/\(coming soon\)/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it('exposes a continue button labelled 続行', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    expect(html).toContain('続行');
    expect(html).toContain('data-testid="family-continue"');
  });

  it('renders the continue button enabled on first paint (in-flight guard is post-click)', () => {
    // The submitting state only flips after the first click — SSR initial
    // markup must NOT pre-disable the button (would make it permanently
    // unclickable since interactivity needs a DOM).
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    const m = html.match(/<button[^>]*data-testid="family-continue"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m?.[0]).not.toContain('disabled');
  });

  it('renders the 文字起こし (transcript) output choice set apart from the 4 families', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    // STT Phase 2 raw-transcript output mode: a 5th radio that is NOT a note
    // family but an LLM-free output format.
    expect(html).toContain('文字起こし (Transcript)');
    expect(html).toContain('data-testid="family-radio-transcript"');
    // The transcript radio is NOT selected by default (lecture stays the default).
    expect(html).not.toMatch(/data-testid="family-radio-transcript"[^>]*checked/);
    // It is enabled (selectable).
    const m = html.match(/<input[^>]*value="transcript"[^>]*\/?>/);
    expect(m).not.toBeNull();
    expect(m?.[0]).not.toContain('disabled');
  });

  it('hides the 文字起こし choice when showTranscript={false} (history-regenerate picker)', () => {
    const html = renderToStaticMarkup(
      <FamilyPickerStep onDiscard={() => {}} onPick={() => {}} showTranscript={false} {...NOT_CONNECTED} />,
    );
    // The dump transcript is already displayed in the history view, so the
    // raw-transcript output radio is not rendered there.
    expect(html).not.toContain('data-testid="family-radio-transcript"');
    expect(html).not.toContain('文字起こし (Transcript)');
    // The 4 note families remain.
    expect(html).toContain('data-testid="family-radio-lecture"');
    expect(html).toContain('data-testid="family-radio-brainstorm"');
  });

  it('shows the 文字起こし choice by default (showTranscript defaults to true)', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    expect(html).toContain('data-testid="family-radio-transcript"');
  });

  it('accepts onPick with the transcript output choice (widened type)', () => {
    // Compile-time contract: onPick is
    // `(choice: NoteFamily | 'transcript', target: 'ondevice' | 'claude') => void`.
    // A handler that narrows on 'transcript' must type-check and render.
    const picks: Array<string> = [];
    const html = renderToStaticMarkup(
      <FamilyPickerStep
        onDiscard={() => {}}
        onPick={(choice, target) => {
          picks.push(choice === 'transcript' ? 'transcript' : `${choice}:${target}`);
        }}
        {...NOT_CONNECTED}
      />,
    );
    expect(html).toContain('data-testid="family-radio-transcript"');
  });

  it('exposes a discard button (note-less exit route, 2026-06-10)', () => {
    const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
    expect(html).toContain('ノートを作らずに戻る');
    expect(html).toContain('data-testid="family-discard"');
    // Initial paint must not pre-disable it (same SSR rationale as 続行).
    const m = html.match(/<button[^>]*data-testid="family-discard"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m?.[0]).not.toContain('disabled');
  });

  it('with language=ko, shows only the transcript option (no note families)', () => {
    const html = renderToStaticMarkup(
      <FamilyPickerStep language="ko" onPick={() => {}} onDiscard={() => {}} {...NOT_CONNECTED} />,
    );
    expect(html).toContain('data-testid="family-radio-transcript"');
    expect(html).not.toContain('data-testid="family-radio-lecture"');
    expect(html).not.toContain('data-testid="family-radio-meeting"');
    expect(html).toContain('coming soon'); // ko-notes hint
  });

  it('with language=ja, shows all 4 families + transcript (unchanged)', () => {
    const html = renderToStaticMarkup(
      <FamilyPickerStep language="ja" onPick={() => {}} onDiscard={() => {}} {...NOT_CONNECTED} />,
    );
    expect(html).toContain('data-testid="family-radio-lecture"');
    expect(html).toContain('data-testid="family-radio-transcript"');
  });

  describe('generation-target picker (Task 9, spec section 4 step 3)', () => {
    it('shows the target seg control with Claude preselected when connected', () => {
      const html = renderToStaticMarkup(
        <FamilyPickerStep onDiscard={() => {}} onPick={() => {}} connectorConnected onOpenConnector={() => {}} />,
      );
      expect(html).toContain('data-testid="target-seg"');
      expect(html).toContain(TARGET_CLAUDE_LABEL);
      expect(html).toContain(TARGET_ONDEVICE_LABEL);
      expect(html).toMatch(/data-testid="target-radio-claude"[^>]*checked/);
      expect(html).not.toMatch(/data-testid="target-radio-ondevice"[^>]*checked/);
    });

    it('hides the target seg control entirely when not connected', () => {
      const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
      expect(html).not.toContain('data-testid="target-seg"');
    });

    it('resolveGenerationTarget: connected + claude selected (default) → claude', () => {
      expect(resolveGenerationTarget(true, 'claude')).toBe('claude');
    });

    it('resolveGenerationTarget: connected + ondevice selected (seg switched) → ondevice', () => {
      expect(resolveGenerationTarget(true, 'ondevice')).toBe('ondevice');
    });

    it('resolveGenerationTarget: not connected → always ondevice regardless of selection', () => {
      expect(resolveGenerationTarget(false, 'claude')).toBe('ondevice');
      expect(resolveGenerationTarget(false, 'ondevice')).toBe('ondevice');
    });
  });

  describe('Claude upsell banner (Task 9, spec section 4 step 3)', () => {
    it('renders when not connected and not dismissed', () => {
      const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
      expect(html).toContain('data-testid="claude-upsell"');
      expect(html).toContain('data-testid="claude-upsell-close"');
      expect(html).toContain('data-testid="claude-upsell-open"');
    });

    it('is hidden when connected, regardless of dismissal state', () => {
      const html = renderToStaticMarkup(
        <FamilyPickerStep onDiscard={() => {}} onPick={() => {}} connectorConnected onOpenConnector={() => {}} />,
      );
      expect(html).not.toContain('data-testid="claude-upsell"');
    });

    it('is hidden when previously dismissed (persisted in localStorage)', () => {
      localStorageMock.setItem(CLAUDE_UPSELL_DISMISSED_KEY, '1');
      const html = renderToStaticMarkup(<FamilyPickerStep onDiscard={() => {}} onPick={() => {}} {...NOT_CONNECTED} />);
      expect(html).not.toContain('data-testid="claude-upsell"');
    });

    it('persistClaudeUpsellDismissed writes the localStorage flag (✕ button persistence)', () => {
      expect(localStorageMock.getItem(CLAUDE_UPSELL_DISMISSED_KEY)).toBeNull();
      persistClaudeUpsellDismissed(localStorageMock);
      expect(localStorageMock.getItem(CLAUDE_UPSELL_DISMISSED_KEY)).toBe('1');
    });

    it('shouldShowClaudeUpsell: not connected + not dismissed → true', () => {
      expect(shouldShowClaudeUpsell(false, false)).toBe(true);
    });

    it('shouldShowClaudeUpsell: connected → false regardless of dismissal', () => {
      expect(shouldShowClaudeUpsell(true, false)).toBe(false);
      expect(shouldShowClaudeUpsell(true, true)).toBe(false);
    });

    it('shouldShowClaudeUpsell: dismissed → false', () => {
      expect(shouldShowClaudeUpsell(false, true)).toBe(false);
    });
  });
});

// Pulled from connector-strings.ts so this test file breaks loudly (not
// silently pass on a copy mismatch) if the JA copy changes.
const TARGET_CLAUDE_LABEL = 'Claudeで生成';
const TARGET_ONDEVICE_LABEL = 'オンデバイス';
