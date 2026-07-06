/**
 * Tests for GlossaryAdded (glossary-auto Task 2).
 *
 * Static structural assertions via react-dom/server — this project's vitest
 * config has NO DOM env (mirrors LevelMeter / FirstRunAudioNotice tests).
 * Click→undo wiring is verified via the live app; here we assert the banner
 * renders the added terms + heading + remove-all copy, and that an empty
 * `added` list renders nothing (no confirm — terms are already auto-added).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlossaryAdded } from '../GlossaryAdded';

describe('GlossaryAdded', () => {
  it('renders added terms + heading + remove-all', () => {
    const html = renderToStaticMarkup(<GlossaryAdded added={['アグリテック', 'iOS']} onClose={() => {}} />);
    expect(html).toContain('追加しました');
    expect(html).toContain('アグリテック');
    expect(html).toContain('glossary-added'); // data-testid
    expect(html).toContain('すべて取り消す');
  });

  it('empty added → renders nothing', () => {
    expect(renderToStaticMarkup(<GlossaryAdded added={[]} onClose={() => {}} />)).toBe('');
  });
});
