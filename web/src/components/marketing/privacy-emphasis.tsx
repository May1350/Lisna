// web/src/components/marketing/privacy-emphasis.tsx
export interface PrivacyEmphasisProps {
  eyebrow: string;
  headline: React.ReactNode;
  statValue: string;       // "100%"
  statSub: string;
  items: { title: string; body: string }[];
}

export function PrivacyEmphasis({ eyebrow, headline, statValue, statSub, items }: PrivacyEmphasisProps) {
  return (
    <section className="bg-ink-900 text-cream-200 py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-24 grid lg:grid-cols-[5fr_4fr] gap-16">
        <div>
          <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
          <h2 className="mt-4 font-serif text-h2 text-cream-200 leading-[1.1]">{headline}</h2>
          <div className="mt-12">
            <p className="font-serif italic text-[72px] leading-none text-accent-tan">{statValue}</p>
            <p className="mt-3 font-sans text-body text-cream-200/78 max-w-[36ch]">{statSub}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((it, i) => (
            <div key={i}>
              <h4 className="font-serif text-grid-title text-cream-200">{it.title}</h4>
              <p className="mt-2 font-sans text-body-sm text-cream-200/70 leading-[1.65]">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
