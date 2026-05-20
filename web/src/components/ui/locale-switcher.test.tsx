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
});
