import { z } from 'zod';

const envSchema = z.object({
  // Required at runtime
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // DB (Phase I)
  DATABASE_URL: z.string().url().optional(),       // for local dev w/o IAM
  RDS_PROXY_ENDPOINT: z.string().optional(),       // prod: IAM-authed
  RDS_USERNAME: z.string().optional(),
  AWS_REGION: z.string().default('ap-northeast-1'),

  // Email (Phase J)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('auth@lisna.jp'),

  // OAuth (Phase J)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),  // JWT-signed, generated separately

  // Plausible
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().default('lisna.jp'),

  // GitHub Release (for /dl/dmg/latest redirect)
  GITHUB_OWNER: z.string().default('May1350'),
  GITHUB_REPO: z.string().default('Lisna'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
