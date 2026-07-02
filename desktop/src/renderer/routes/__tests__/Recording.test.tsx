/**
 * Static structural tests for Recording route.
 *
 * vitest config has no DOM env — renderToStaticMarkup only.
 * `localStorage` and `window.lisna` must be stubbed before render.
 * Interactive behavior (start/stop, language switch) is verified in the live app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Recording } from '../Recording';

// Minimal localStorage stub — Recording reads 'lisna.language' at init via
// useState lazy initializer (synchronous, runs before effects).
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

// window.lisna IPC — Recording calls capabilities() + listDumps() inside
// useEffect (async), which does NOT run during renderToStaticMarkup, so we
// only need the object to exist (to avoid a TypeError on property access if
// React ever synchronously references it).
const lisnaMock = {
  capabilities: vi.fn().mockResolvedValue({ systemAudio: false }),
  listDumps: vi.fn().mockResolvedValue([]),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  startSession: vi.fn(),
  sendChunk: vi.fn(),
};

beforeEach(() => {
  localStorageMock.clear();
  // Assign to globalThis so the lazy useState initializer sees it.
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { lisna: lisnaMock },
    writable: true,
    configurable: true,
  });
});

const PROPS = { onStop: () => {}, onError: () => {}, onOpenHistory: () => {}, onOpenTerms: () => {}, onQuickTranscript: () => {} };

describe('Recording — language radios', () => {
  it('renders a Korean (ko) radio with label 한국어', () => {
    const html = renderToStaticMarkup(<Recording {...PROPS} />);
    expect(html).toContain('value="ko"');
    expect(html).toContain('한국어');
  });

  it('defaults to ja when localStorage has no persisted value', () => {
    // getItem returns null → ja should be the default
    const html = renderToStaticMarkup(<Recording {...PROPS} />);
    // The ja radio should be checked; ko should not.
    const jaInput = html.match(/<input[^>]*value="ja"[^>]*\/?>/)?.[0] ?? '';
    const koInput = html.match(/<input[^>]*value="ko"[^>]*\/?>/)?.[0] ?? '';
    expect(jaInput).toContain('checked');
    expect(koInput).not.toContain('checked');
  });

  it('restores ko as checked when localStorage persists ko', () => {
    localStorageMock.setItem('lisna.language', 'ko');
    const html = renderToStaticMarkup(<Recording {...PROPS} />);
    const koInput = html.match(/<input[^>]*value="ko"[^>]*\/?>/)?.[0] ?? '';
    const jaInput = html.match(/<input[^>]*value="ja"[^>]*\/?>/)?.[0] ?? '';
    expect(koInput).toContain('checked');
    expect(jaInput).not.toContain('checked');
  });
});
