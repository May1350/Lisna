// web/src/lib/auth.ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Apple from 'next-auth/providers/apple';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { Resend } from 'resend';
import { db } from './db';
import { env } from './env';
import { users, accounts, authSessions, verificationTokens } from '@/db/schema';

/**
 * Provider profile shape narrowed to the fields we read for the users.name
 * backfill. Auth.js v5 hands `profile` to `events.signIn` as a provider-
 * dependent record; we only touch `name` (Google + GitHub when full-name is
 * set) and `login` (GitHub username fallback when full-name is null).
 */
export type ProviderProfile =
  | { name?: string | null; login?: string | null }
  | undefined
  | null;

/**
 * Decide whether to backfill `users.name` from an OAuth profile after sign-in.
 *
 * Returns the candidate name string if a backfill should happen, else `null`.
 *
 * Why this exists (F-O-10): Auth.js v5's `linkAccount` adapter method does
 * not update `users.name` when linking a new OAuth provider to an existing
 * user — so users who signed up via magic-link end up with `name = null`
 * even after later linking Google/GitHub. The dashboard then renders the
 * email instead of a friendly display name.
 */
export function resolveProviderName(
  profile: ProviderProfile,
  currentName: string | null | undefined,
): string | null {
  if (currentName) return null;
  // Prefer profile.name (Google always provides; GitHub provides if user set
  // it publicly). Fall back to GitHub's `login` (username) when no name.
  const candidate = profile?.name || profile?.login;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

// Lazy: defer Resend client construction to the first send call, so the
// Next.js build (which evaluates this module at collect-page-data time)
// doesn't fail when RESEND_API_KEY is unset. Throws a useful error at
// send-time if the key is missing — which is the actual operational
// failure point (the magic-link flow won't work without it), not the
// build.
const getResend = (() => {
  let cached: Resend | null = null;
  return () => {
    if (cached) return cached;
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured — set it in Vercel env to enable magic-link sign-in');
    }
    cached = new Resend(env.RESEND_API_KEY);
    return cached;
  };
})();

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: authSessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  secret: env.NEXTAUTH_SECRET,
  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })]
      : []),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? [GitHub({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET })]
      : []),
    ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? [Apple({ clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET })]
      : []),
    {
      id: 'resend',
      name: 'Email',
      type: 'email',
      maxAge: 60 * 10, // 10 minutes
      from: env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        if (!provider.from) throw new Error('EMAIL_FROM not configured');
        const { error } = await getResend().emails.send({
          from: provider.from,
          to: email,
          subject: 'Sign in to Lisna',
          html: magicLinkHtml(url),
          text: `Sign in to Lisna: ${url}`,
        });
        if (error) throw new Error(`Resend send failed: ${error.message}`);
      },
    },
  ],
  pages: {
    signIn: '/signin',
    verifyRequest: '/signin?check-email=1',
    error: '/signin?error=1',
  },
  events: {
    /**
     * Backfill `users.name` from the OAuth profile on every sign-in (F-O-10).
     * Best-effort: any failure is logged but does not block sign-in (events
     * are post-success hooks).
     */
    async signIn({ user, profile }) {
      if (!user.id) return;
      const newName = resolveProviderName(profile as ProviderProfile, user.name);
      if (!newName) return;
      try {
        await db.update(users).set({ name: newName }).where(eq(users.id, user.id));
      } catch (err) {
        // Don't fail sign-in if backfill fails — it'll retry on the next sign-in.
        console.error('[auth] users.name backfill failed', err);
      }
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Phase K source=app flow: keep the exchange-code URL intact even when passed relative.
      // (Auth.js usually absolutizes redirectTo before calling this callback, but checking the
      // relative form here keeps the handshake working if the upstream behavior changes.)
      if (url.startsWith('/api/auth/exchange-code/issue')) {
        return `${baseUrl}${url}`;
      }
      // Allow same-origin redirects via origin comparison (not prefix match — `lisna.jp.evil.com`
      // starts with `lisna.jp` and a naive startsWith opens a CVE-class subdomain open-redirect).
      try {
        const baseOrigin = new URL(baseUrl).origin;
        const urlOrigin = new URL(url).origin;
        if (urlOrigin === baseOrigin) return url;
      } catch {
        // url was not absolute — fall through to the relative-path branch
      }
      // Allow relative paths only — explicitly reject protocol-relative `//host` form.
      if (url.startsWith('/') && !url.startsWith('//')) {
        return `${baseUrl}${url}`;
      }
      // Anything else: ignore the requested URL, fall back to the default landing page.
      return `${baseUrl}/dashboard`;
    },
  },
});

function magicLinkHtml(url: string): string {
  return `
<!doctype html>
<html><body style="font-family: -apple-system, sans-serif; background:#f8f3e9; padding:40px;">
  <div style="max-width:520px; margin:0 auto; background:#fefbf5; border:1px solid rgba(26,20,16,0.1); border-radius:8px; padding:32px;">
    <h1 style="font-family: Georgia, serif; font-weight:400; color:#1a1410; font-size:24px; margin:0 0 16px;">Sign in to Lisna</h1>
    <p style="color:#3a3025; line-height:1.6;">Click the button below to sign in. This link expires in 10 minutes.</p>
    <a href="${url}" style="display:inline-block; background:#1a1410; color:#f8f3e9; padding:14px 24px; border-radius:6px; text-decoration:none; margin:24px 0;">Sign in</a>
    <p style="color:#3a3025; font-size:13px; line-height:1.5;">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>
`;
}
