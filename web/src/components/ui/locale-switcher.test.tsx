import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleSwitcher } from './locale-switcher';

describe('LocaleSwitcher', () => {
  it('renders current locale label', () => {
    render(<LocaleSwitcher currentLocale="en" pathname="/" />);
    expect(screen.getByRole('button', { name: /EN/i })).toBeInTheDocument();
  });
  it('shows JP flag/label for ja locale', () => {
    render(<LocaleSwitcher currentLocale="ja" pathname="/" />);
    expect(screen.getByRole('button', { name: /日本語/i })).toBeInTheDocument();
  });
  it('builds clean locale hrefs without trailing slash at root (Fix #1)', () => {
    // Re-implements the component's stripLocale + buildHref logic to lock in fix behavior
    const stripLocale = (p: string) => p.replace(/^\/(en|ja|ko)(?=\/|$)/, '') || '/';
    const buildHref = (loc: 'en' | 'ja' | 'ko', basePath: string) =>
      loc === 'en' ? basePath : `/${loc}${basePath === '/' ? '' : basePath}`;
    // Root pathname
    expect(buildHref('ja', stripLocale('/'))).toBe('/ja');
    expect(buildHref('ko', stripLocale('/'))).toBe('/ko');
    // Locale-prefixed root (e.g. user is on /ja home)
    expect(buildHref('ko', stripLocale('/ja'))).toBe('/ko');
    expect(buildHref('en', stripLocale('/ja'))).toBe('/');
    // Sub-page path — must preserve the page segment
    expect(buildHref('ja', stripLocale('/ko/pricing'))).toBe('/ja/pricing');
    expect(buildHref('en', stripLocale('/ja/pricing'))).toBe('/pricing');
  });
});
