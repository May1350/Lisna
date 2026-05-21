// web/src/app/[locale]/dashboard/page.tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appDevices } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import type { Locale } from '@/i18n/routing';

export default async function DashboardPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale === 'en' ? '' : locale + '/'}signin?next=/dashboard`);

  const devices = await db
    .select()
    .from(appDevices)
    .where(and(eq(appDevices.userId, session.user.id), isNull(appDevices.revokedAt)))
    .orderBy(appDevices.lastSeenAt);

  const firstName = (session.user.name ?? session.user.email ?? '').split(' ')[0] || 'there';

  return (
    <DashboardShell locale={locale}>
      <h1 className="font-serif text-h2 text-ink-900">
        Hi, <em className="italic text-accent-tan">{firstName}</em>.
      </h1>
      <p className="mt-2 text-body-sm text-ink-700">You're in the alpha. Here's your dashboard.</p>

      <div className="mt-12 grid lg:grid-cols-[2fr_1fr] gap-6">
        <Card className="lg:row-span-2">
          <p className="text-meta uppercase text-accent-tan">YOUR APP</p>
          <h3 className="mt-2 font-serif text-h2-sm text-ink-900">Lisna for macOS</h3>
          <p className="mt-3 text-body text-ink-700">The latest desktop build.</p>
          <div className="mt-6">
            <Button asChild><Link href="/dl/dmg/latest">Download for Mac →</Link></Button>
          </div>
          <p className="mt-2 text-hint text-ink-700/60">v0.1.0 · 537 MB · Apple Silicon</p>
          <div className="mt-6 border-t border-ink-900/10 pt-4">
            <p className="text-meta uppercase text-ink-700/60">Files</p>
            <ul className="mt-2 space-y-1 text-body-sm text-ink-700">
              <li>· <a href="/dl/dmg/latest" className="underline">Lisna-0.1.0.dmg</a></li>
              <li>· <a href="https://github.com/May1350/Lisna/releases" className="underline">ggml-large-v3-q5_0.bin (Whisper)</a></li>
              <li>· <a href="https://github.com/May1350/Lisna/releases" className="underline">Llama-3.2-3B-Instruct-Q4_K_M.gguf</a></li>
            </ul>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <p className="text-meta uppercase text-accent-tan">COMMUNITY</p>
            <h3 className="mt-2 font-serif text-grid-title text-ink-900">Discord</h3>
            <p className="mt-2 text-body-sm text-ink-700">Join the alpha channel for updates, support, and feedback.</p>
            <div className="mt-4">
              <Button asChild variant="text-arrow">
                <a href="https://discord.gg/69NkqBTbS" target="_blank" rel="noreferrer">Join the alpha channel →</a>
              </Button>
            </div>
          </Card>
          <Card>
            <p className="text-meta uppercase text-accent-tan">PLAN</p>
            <span className="mt-2 inline-block text-meta uppercase tracking-[0.12em] px-2 py-0.5 rounded-sm bg-margin-red/10 text-margin-red">FREE ALPHA</span>
            <p className="mt-3 font-serif text-display-2 text-ink-900">$0</p>
            <p className="text-body-sm text-ink-700/70">/ forever during alpha</p>
            <p className="mt-4 text-body-sm text-ink-700">We'll give you 30 days notice before pricing kicks in.</p>
          </Card>
        </div>
      </div>

      <Card className="mt-12">
        <p className="text-meta uppercase text-accent-tan">DEVICES</p>
        <h3 className="mt-2 font-serif text-grid-title text-ink-900">Connected Macs</h3>
        {devices.length === 0 ? (
          <p className="mt-4 text-body-sm text-ink-700/70">No devices yet. Open Lisna.app to register this Mac.</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink-900/10">
            {devices.map((d) => {
              const recent = d.lastSeenAt && new Date(d.lastSeenAt).getTime() > Date.now() - 1000 * 60 * 30;
              return (
                <li key={d.id} className="py-3 flex items-center gap-3 text-body-sm">
                  <span className={recent ? 'w-2 h-2 rounded-full bg-accent-sage' : 'w-2 h-2 rounded-full bg-ink-700/30'} />
                  <span className="flex-1 text-ink-900">{d.name ?? 'Mac'}</span>
                  <span className="text-ink-700/70">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}</span>
                  <form action={async () => {
                    'use server';
                    const { db } = await import('@/lib/db');
                    const { appDevices } = await import('@/db/schema');
                    const { and: a, eq: e } = await import('drizzle-orm');
                    await db.update(appDevices).set({ revokedAt: new Date() }).where(a(e(appDevices.id, d.id), e(appDevices.userId, session.user!.id!)));
                  }}>
                    <button type="submit" className="underline text-ink-700/70 hover:text-margin-red">sign out</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </DashboardShell>
  );
}
