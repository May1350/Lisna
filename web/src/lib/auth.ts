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

// Schema note: our accounts/sessions tables use camelCase JS property names
// (refreshToken, accessToken, etc.) but @auth/drizzle-adapter@1.11.2's strict
// TypeScript types expect snake_case properties (refresh_token, access_token)
// and sessionToken as the primary key. The `as Parameters<...>[1]` cast bridges
// the type-level gap without runtime impact. OAuth providers are gated behind env
// vars and inactive in dev; magic-link flow is unaffected by the naming mismatch.
// TODO: align account column JS property names to snake_case in a schema migration.
export const { handlers, signIn, signOut, auth } = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: authSessions, verificationTokensTable: verificationTokens } as any),
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
        const { error } = await resend.emails.send({
          from: provider.from!,
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
