import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TermsView } from '../TermsView';

describe('TermsView', () => {
  it('renders the title, the honest-ceiling copy, and an add input', () => {
    const html = renderToStaticMarkup(<TermsView onBack={() => {}} />);
    expect(html).toContain('用語集');
    expect(html).toContain('出したい表記のまま'); // pin-the-spelling framing
    expect(html).toContain('同音異義語'); // homophone caveat — does not over-promise
    expect(html).toContain('用語を追加'); // add input (placeholder/aria-label)
  });
});
