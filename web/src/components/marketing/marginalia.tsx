// web/src/components/marketing/marginalia.tsx
export function Marginalia({ children }: { children: React.ReactNode }) {
  return (
    <section className="red-margin relative border-b border-dashed border-ink-900/15 py-6">
      <div className="relative mx-auto max-w-7xl px-6 lg:px-24">
        <span aria-hidden className="absolute left-[88px] top-1/2 -translate-y-1/2 text-[12px] text-margin-red/70 hidden lg:inline">
          ✎
        </span>
        <p className="font-serif italic text-accent-tan text-[18px] lg:text-[20px] text-center lg:text-left lg:pl-32 max-w-[60ch] mx-auto lg:mx-0">
          {children}
        </p>
      </div>
    </section>
  );
}
