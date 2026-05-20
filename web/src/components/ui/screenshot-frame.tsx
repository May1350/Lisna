import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ScreenshotFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function ScreenshotFrame({ title, className, children, ...props }: ScreenshotFrameProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-cream-50 overflow-hidden shadow-[0_6px_28px_rgba(60,40,20,0.18)] border border-ink-900/10',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-cream-300/60 border-b border-ink-900/10">
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-margin-red/70" />
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-accent-tan/70" />
        <span aria-hidden className="block w-2.5 h-2.5 rounded-full bg-accent-sage/70" />
        {title && <span className="ml-2 text-body-sm text-ink-700/80 font-sans">{title}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
