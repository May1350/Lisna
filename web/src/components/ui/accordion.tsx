'use client';
import * as React from 'react';
import * as Acc from '@radix-ui/react-accordion';
import { cn } from '@/lib/cn';

export const Accordion = Acc.Root;
export const AccordionItem = React.forwardRef<
  React.ElementRef<typeof Acc.Item>,
  React.ComponentPropsWithoutRef<typeof Acc.Item>
>(({ className, ...props }, ref) => (
  <Acc.Item ref={ref} className={cn('border-b border-ink-900/10', className)} {...props} />
));
AccordionItem.displayName = 'AccordionItem';

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof Acc.Trigger>,
  React.ComponentPropsWithoutRef<typeof Acc.Trigger>
>(({ className, children, ...props }, ref) => (
  <Acc.Header className="flex">
    <Acc.Trigger
      ref={ref}
      className={cn(
        'flex flex-1 items-center justify-between py-4 text-q font-serif text-ink-900 transition-colors hover:bg-[rgba(184,80,80,0.03)] [&[data-state=open]>span]:rotate-45',
        className,
      )}
      {...props}
    >
      {children}
      <span className="ml-4 text-[22px] text-accent-tan transition-transform duration-200">+</span>
    </Acc.Trigger>
  </Acc.Header>
));
AccordionTrigger.displayName = 'AccordionTrigger';

export const AccordionContent = React.forwardRef<
  React.ElementRef<typeof Acc.Content>,
  React.ComponentPropsWithoutRef<typeof Acc.Content>
>(({ className, children, ...props }, ref) => (
  <Acc.Content
    ref={ref}
    className={cn(
      'overflow-hidden text-body text-ink-700 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
      className,
    )}
    {...props}
  >
    <div className="pb-4 pt-0">{children}</div>
  </Acc.Content>
));
AccordionContent.displayName = 'AccordionContent';
