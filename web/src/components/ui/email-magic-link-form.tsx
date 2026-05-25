'use client';
import * as React from 'react';
import { Input } from './input';
import { Button } from './button';

export interface EmailMagicLinkFormProps {
  /** Called on submit. Throw to abort; handle error UI (e.g. toast) at the call site. */
  onSubmit: (email: string) => Promise<void>;
  hint?: string;
  /** Localized labels — default to English so the sandbox/test work without i18n. */
  submitLabel?: string;
  submittingLabel?: string;
  sentLabel?: string;
}

export function EmailMagicLinkForm({
  onSubmit,
  hint,
  submitLabel = 'Send link',
  submittingLabel = 'Sending…',
  sentLabel = 'Magic link sent. Check your email.',
}: EmailMagicLinkFormProps) {
  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(email);
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <p className="text-body text-ink-700 text-center">{sentLabel}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        type="email"
        required
        placeholder="your@email.com"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" disabled={submitting} className="w-full justify-center">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {hint && <p className="text-hint text-ink-700/60 text-center">{hint}</p>}
    </form>
  );
}
