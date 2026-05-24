import { cn } from '@/lib/cn';

export interface FeatureBlockProps {
  eyebrow: string;
  headline: React.ReactNode;     // includes <em> for emphasis
  body: React.ReactNode;
  meta: string[];
  image: React.ReactNode;        // screenshot or illustration (typically <Postit>)
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
          <p className="text-meta uppercase tracking-[0.18em] text-print-red">{eyebrow}</p>
          <h2 className={cn(
            'mt-3 font-serif leading-[1.15] text-ink-900',
            isPrimary ? 'text-feature-primary' : 'text-feature',
          )}>
            {headline}
          </h2>
          <p className="mt-5 font-sans text-body text-ink-700 leading-[1.65] max-w-[52ch]">{body}</p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-ink-700/80">
            {meta.map((m, i) => (
              <li key={i} className="relative pl-4 before:content-[''] before:absolute before:left-0 before:top-[0.7em] before:w-2 before:h-[1.5px] before:bg-print-red/85">
                {m}
              </li>
            ))}
          </ul>
        </div>
        <div>{image}</div>
      </div>
    </section>
  );
}
