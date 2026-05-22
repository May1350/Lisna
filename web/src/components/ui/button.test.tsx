import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Download for Mac</Button>);
    expect(screen.getByText('Download for Mac')).toBeInTheDocument();
  });
  it('applies primary-ink variant classes by default', () => {
    render(<Button>X</Button>);
    expect(screen.getByText('X')).toHaveClass('bg-ink-900');
  });
  it('applies ghost variant classes when specified', () => {
    render(<Button variant="ghost">X</Button>);
    expect(screen.getByText('X')).toHaveClass('border-ink-900/20');
  });
  it('applies size="sm" classes when specified', () => {
    render(<Button size="sm">X</Button>);
    expect(screen.getByText('X')).toHaveClass('text-[14px]');
  });
  it('renders as <a> when asChild + an <a> is provided', () => {
    render(<Button asChild><a href="/download">D</a></Button>);
    const link = screen.getByText('D');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/download');
  });
});
