// web/src/components/marketing/faq-accordion.tsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

export interface FAQEntry {
  q: string;
  a: React.ReactNode;
}

export interface FAQAccordionProps {
  eyebrow: string;
  heading: React.ReactNode;
  entries: FAQEntry[];
}

export function FAQAccordion({ eyebrow, heading, entries }: FAQAccordionProps) {
  return (
    <section className="mx-auto max-w-3xl pad-x py-24">
      <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-h2-sm text-ink-900">{heading}</h2>
      <Accordion type="single" collapsible defaultValue="item-0" className="mt-10">
        {entries.map((entry, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{entry.q}</AccordionTrigger>
            <AccordionContent>{entry.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
