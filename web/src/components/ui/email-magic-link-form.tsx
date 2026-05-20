'use client';
import * as React from 'react';
import { Input } from './input';
import { Button } from './button';

export interface EmailMagicLinkFormProps {
  onSubmit: (email: string) => Promise<void>;
  hint?: string;
}

export function EmailMagicLinkForm({ onSubmit, hint }: EmailMagicLinkFormProps) {
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
    return <p className="text-body text-ink-700">Magic link sent. Check your email.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="email"
          required
          placeholder="your@email.com"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send link'}
        </Button>
      </div>
      {hint && <p className="text-hint text-ink-700/60">{hint}</p>}
    </form>
  );
}
