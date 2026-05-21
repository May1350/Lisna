import type { Locale } from '@/i18n/routing';
import type { ComponentProps } from 'react';

// Returns an MDX component map that adapts plain markdown links to the
// rest of the site:
//  - external (http/https) → open in new tab with safe rel attrs
//  - permanent infrastructure paths (matcher-excluded, locale-agnostic
//    by design — `/dl/*`, `/changelog/rss.xml`, `/robots.txt`) → leave bare
//  - other internal absolute paths → locale-prefix when locale !== 'en'
// MDX bodies otherwise emit `<a href="/download">` verbatim, which drops
// non-EN visitors back to the EN tree at every in-text link click.
export function mdxComponents(locale: Locale) {
  const MdxLink = ({ href, children, ...rest }: ComponentProps<'a'>) => {
    if (!href) return <a {...rest}>{children}</a>;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      );
    }
    if (
      href.startsWith('/dl/') ||
      href === '/changelog/rss.xml' ||
      href === '/robots.txt'
    ) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    }
    if (href.startsWith('/') && locale !== 'en') {
      return (
        <a href={`/${locale}${href}`} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
  return { a: MdxLink };
}
