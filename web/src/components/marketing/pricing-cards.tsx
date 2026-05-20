// web/src/components/marketing/pricing-cards.tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import Link from 'next/link';

export interface PricingPlan {
  name: string;
  amount: string;       // "$0" or "$?"
  period: string;       // "/forever during alpha" or "/month (post-alpha)"
  badge?: { label: string; tone: 'free' | 'soon' };
  features: string[];
  cta?: { label: string; href: string };
  highlighted?: boolean;
}

export interface PricingCardsProps {
  heading: string;
  sub: string;
  plans: [PricingPlan, PricingPlan];
}

export function PricingCards({ heading, sub, plans }: PricingCardsProps) {
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-24 py-24">
      <div className="text-center">
        <h2 className="font-serif text-h2-sm text-ink-900">{heading}</h2>
        <p className="mt-4 font-sans text-body text-ink-700 max-w-[52ch] mx-auto">{sub}</p>
      </div>
      <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {plans.map((plan, i) => (
          <article
            key={i}
            className={cn(
              'rounded-lg bg-cream-50 p-10',
              plan.highlighted ? 'border-[1.5px] border-margin-red' : 'border border-ink-900/10',
            )}
          >
            {plan.badge && (
              <span className={cn(
                'inline-block text-meta uppercase tracking-[0.12em] px-2 py-0.5 rounded-sm',
                plan.badge.tone === 'free' ? 'bg-margin-red/10 text-margin-red' : 'bg-ink-900/10 text-ink-700',
              )}>
                {plan.badge.label}
              </span>
            )}
            <h3 className="mt-3 font-serif text-plan text-ink-900">{plan.name}</h3>
            <p className="mt-4">
              <span className="font-serif text-display-2 text-ink-900">{plan.amount}</span>
              <span className="ml-2 font-sans text-body text-ink-700/70">{plan.period}</span>
            </p>
            <ul className="mt-8 space-y-3 text-body text-ink-700">
              {plan.features.map((f, j) => <li key={j}>· {f}</li>)}
            </ul>
            {plan.cta && (
              <div className="mt-10">
                <Button asChild variant={plan.highlighted ? 'primary-ink' : 'ghost'} size="md">
                  <Link href={plan.cta.href}>{plan.cta.label}</Link>
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
