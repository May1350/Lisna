// web/src/lib/auth.ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Apple from 'next-auth/providers/apple';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { Resend } from 'resend';
import { db } from './db';
import { env } from './env';
import { users, accounts, authSessions, verificationTokens } from '@/db/schema';

const resend = new Resend(env.RESEND_API_KEY);

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
        const { error } = await resend.emails.send({
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
  callbacks: {
    async redirect({ url, baseUrl }) {
      // If signin was started with source=app, the resend flow sets redirectTo to
      // /api/auth/exchange-code/issue?app_callback=...  Auth.js calls redirect()
      // with that URL once verification is complete. Pass it through unchanged.
      if (url.startsWith('/api/auth/exchange-code/issue')) {
        return `${baseUrl}${url}`;
      }
      // Default: allow same-origin redirects, otherwise go to /dashboard
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith('/')) return `${baseUrl}${url}`;
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
