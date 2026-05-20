import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-sans transition-transform duration-150 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        'primary-ink':
          'bg-ink-900 text-cream-200 rounded-md shadow-[0_3px_0_rgba(0,0,0,0.25),0_6px_14px_rgba(60,40,20,0.18)] hover:-translate-y-px',
        ghost:
          'border border-ink-900/20 text-ink-900 rounded-md hover:bg-cream-100',
        'text-arrow':
          'text-ink-900 underline-offset-4 hover:underline',
      },
      size: {
        md: 'text-[16px] px-[30px] py-[18px]',
        sm: 'text-[14px] px-[22px] py-[14px]',
        lg: 'text-[17px] px-[34px] py-[20px]',
      },
    },
    defaultVariants: { variant: 'primary-ink', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
