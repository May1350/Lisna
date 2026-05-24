import * as React from 'react';
import { cn } from '@/lib/cn';

export interface PostitProps extends React.HTMLAttributes<HTMLDivElement> {
  caption?: React.ReactNode;
  variant?: 'default' | 'reverse';
  shape?: 'square' | 'wide' | 'portrait';
}

/**
 * Yellow post-it screenshot frame. Replaces ScreenshotFrame on marketing
 * surfaces. Shadow uses V2-B (y = blur, no upward bleed) via .postit class
 * defined in globals.css.
 */
export function Postit({
  caption,
  variant = 'default',
  shape = 'square',
  className,
  children,
  ...props
}: PostitProps) {
  return (
    <div
      className={cn(
        'postit mx-auto',
        variant === 'reverse' && 'postit--reverse',
        shape === 'wide' && 'postit--wide',
        shape === 'portrait' && 'postit--portrait',
        className,
      )}
      {...props}
    >
      <div className="postit__inner">{children}</div>
      {caption && <div className="postit__caption">{caption}</div>}
    </div>
  );
}
