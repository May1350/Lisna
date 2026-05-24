'use client';
import * as React from 'react';
import Link from 'next/link';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from './dropdown';
import type { Locale } from '@/i18n/routing';

const LABELS: Record<Locale, string> = {
  en: 'EN',
  ja: '日本語',
  ko: '한국어',
};

const ALL: Locale[] = ['en', 'ja', 'ko'];

// Strip /ja or /ko prefix; en uses the bare path (as-needed prefix mode)
function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(en|ja|ko)(?=\/|$)/, '') || '/';
}

export interface LocaleSwitcherProps {
  currentLocale: Locale;
  pathname: string;
}

export function LocaleSwitcher({ currentLocale, pathname }: LocaleSwitcherProps) {
  const basePath = stripLocale(pathname);
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={`Locale: ${LABELS[currentLocale]}`}
        // text color inherits from parent — works on both light (auth-shell)
        // and dark (NavBar burgundy) backgrounds. Hover dims via opacity to
        // stay neutral to whichever currentColor is in effect.
        className="inline-flex items-center gap-1 text-body text-inherit hover:opacity-70 transition-opacity"
      >
        {LABELS[currentLocale]} <span className="text-[10px]" aria-hidden="true">▾</span>
      </DropdownTrigger>
      <DropdownContent align="end">
        {ALL.map((loc) => (
          <DropdownItem key={loc} asChild>
            <Link href={loc === 'en' ? basePath : `/${loc}${basePath === '/' ? '' : basePath}`}>
              {LABELS[loc]}
            </Link>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
