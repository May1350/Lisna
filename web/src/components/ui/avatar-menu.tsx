'use client';
import Link from 'next/link';
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from './dropdown';

export interface AvatarMenuProps {
  name: string;
  email: string;
  image?: string | null;
  prefix: string;
  onSignOut: () => Promise<void>;
}

export function AvatarMenu({ name, email, image, prefix, onSignOut }: AvatarMenuProps) {
  return (
    <Dropdown>
      <DropdownTrigger className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-accent-tan text-cream-50 text-body-sm grid place-items-center font-serif overflow-hidden">
          {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : (name[0]?.toUpperCase() ?? '·')}
        </span>
        <span>{name}</span>
        <span className="text-[10px]" aria-hidden="true">▾</span>
      </DropdownTrigger>
      <DropdownContent align="end">
        <div className="px-3 py-2">
          <p className="text-body-sm text-ink-900">{name}</p>
          <p className="text-hint text-ink-700/70">{email}</p>
        </div>
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href={`${prefix}/dashboard`}>Dashboard</Link>
        </DropdownItem>
        <DropdownItem asChild>
          <form action={onSignOut} className="w-full">
            <button type="submit" className="w-full text-left">Sign out</button>
          </form>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
