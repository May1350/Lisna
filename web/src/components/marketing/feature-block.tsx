import { cn } from '@/lib/cn';

export interface FeatureBlockProps {
  eyebrow: string;
  headline: React.ReactNode;     // includes <em> for emphasis
  body: string;
  meta: string[];
  image: React.ReactNode;        // screenshot or illustration
  variant?: 'default' | 'reverse' | 'primary';
}

export function FeatureBlock({ eyebrow, headline, body, meta, image, variant = 'default' }: FeatureBlockProps) {
  const reverse = variant === 'reverse';
  const isPrimary = variant === 'primary';
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-24 py-24">
      <div className={cn(
        'grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center',
        reverse && 'lg:[&>div:first-child]:order-2',
      )}>
        <div>
          <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
          <h3 className={cn(
            'mt-3 font-serif leading-[1.15] text-ink-900',
            isPrimary ? 'text-feature-primary' : 'text-feature',
          )}>
            {headline}
          </h3>
          <p className="mt-5 font-sans text-body text-ink-700 leading-[1.65] max-w-[52ch]">{body}</p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-ink-700/80">
            {meta.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
        <div>{image}</div>
      </div>
    </section>
  );
}
