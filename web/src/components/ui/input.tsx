import * as React from 'react';
import { cn } from '@/lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-12 w-full rounded-md bg-cream-50 border border-ink-900/20 px-4 text-[15px] text-ink-900 placeholder:text-ink-700/50 focus:outline-none focus:border-ink-900/40 transition-colors',
        className,
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
