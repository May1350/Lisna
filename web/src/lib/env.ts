import { z } from 'zod';

const envSchema = z.object({
  // Required at runtime
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // DB (Phase I)
  DATABASE_URL: z.string().url().optional(),                  // for local dev w/o IAM
  RDS_PROXY_ENDPOINT: z.string().min(1).optional(),           // prod: IAM-authed
  RDS_USERNAME: z.string().min(1).optional(),
  // Postgres database name. Local dev defaults to 'lisna' (matches MIGRATIONS.md
  // `createdb lisna` step). Prod RDS uses 'studyhelper' (shared with v1 backend,
  // see MIGRATIONS.md — v2 Auth.js tables augment the existing v1 users table).
  RDS_DB_NAME: z.string().min(1).default('lisna'),
  AWS_REGION: z.string().min(1).default('ap-northeast-1'),

  // Email (Phase J)
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().default('auth@lisna.jp'),

  // OAuth (Phase J)
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  APPLE_CLIENT_ID: z.string().min(1).optional(),
  APPLE_CLIENT_SECRET: z.string().min(1).optional(),  // JWT-signed, generated separately

  // Plausible
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().min(1).default('lisna.jp'),

  // GitHub Release (for /dl/dmg/latest redirect)
  GITHUB_OWNER: z.string().min(1).default('May1350'),
  GITHUB_REPO: z.string().min(1).default('Lisna'),
}).refine(
  // db.ts requires at least one path to be configured. Detect at boot/build
  // instead of at first request: keeps the failure visible in CI / Vercel deploy logs.
  (env) => Boolean(env.DATABASE_URL) || Boolean(env.RDS_PROXY_ENDPOINT && env.RDS_USERNAME),
  {
    message: 'DB misconfig: set DATABASE_URL (local dev) OR both RDS_PROXY_ENDPOINT + RDS_USERNAME (prod IAM)',
    path: ['DATABASE_URL'],
  },
);

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
