// web/src/components/marketing/marginalia.tsx
export function Marginalia({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative py-6">
      <div className="relative mx-auto max-w-7xl pad-x">
        <div className="marginalia-hand">
          <svg className="marginalia-hand__arrow" viewBox="0 0 44 44" aria-hidden="true">
            <path d="M5,4 Q12,16 18,24 Q24,32 36,38 M28,30 L36,38 L28,42" />
          </svg>
          {children}
        </div>
      </div>
    </section>
  );
}
