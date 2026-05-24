'use client';
import * as React from 'react';
import Link from 'next/link';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from './dropdown';

export interface NavBarMobileMenuItem {
  href: string;
  label: string;
}

export interface NavBarMobileMenuProps {
  items: NavBarMobileMenuItem[];
  signinHref: string;
  signinLabel: string;
  authState: 'guest' | 'signedIn';
}

export function NavBarMobileMenu({ items, signinHref, signinLabel, authState }: NavBarMobileMenuProps) {
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-inherit hover:bg-white/10 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7"  x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </DropdownTrigger>
      <DropdownContent align="end" className="min-w-[200px]">
        {items.map((it) => (
          <DropdownItem key={it.href} asChild>
            <Link href={it.href}>{it.label}</Link>
          </DropdownItem>
        ))}
        {authState === 'guest' && (
          <DropdownItem asChild>
            <Link href={signinHref} className="font-medium">{signinLabel}</Link>
          </DropdownItem>
        )}
      </DropdownContent>
    </Dropdown>
  );
}
