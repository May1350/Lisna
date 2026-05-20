'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailMagicLinkForm } from '@/components/ui/email-magic-link-form';
import { Card } from '@/components/ui/card';
import { ScreenshotFrame } from '@/components/ui/screenshot-frame';

const BUTTON_VARIANTS = ['primary-ink', 'ghost', 'text-arrow'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;

function SectionHeading({
  children,
  first = false,
}: {
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <h2
      className={`text-h2-sm font-serif text-ink-900 mb-4 ${first ? 'mt-0' : 'mt-12'}`}
    >
      {children}
    </h2>
  );
}

export default function DesignTestPage() {
  return (
    <main className="notebook-bg ruled-paper red-margin min-h-screen p-12">
      {/* ── cn() ── */}
      <SectionHeading first>cn()</SectionHeading>
      <p className="text-body text-ink-700/70 mb-4">
        The <code className="font-mono text-body-sm">cn()</code> helper merges
        Tailwind classes via clsx + twMerge. It is invisible by definition — no
        visual demo needed.
      </p>

      {/* ── Button variants ── */}
      <SectionHeading>Button variants</SectionHeading>
      <div className="flex flex-wrap gap-3 items-end">
        {BUTTON_VARIANTS.map((variant) =>
          BUTTON_SIZES.map((size) => {
            const label = `${
              variant === 'primary-ink'
                ? 'Primary'
                : variant === 'ghost'
                ? 'Ghost'
                : 'Text-arrow'
            } ${size}`;
            return (
              <Button key={`${variant}-${size}`} variant={variant} size={size}>
                {label}
              </Button>
            );
          })
        )}
      </div>

      {/* ── Button asChild ── */}
      <SectionHeading>Button asChild</SectionHeading>
      <div className="flex gap-3">
        <Button asChild variant="ghost" size="md">
          <a href="#asChild">link as button</a>
        </Button>
      </div>

      {/* ── Input + EmailMagicLinkForm ── */}
      <SectionHeading>Input + EmailMagicLinkForm</SectionHeading>
      <div className="max-w-md flex flex-col gap-4">
        <Input type="email" placeholder="your@email.com" aria-label="Standalone input demo" />
        <EmailMagicLinkForm
          hint="Enter your email to receive a magic link."
          onSubmit={() => Promise.resolve()}
        />
      </div>

      {/* ── Card variants ── */}
      <SectionHeading>Card variants</SectionHeading>
      <div className="grid grid-cols-2 gap-4">
        <Card variant="cream">
          <h3 className="text-grid-title font-serif">Cream card</h3>
          <p className="text-body text-ink-700">
            Plain cream background. Suitable for most content blocks.
          </p>
        </Card>
        <Card variant="notebook">
          <h3 className="text-grid-title font-serif">Notebook card</h3>
          <p className="text-body text-ink-700">
            Ruled-paper lines over cream — mirrors the notebook aesthetic.
          </p>
        </Card>
      </div>

      {/* ── ScreenshotFrame ── */}
      <SectionHeading>ScreenshotFrame</SectionHeading>
      <ScreenshotFrame title="Lisna demo">
        <div className="aspect-video bg-ink-900/5 flex items-center justify-center text-ink-700/40 text-body">
          [screenshot placeholder]
        </div>
      </ScreenshotFrame>

      {/* ── Notebook utilities standalone ── */}
      <SectionHeading>Notebook utilities standalone</SectionHeading>
      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="h-48 ruled-paper rounded-md border border-ink-900/10 p-4 text-body-sm text-ink-700/70">
          .ruled-paper
        </div>
        <div className="h-48 red-margin rounded-md border border-ink-900/10 p-4 text-body-sm text-ink-700/70">
          .red-margin
        </div>
        <div className="h-48 notebook-bg rounded-md border border-ink-900/10 p-4 text-body-sm text-ink-700/70">
          .notebook-bg
        </div>
      </div>
    </main>
  );
}
