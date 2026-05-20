import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EmailMagicLinkForm } from './email-magic-link-form';

describe('EmailMagicLinkForm', () => {
  it('calls onSubmit with the email', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EmailMagicLinkForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(onSubmit).toHaveBeenCalledWith('a@b.com');
  });
  it('disables the button while submitting', async () => {
    let resolve: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<EmailMagicLinkForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => { resolve(); });
  });
});
