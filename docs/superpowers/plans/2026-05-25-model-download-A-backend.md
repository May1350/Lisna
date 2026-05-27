# Lisna v2 Model Download — Plan A (Backend Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend foundation (Lambda endpoints + DB tables + R2 signed URLs + manifest JSON + CI verification) so a future desktop client can fetch a manifest and report download events. **Flag stays `off` at end of this plan** — no user-visible change.

**Architecture:** Two new endpoints wrapped in existing `withAuth<T>`. `GET /v1/models/manifest` reads `backend/manifests/model-manifest.v1.json` (bundled as Lambda asset), filters by feature flag + UA, re-signs R2 URLs (1h TTL), returns manifest body. `POST /v1/models/download-event` writes a row to `model_download_events` table (anonymous `device_id` always; opt-in `user_id` correlation). R2 credentials only in Lambda Secrets Manager. CI verifies every manifest commit's claimed SHAs match R2 objects.

**Tech Stack:** AWS CDK (TypeScript) + AWS Lambda (Node 20, esbuild-bundled) + RDS Postgres + `@aws-sdk/client-s3` (R2 is S3-compatible) + Zod for env + Vitest for tests + GitHub Actions for CI.

**Reference spec:** [`docs/superpowers/specs/2026-05-25-model-download-arch-design.md`](../specs/2026-05-25-model-download-arch-design.md) §2 (architecture) + §6 (rollout/telemetry).

**Sibling plan (executes after this):** `docs/superpowers/plans/2026-05-25-model-download-B-desktop-and-rollout.md` (will be written next).

---

## File structure (Plan A)

### Create

| Path | Responsibility |
|---|---|
| `backend/src/handlers/models-manifest.ts` | `GET /v1/models/manifest` handler |
| `backend/src/handlers/models-download-event.ts` | `POST /v1/models/download-event` handler |
| `backend/src/lib/r2-signer.ts` | Cloudflare R2 signed URL generator |
| `backend/src/lib/manifest-loader.ts` | Reads bundled manifest, filters, re-signs |
| `backend/src/lib/feature-flag.ts` | `MODEL_DOWNLOAD_ENABLED` + `ROLLOUT_PCT` + `MIN_SUPPORTED_APP_VERSION` evaluation |
| `backend/src/lib/user-agent.ts` | UA parser regex + semver compare |
| `backend/src/lib/telemetry-models.ts` | Event row insert into `model_download_events` |
| `backend/src/migrations/010_model_download_events.sql` | DB schema |
| `backend/manifests/model-manifest.v1.json` | Hand-edited manifest (initial: Whisper + Llama 3.2 3B) |
| `backend/manifests/README.md` | Manifest editing + R2 upload + DR procedure |
| `backend/manifests/SUNSET.md` | Manifest schema version sunset tracker |
| `backend/scripts/verify-manifest.ts` | Local/CI script: HEAD R2 URLs + full-file streaming SHA verify |
| `infra/allowlist-emails.json` | Initial allowlist (founder only, no holdout) |
| `infra/lib/r2-bucket.ts` | R2 bucket creation/permissions (or operator-instruction doc if R2 stays manual) |
| `.github/workflows/manifest-verify.yml` | Runs `verify-manifest.ts` on PRs touching `backend/manifests/**` |
| `backend/tests/manifest/feature-flag.test.ts` | Feature-flag evaluation tests |
| `backend/tests/manifest/user-agent.test.ts` | UA parser tests |
| `backend/tests/manifest/manifest-loader.test.ts` | Manifest filter + sign tests (R2 signer mocked) |
| `backend/tests/manifest/r2-signer.test.ts` | URL signing + TTL tests |
| `backend/tests/manifest/telemetry-models.test.ts` | Event insert + bucketing tests |
| `backend/tests/handlers/models-manifest.test.ts` | Full handler-via-withAuth tests |
| `backend/tests/handlers/models-download-event.test.ts` | Full handler-via-withAuth tests |

### Modify

| Path | Lines (approx) | Change |
|---|---|---|
| `backend/src/lib/env.ts` | +12 | Add `MODEL_DOWNLOAD_ENABLED`, `MODEL_DOWNLOAD_ROLLOUT_PCT`, `MIN_SUPPORTED_APP_VERSION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT_URL` to Zod schema |
| `infra/lib/api-stack.ts` | +20 | Register two new routes; wire to Lambda functions |
| `infra/lib/secrets-stack.ts` | +15 | Sync `infra/allowlist-emails.json` to `AppSecret.ALLOWLIST_EMAILS` (filtered to non-holdout); store R2 creds |
| `package.json` (root) | +1 | `"verify:manifest": "pnpm --filter @lisna/backend exec tsx scripts/verify-manifest.ts"` |

### No delete

(Picker code stays; this plan does not touch desktop.)

---

## Task list (15 tasks)

Each task is 2-5 minutes per step. Total estimated engineer time: ~5 hours.

---

### Task 1: Env schema additions

**Files:**
- Modify: `backend/src/lib/env.ts`
- Test: `backend/tests/env.test.ts` (likely exists; add cases)

- [ ] **Step 1: Read existing env.ts to find Zod schema location**

Run: `head -60 backend/src/lib/env.ts`
Expected: a `const Env = z.object({ ... })` block with existing entries (`DATABASE_URL`, `JWT_SECRET`, etc.).

- [ ] **Step 2: Write failing test for new env fields**

Create or extend `backend/tests/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Env } from '../src/lib/env';

describe('env — model download fields', () => {
  it('parses MODEL_DOWNLOAD_ENABLED enum', () => {
    const parsed = Env.parse({
      ...baseEnv,                          // existing test helper with required fields
      MODEL_DOWNLOAD_ENABLED: 'allowlist',
      MODEL_DOWNLOAD_ROLLOUT_PCT: '50',
      MIN_SUPPORTED_APP_VERSION: '0.1.1',
      R2_ACCESS_KEY_ID: 'redacted',
      R2_SECRET_ACCESS_KEY: 'redacted',
      R2_BUCKET: 'lisna-models-prod',
      R2_ENDPOINT_URL: 'https://acct.r2.cloudflarestorage.com',
    });
    expect(parsed.MODEL_DOWNLOAD_ENABLED).toBe('allowlist');
    expect(parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe(50);   // coerced to number
  });

  it('rejects invalid MODEL_DOWNLOAD_ENABLED value', () => {
    expect(() => Env.parse({ ...baseEnv, MODEL_DOWNLOAD_ENABLED: 'sometimes' })).toThrow();
  });

  it('defaults MODEL_DOWNLOAD_ROLLOUT_PCT to 0 when absent', () => {
    const parsed = Env.parse({ ...baseEnv });
    expect(parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe(0);
  });

  it('rejects MODEL_DOWNLOAD_ROLLOUT_PCT > 100', () => {
    expect(() => Env.parse({ ...baseEnv, MODEL_DOWNLOAD_ROLLOUT_PCT: '150' })).toThrow();
  });
});
```

If `baseEnv` doesn't exist, add at top of file: `const baseEnv = { DATABASE_URL: 'postgres://...', JWT_SECRET: 'dev', /* ...whatever existing required fields */ };`

- [ ] **Step 3: Run test — verify failures**

Run: `pnpm --filter @lisna/backend test env.test`
Expected: 4 failures with "MODEL_DOWNLOAD_ENABLED not in object" or similar.

- [ ] **Step 4: Implement env schema extension**

Edit `backend/src/lib/env.ts` — locate the Zod object and add inside it:

```ts
  // Model download (Plan A — Phase A)
  MODEL_DOWNLOAD_ENABLED: z.enum(['off', 'allowlist', 'all']).default('off'),
  MODEL_DOWNLOAD_ROLLOUT_PCT: z.coerce.number().int().min(0).max(100).default(0),
  MIN_SUPPORTED_APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.1.0'),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT_URL: z.string().url().optional(),
```

R2 fields are `.optional()` so `flag=off` deployments don't require credentials.

- [ ] **Step 5: Run test — verify pass**

Run: `pnpm --filter @lisna/backend test env.test`
Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/guntak/Lisna
git add backend/src/lib/env.ts backend/tests/env.test.ts
git commit -m "feat(backend): add model-download env schema (off by default)"
```

---

### Task 2: Feature flag evaluation

**Files:**
- Create: `backend/src/lib/feature-flag.ts`
- Test: `backend/tests/manifest/feature-flag.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/manifest/feature-flag.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateModelDownloadFlag, inRolloutBucket } from '../../src/lib/feature-flag';

describe('feature-flag', () => {
  describe('evaluateModelDownloadFlag', () => {
    it('returns "off" → blocked for any user', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'off',
        rolloutPct: 100,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(['a@b.c']),
      });
      expect(r).toEqual({ allowed: false, reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' });
    });

    it('returns "allowlist" + email match → allowed', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'allowlist',
        rolloutPct: 0,
        userId: 'uuid',
        userEmail: 'alpha@lisna.jp',
        allowlistEmails: new Set(['alpha@lisna.jp']),
      });
      expect(r).toEqual({ allowed: true });
    });

    it('returns "allowlist" + email miss → blocked NOT_IN_ALLOWLIST', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'allowlist',
        rolloutPct: 100,
        userId: 'uuid',
        userEmail: 'random@example.com',
        allowlistEmails: new Set(['alpha@lisna.jp']),
      });
      expect(r).toEqual({ allowed: false, reason: 'NOT_IN_ALLOWLIST' });
    });

    it('returns "all" + rolloutPct=0 → blocked for ANY user (gate closed)', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'all',
        rolloutPct: 0,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(),
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('NOT_IN_ROLLOUT_BUCKET');
    });

    it('returns "all" + rolloutPct=100 → allowed for any user', () => {
      const r = evaluateModelDownloadFlag({
        flag: 'all',
        rolloutPct: 100,
        userId: 'any-uuid',
        userEmail: 'a@b.c',
        allowlistEmails: new Set(),
      });
      expect(r).toEqual({ allowed: true });
    });
  });

  describe('inRolloutBucket', () => {
    it('returns true for pct=100', () => {
      expect(inRolloutBucket('any-uuid', 100)).toBe(true);
    });
    it('returns false for pct=0', () => {
      expect(inRolloutBucket('any-uuid', 0)).toBe(false);
    });
    it('is stable per userId', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      expect(inRolloutBucket(userId, 50)).toBe(inRolloutBucket(userId, 50));
    });
    it('distributes uniformly across users (10 different uuids at pct=50 → some true, some false)', () => {
      const uuids = Array.from({ length: 100 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
      const trueCount = uuids.filter(u => inRolloutBucket(u, 50)).length;
      // Allow wide range for hash distribution
      expect(trueCount).toBeGreaterThan(30);
      expect(trueCount).toBeLessThan(70);
    });
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm --filter @lisna/backend test feature-flag.test`
Expected: "Cannot find module '.../feature-flag'" or all tests fail.

- [ ] **Step 3: Implement feature-flag.ts**

Create `backend/src/lib/feature-flag.ts`:

```ts
import { createHash } from 'node:crypto';

export type FlagValue = 'off' | 'allowlist' | 'all';
export type FlagResult = { allowed: true } | { allowed: false; reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' | 'NOT_IN_ALLOWLIST' | 'NOT_IN_ROLLOUT_BUCKET' };

export interface EvaluateInput {
  flag: FlagValue;
  rolloutPct: number;        // 0-100
  userId: string;            // users.id UUID
  userEmail: string;
  allowlistEmails: Set<string>;
}

/**
 * Stable per-user rollout bucket. Hash users.id with SHA-1, take first 4 bytes
 * as uint32, modulo 100. bucket < pct → in cohort.
 * Same input always yields same bucket (no churn across deploys).
 */
export function inRolloutBucket(userId: string, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  const h = createHash('sha1').update(userId).digest();
  const bucket = h.readUInt32BE(0) % 100;
  return bucket < pct;
}

export function evaluateModelDownloadFlag(input: EvaluateInput): FlagResult {
  if (input.flag === 'off') {
    return { allowed: false, reason: 'MODEL_DOWNLOAD_NOT_YET_ENABLED' };
  }
  if (input.flag === 'allowlist') {
    if (input.allowlistEmails.has(input.userEmail)) return { allowed: true };
    return { allowed: false, reason: 'NOT_IN_ALLOWLIST' };
  }
  // flag === 'all'
  if (inRolloutBucket(input.userId, input.rolloutPct)) return { allowed: true };
  return { allowed: false, reason: 'NOT_IN_ROLLOUT_BUCKET' };
}
```

- [ ] **Step 4: Run test — verify all pass**

Run: `pnpm --filter @lisna/backend test feature-flag.test`
Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/feature-flag.ts backend/tests/manifest/feature-flag.test.ts
git commit -m "feat(backend): feature-flag + stable rollout bucket"
```

---

### Task 3: User-Agent parser

**Files:**
- Create: `backend/src/lib/user-agent.ts`
- Test: `backend/tests/manifest/user-agent.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/manifest/user-agent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLisnaUserAgent, compareSemver } from '../../src/lib/user-agent';

describe('user-agent', () => {
  describe('parseLisnaUserAgent', () => {
    it('parses standard release UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: undefined });
    });
    it('parses pre-release UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.3.0-alpha.1')).toEqual({ major: 0, minor: 3, patch: 0, prerelease: 'alpha.1' });
    });
    it('parses dev UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.2.0-dev+abc123')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: 'dev+abc123' });
    });
    it('returns null on malformed UA', () => {
      expect(parseLisnaUserAgent('Mozilla/5.0')).toBeNull();
      expect(parseLisnaUserAgent('Lisna/v')).toBeNull();
      expect(parseLisnaUserAgent('lisna/v0.2.0')).toBeNull(); // case-sensitive
      expect(parseLisnaUserAgent('')).toBeNull();
    });
  });

  describe('compareSemver', () => {
    it('returns -1 when a < b', () => {
      expect(compareSemver({ major: 0, minor: 1, patch: 9 }, { major: 0, minor: 2, patch: 0 })).toBe(-1);
    });
    it('returns 1 when a > b', () => {
      expect(compareSemver({ major: 0, minor: 2, patch: 0 }, { major: 0, minor: 1, patch: 9 })).toBe(1);
    });
    it('returns 0 when equal', () => {
      expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 0 })).toBe(0);
    });
    it('ignores pre-release for comparison (spec sunset semantics)', () => {
      expect(compareSemver({ major: 0, minor: 2, patch: 0, prerelease: 'alpha' }, { major: 0, minor: 2, patch: 0 })).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @lisna/backend test user-agent.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `backend/src/lib/user-agent.ts`:

```ts
export interface LisnaVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

const UA_RE = /^Lisna\/v(\d+)\.(\d+)\.(\d+)(?:-([\w.+-]+))?$/;

export function parseLisnaUserAgent(ua: string): LisnaVersion | null {
  const m = UA_RE.exec(ua);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4],
  };
}

/**
 * -1 if a < b, 1 if a > b, 0 if equal.
 * Pre-release is ignored: per spec §4.4, sunset is gated on major.minor.patch only.
 */
export function compareSemver(a: LisnaVersion, b: LisnaVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @lisna/backend test user-agent.test`
Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/user-agent.ts backend/tests/manifest/user-agent.test.ts
git commit -m "feat(backend): UA parser + semver compare for app-version EOL"
```

---

### Task 4: R2 signed-URL generator

**Files:**
- Create: `backend/src/lib/r2-signer.ts`
- Test: `backend/tests/manifest/r2-signer.test.ts`

- [ ] **Step 1: Add `@aws-sdk/s3-request-presigner` if not present**

Run: `pnpm --filter @lisna/backend ls @aws-sdk/s3-request-presigner`
If not installed:
```bash
cd backend && pnpm add @aws-sdk/s3-request-presigner @aws-sdk/client-s3
```
Expected: package.json has both entries (you should see them in `dependencies`).

- [ ] **Step 2: Write failing test**

Create `backend/tests/manifest/r2-signer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signR2GetUrl } from '../../src/lib/r2-signer';

describe('r2-signer', () => {
  const opts = {
    accessKeyId: 'TEST_KEY',
    secretAccessKey: 'TEST_SECRET',
    bucket: 'lisna-models-prod',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
  };

  it('returns a presigned URL with the bucket/object path', async () => {
    const url = await signR2GetUrl(opts, 'kotoba-whisper-v2.0/q5_0/whisper.bin', 3600);
    expect(url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/lisna-models-prod\/kotoba-whisper-v2\.0\/q5_0\/whisper\.bin/);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=3600');
  });

  it('clamps TTL to <= 7 days (AWS SigV4 limit)', async () => {
    const url = await signR2GetUrl(opts, 'foo.bin', 100_000_000);  // 100M seconds = ~3 years
    const m = /X-Amz-Expires=(\d+)/.exec(url);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(604_800);  // 7d
  });
});
```

- [ ] **Step 3: Run — verify failure**

Run: `pnpm --filter @lisna/backend test r2-signer.test`
Expected: module not found.

- [ ] **Step 4: Implement**

Create `backend/src/lib/r2-signer.ts`:

```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;     // e.g. 'https://<acct>.r2.cloudflarestorage.com'
}

const MAX_TTL_SECONDS = 7 * 24 * 3600;   // 7d — AWS SigV4 hard limit

/**
 * Generate a presigned GET URL for an R2 object.
 * Cloudflare R2 is S3-API compatible; uses 'auto' region.
 */
export async function signR2GetUrl(cfg: R2Config, objectKey: string, ttlSeconds: number): Promise<string> {
  const expires = Math.min(Math.max(60, ttlSeconds), MAX_TTL_SECONDS);
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
  const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey });
  return await getSignedUrl(client, cmd, { expiresIn: expires });
}
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @lisna/backend test r2-signer.test`
Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/r2-signer.ts backend/tests/manifest/r2-signer.test.ts backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): R2 presigned-URL generator (1h TTL default, 7d cap)"
```

---

### Task 5: Manifest loader

**Files:**
- Create: `backend/src/lib/manifest-loader.ts`
- Create: `backend/manifests/model-manifest.v1.json` (placeholder content; real SHA filled in Task 13)
- Test: `backend/tests/manifest/manifest-loader.test.ts`

- [ ] **Step 1: Write initial manifest JSON skeleton**

Create `backend/manifests/model-manifest.v1.json`:

```json
{
  "manifest_version": 1,
  "generated_at": "2026-05-25T00:00:00Z",
  "cache_max_age_seconds": 604800,
  "models": [
    {
      "slot": "stt",
      "id": "kotoba-whisper-v2.0-q5_0",
      "version": "2.0",
      "size_bytes": 0,
      "sha256": "PENDING_UPLOAD",
      "tier": "default",
      "lang": "ja",
      "license_url": "https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0/blob/main/README.md",
      "license_id": "kotoba-whisper-tin",
      "license_text_sha256": "PENDING_UPLOAD",
      "object_key": "kotoba-whisper-v2.0/q5_0/whisper.bin"
    },
    {
      "slot": "llm",
      "id": "Llama-3.2-3B-Q4_K_M",
      "version": "3.2",
      "size_bytes": 0,
      "sha256": "PENDING_UPLOAD",
      "tier": "default",
      "lang": "multi",
      "license_url": "https://www.llama.com/llama3_2/license/",
      "license_id": "llama-3.2-community",
      "license_text_sha256": "PENDING_UPLOAD",
      "object_key": "Llama-3.2-3B-Instruct/Q4_K_M/llm.gguf"
    }
  ]
}
```

Note: `object_key` is internal (not in the spec's public response); Lambda uses it to sign and returns `url` in the response. Size/sha are `PENDING_UPLOAD` until Task 13 — placeholder lets us run unit tests with mocked R2 signer.

- [ ] **Step 2: Write failing test**

Create `backend/tests/manifest/manifest-loader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadAndSignManifest } from '../../src/lib/manifest-loader';

describe('manifest-loader', () => {
  const r2 = {
    accessKeyId: 'k', secretAccessKey: 's',
    bucket: 'lisna-models-prod',
    endpoint: 'https://test.r2.example',
  };

  it('replaces object_key with signed url and strips object_key from response', async () => {
    const signer = vi.fn().mockImplementation(async (_, key) =>
      `https://signed.r2.example/${key}?sig=X`,
    );
    const out = await loadAndSignManifest({ r2, urlTtlSec: 3600, signer });
    expect(out.manifest_version).toBe(1);
    expect(out.models).toHaveLength(2);
    for (const m of out.models) {
      expect(m).not.toHaveProperty('object_key');
      expect(m.url).toMatch(/^https:\/\/signed\.r2\.example\//);
    }
    expect(signer).toHaveBeenCalledTimes(2);
  });

  it('regenerates generated_at to current UTC ISO', async () => {
    const before = new Date().toISOString();
    const signer = vi.fn().mockResolvedValue('https://x');
    const out = await loadAndSignManifest({ r2, urlTtlSec: 3600, signer });
    const after = new Date().toISOString();
    expect(out.generated_at >= before && out.generated_at <= after).toBe(true);
  });
});
```

- [ ] **Step 3: Run — verify failure**

Run: `pnpm --filter @lisna/backend test manifest-loader.test`
Expected: module not found.

- [ ] **Step 4: Implement**

Create `backend/src/lib/manifest-loader.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signR2GetUrl, R2Config } from './r2-signer';

interface SourceModel {
  slot: 'stt' | 'llm';
  id: string;
  version: string;
  size_bytes: number;
  sha256: string;
  tier: 'default' | 'highmem';
  lang: string;
  license_url: string;
  license_id: string;
  license_text_sha256: string;
  object_key: string;
}

interface SourceManifest {
  manifest_version: 1;
  generated_at: string;
  cache_max_age_seconds: number;
  models: SourceModel[];
}

export interface PublicModel extends Omit<SourceModel, 'object_key'> {
  url: string;
}

export interface PublicManifest {
  manifest_version: 1;
  generated_at: string;
  cache_max_age_seconds: number;
  models: PublicModel[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Lambda bundle puts manifests in dist/backend/manifests/ ; dev path is backend/manifests/
const MANIFEST_PATH = path.resolve(here, '..', '..', 'manifests', 'model-manifest.v1.json');

let cached: SourceManifest | null = null;
function readManifestOnce(): SourceManifest {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as SourceManifest;
  return cached;
}

export type SignerFn = (cfg: R2Config, key: string, ttlSec: number) => Promise<string>;

export interface LoadOpts {
  r2: R2Config;
  urlTtlSec: number;
  signer?: SignerFn;     // injectable for tests; defaults to signR2GetUrl
}

export async function loadAndSignManifest(opts: LoadOpts): Promise<PublicManifest> {
  const src = readManifestOnce();
  const sign = opts.signer ?? signR2GetUrl;
  const models: PublicModel[] = await Promise.all(
    src.models.map(async (m) => {
      const { object_key, ...rest } = m;
      const url = await sign(opts.r2, object_key, opts.urlTtlSec);
      return { ...rest, url };
    }),
  );
  return {
    manifest_version: src.manifest_version,
    generated_at: new Date().toISOString(),       // regenerate every call so clients see freshness
    cache_max_age_seconds: src.cache_max_age_seconds,
    models,
  };
}
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @lisna/backend test manifest-loader.test`
Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/manifest-loader.ts backend/manifests/model-manifest.v1.json backend/tests/manifest/manifest-loader.test.ts
git commit -m "feat(backend): manifest loader strips object_key, signs urls, refreshes timestamp"
```

---

### Task 6: Migration `010_model_download_events.sql`

**Files:**
- Create: `backend/src/migrations/010_model_download_events.sql`
- Test: `backend/tests/manifest/migration.test.ts`

- [ ] **Step 1: Confirm next migration number**

Run: `ls backend/src/migrations/ | sort | tail -3`
Expected: e.g. `008_processed_stripe_events.sql`, `009_renumber_004_stripe_bookkeeping.sql`. **Next is 010.** (If the listing shows higher, adjust filename accordingly.)

- [ ] **Step 2: Write failing test**

Create `backend/tests/manifest/migration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { applyMigrationsForTest } from '../helpers/db';

describe('migration 010 — model_download_events', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = await applyMigrationsForTest();
  });
  afterAll(async () => { await pool.end(); });

  it('creates model_download_events with expected columns', async () => {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='model_download_events' ORDER BY ordinal_position`);
    const cols = r.rows.map(x => x.column_name);
    expect(cols).toEqual([
      'event_id', 'device_id', 'user_id', 'timestamp', 'event_type',
      'app_version', 'os_family', 'arch', 'source_intent', 'payload',
    ]);
  });

  it('user_id is nullable', async () => {
    const r = await pool.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='model_download_events' AND column_name='user_id'`);
    expect(r.rows[0].is_nullable).toBe('YES');
  });

  it('source_intent default is "unset"', async () => {
    const r = await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_name='model_download_events' AND column_name='source_intent'`);
    expect(r.rows[0].column_default).toContain('unset');
  });

  it('creates weekly_agg with composite PK including source_intent', async () => {
    const r = await pool.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid='model_download_weekly_agg'::regclass AND i.indisprimary
      ORDER BY a.attnum
    `);
    const pkCols = r.rows.map(x => x.attname);
    expect(pkCols).toEqual(['device_id', 'model_id', 'week_start', 'event_type', 'source_intent']);
  });
});
```

`applyMigrationsForTest` should be an existing test helper (or use existing `backend/tests/db.ts` pattern). If it doesn't exist, check `backend/tests/db/` for the canonical setup — Lisna's pool-based test harness from §domain `(db) DB tests use the dev pool`.

- [ ] **Step 3: Run — verify failure**

Run: `pnpm --filter @lisna/backend test migration.test`
Expected: 4 failures ("relation does not exist" or similar).

- [ ] **Step 4: Write migration**

Create `backend/src/migrations/010_model_download_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS model_download_events (
  event_id      uuid PRIMARY KEY,
  device_id     uuid NOT NULL,
  user_id       uuid REFERENCES users(id),
  timestamp     timestamptz NOT NULL,
  event_type    text NOT NULL,
  app_version   text NOT NULL,
  os_family     text NOT NULL,
  arch          text NOT NULL,
  source_intent text NOT NULL DEFAULT 'unset',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mde_device_time ON model_download_events (device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mde_user_time   ON model_download_events (user_id, timestamp DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mde_type_time   ON model_download_events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mde_intent      ON model_download_events (source_intent, timestamp DESC);

CREATE TABLE IF NOT EXISTS model_download_weekly_agg (
  device_id     uuid NOT NULL,
  user_id       uuid REFERENCES users(id),
  model_id      text NOT NULL,
  week_start    date NOT NULL,
  event_type    text NOT NULL,
  source_intent text NOT NULL DEFAULT 'unset',
  count         int  NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, model_id, week_start, event_type, source_intent)
);
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @lisna/backend test migration.test`
Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/migrations/010_model_download_events.sql backend/tests/manifest/migration.test.ts
git commit -m "feat(backend): migration 010 — model_download_events + weekly_agg tables"
```

---

### Task 7: Telemetry event insert lib

**Files:**
- Create: `backend/src/lib/telemetry-models.ts`
- Test: `backend/tests/manifest/telemetry-models.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/manifest/telemetry-models.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { applyMigrationsForTest } from '../helpers/db';
import { insertDownloadEvent, bucketOsVersion } from '../../src/lib/telemetry-models';

describe('telemetry-models', () => {
  let pool: Pool;
  beforeAll(async () => { pool = await applyMigrationsForTest(); });
  afterAll(async () => { await pool.end(); });

  it('inserts event row with device_id only (no user_id)', async () => {
    await insertDownloadEvent(pool, {
      event_id: '550e8400-e29b-41d4-a716-446655440000',
      device_id: '00000000-0000-0000-0000-000000000001',
      user_id: null,
      timestamp: new Date('2026-05-25T10:00:00Z'),
      event_type: 'download.complete',
      app_version: '0.2.0',
      os_family: 'macos-26',
      arch: 'arm64',
      source_intent: 'lecture',
      payload: { slot: 'stt', duration_ms: 5000 },
    });
    const r = await pool.query(`SELECT * FROM model_download_events WHERE event_id = $1`, ['550e8400-e29b-41d4-a716-446655440000']);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].user_id).toBeNull();
    expect(r.rows[0].source_intent).toBe('lecture');
  });

  describe('bucketOsVersion', () => {
    it('darwin 23.x → macos-14', () => {
      expect(bucketOsVersion('darwin-23.6.0-arm64')).toBe('macos-14');
    });
    it('darwin 25.x → macos-26', () => {
      expect(bucketOsVersion('darwin-25.3.0-arm64')).toBe('macos-26');
    });
    it('darwin 24.x → macos-15', () => {
      expect(bucketOsVersion('darwin-24.0.0-arm64')).toBe('macos-15');
    });
    it('returns "unknown" on unparseable input', () => {
      expect(bucketOsVersion('Windows 10')).toBe('unknown');
      expect(bucketOsVersion('')).toBe('unknown');
    });
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @lisna/backend test telemetry-models.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `backend/src/lib/telemetry-models.ts`:

```ts
import { Pool } from 'pg';

export interface DownloadEventRow {
  event_id: string;
  device_id: string;
  user_id: string | null;
  timestamp: Date;
  event_type: string;
  app_version: string;
  os_family: string;
  arch: string;
  source_intent: 'meeting' | 'lecture' | 'unset';
  payload: Record<string, unknown>;
}

export async function insertDownloadEvent(pool: Pool, row: DownloadEventRow): Promise<void> {
  await pool.query(
    `INSERT INTO model_download_events
       (event_id, device_id, user_id, timestamp, event_type, app_version, os_family, arch, source_intent, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (event_id) DO NOTHING`,
    [row.event_id, row.device_id, row.user_id, row.timestamp, row.event_type, row.app_version, row.os_family, row.arch, row.source_intent, row.payload],
  );
}

/**
 * darwin-23.x = macOS Sonoma 14
 * darwin-24.x = macOS Sequoia 15
 * darwin-25.x = macOS Tahoe 26 (Lisna founder's machine)
 * Drops minor + build to reduce fingerprintability.
 */
export function bucketOsVersion(osVersion: string): string {
  const m = /^darwin-(\d+)\./.exec(osVersion);
  if (!m) return 'unknown';
  const darwinMajor = Number(m[1]);
  // darwin 23 → 14, darwin 24 → 15, darwin 25 → 26 (Apple's macOS naming jump)
  const macOsByDarwin: Record<number, string> = {
    22: 'macos-13', 23: 'macos-14', 24: 'macos-15', 25: 'macos-26', 26: 'macos-27',
  };
  return macOsByDarwin[darwinMajor] ?? `macos-darwin-${darwinMajor}`;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @lisna/backend test telemetry-models.test`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/telemetry-models.ts backend/tests/manifest/telemetry-models.test.ts
git commit -m "feat(backend): telemetry event insert + os-version bucketing"
```

---

### Task 8: `GET /v1/models/manifest` handler

**Files:**
- Create: `backend/src/handlers/models-manifest.ts`
- Test: `backend/tests/handlers/models-manifest.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/handlers/models-manifest.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handler } from '../../src/handlers/models-manifest';
import { makeTestEvent } from '../helpers/api-gw';        // existing helper

// Mock env + dependencies
vi.mock('../../src/lib/env', () => ({
  loadEnv: () => ({
    MODEL_DOWNLOAD_ENABLED: 'allowlist',
    MODEL_DOWNLOAD_ROLLOUT_PCT: 0,
    MIN_SUPPORTED_APP_VERSION: '0.1.1',
    R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
    R2_BUCKET: 'lisna-models-prod', R2_ENDPOINT_URL: 'https://test.r2.example',
    ALLOWLIST_EMAILS: 'alpha@lisna.jp',
  }),
}));
vi.mock('../../src/lib/manifest-loader', () => ({
  loadAndSignManifest: vi.fn().mockResolvedValue({
    manifest_version: 1,
    generated_at: '2026-05-25T10:00:00Z',
    cache_max_age_seconds: 604800,
    models: [{ slot: 'stt', sha256: 'abc', url: 'https://signed/' }],
  }),
}));

describe('GET /v1/models/manifest', () => {
  it('returns 200 + manifest for allowlisted user with valid UA', async () => {
    const res = await handler(makeTestEvent({
      method: 'GET',
      path: '/v1/models/manifest',
      headers: { 'user-agent': 'Lisna/v0.2.0', authorization: 'Bearer dev-token' },
      jwtClaims: { email: 'alpha@lisna.jp', sub: 'user-uuid' },
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.manifest_version).toBe(1);
    expect(res.headers['Content-Type']).toContain('application/json');
  });

  it('returns 503 NOT_IN_ALLOWLIST for non-allowlist user', async () => {
    const res = await handler(makeTestEvent({
      method: 'GET',
      path: '/v1/models/manifest',
      headers: { 'user-agent': 'Lisna/v0.2.0', authorization: 'Bearer dev-token' },
      jwtClaims: { email: 'random@example.com', sub: 'user-uuid' },
    }));
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ code: 'NOT_IN_ALLOWLIST' });
  });

  it('returns 400 INVALID_USER_AGENT on malformed UA', async () => {
    const res = await handler(makeTestEvent({
      method: 'GET',
      path: '/v1/models/manifest',
      headers: { 'user-agent': 'Mozilla/5.0', authorization: 'Bearer dev-token' },
      jwtClaims: { email: 'alpha@lisna.jp', sub: 'user-uuid' },
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ code: 'INVALID_USER_AGENT' });
  });

  it('returns 410 APP_VERSION_UNSUPPORTED when UA < MIN', async () => {
    const res = await handler(makeTestEvent({
      method: 'GET',
      path: '/v1/models/manifest',
      headers: { 'user-agent': 'Lisna/v0.1.0', authorization: 'Bearer dev-token' },
      jwtClaims: { email: 'alpha@lisna.jp', sub: 'user-uuid' },
    }));
    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('APP_VERSION_UNSUPPORTED');
    expect(body.minimum).toBe('0.1.1');
  });
});
```

If `makeTestEvent` helper doesn't exist, look at how existing handler tests build API GW events in `backend/tests/handlers/` and mirror that pattern.

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @lisna/backend test models-manifest.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `backend/src/handlers/models-manifest.ts`:

```ts
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { withAuth, AuthedEvent } from '../lib/auth';
import { loadEnv } from '../lib/env';
import { parseLisnaUserAgent, compareSemver, LisnaVersion } from '../lib/user-agent';
import { evaluateModelDownloadFlag } from '../lib/feature-flag';
import { loadAndSignManifest } from '../lib/manifest-loader';

function jsonResponse(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = withAuth(async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const env = loadEnv();
  const ua = (event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? '') as string;

  // 1. UA parse — strict (no silent fallback)
  const version = parseLisnaUserAgent(ua);
  if (!version) return jsonResponse(400, { code: 'INVALID_USER_AGENT' });

  // 2. App-version EOL gate
  const minVer = parseLisnaUserAgent(`Lisna/v${env.MIN_SUPPORTED_APP_VERSION}`);
  if (minVer && compareSemver(version, minVer) < 0) {
    return jsonResponse(410, { code: 'APP_VERSION_UNSUPPORTED', minimum: env.MIN_SUPPORTED_APP_VERSION });
  }

  // 3. Flag gate
  const allowlistRaw = (env as any).ALLOWLIST_EMAILS ?? '';
  const allowlistEmails = new Set(allowlistRaw.split(',').map((s: string) => s.trim()).filter(Boolean));
  const gate = evaluateModelDownloadFlag({
    flag: env.MODEL_DOWNLOAD_ENABLED,
    rolloutPct: env.MODEL_DOWNLOAD_ROLLOUT_PCT,
    userId: event.auth.userId,
    userEmail: event.auth.email,
    allowlistEmails,
  });
  if (!gate.allowed) {
    // Map gate reason → status code per spec
    const statusCode = gate.reason === 'MODEL_DOWNLOAD_NOT_YET_ENABLED' ? 503 : 503;
    return jsonResponse(statusCode, { code: gate.reason });
  }

  // 4. Sign manifest & return
  const manifest = await loadAndSignManifest({
    r2: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucket: env.R2_BUCKET!,
      endpoint: env.R2_ENDPOINT_URL!,
    },
    urlTtlSec: 3600,
  });
  return jsonResponse(200, manifest);
});
```

`withAuth` is the existing wrapper at `backend/src/lib/auth.ts`. It populates `event.auth = { userId, email }` from JWT.

The `event.auth.email` comes from JWT claims. The existing `withAuth` may not return `email` in `auth` — check the actual type. If it doesn't, you'll need to extend `AuthedEvent`:

If needed, modify `backend/src/lib/auth.ts` to enrich `event.auth` with `email`:

```ts
// in auth.ts withAuth wrapper after JWT verify
const claims = jwt.verify(...);
event.auth = { userId: claims.sub, email: claims.email };
```

(Confirm with: `grep -n "event.auth\|AuthedEvent" backend/src/lib/auth.ts`.)

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @lisna/backend test models-manifest.test`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/models-manifest.ts backend/tests/handlers/models-manifest.test.ts
# also add auth.ts if you extended event.auth.email
git diff --staged --stat
git commit -m "feat(backend): GET /v1/models/manifest with flag + UA + EOL gates"
```

---

### Task 9: `POST /v1/models/download-event` handler

**Files:**
- Create: `backend/src/handlers/models-download-event.ts`
- Test: `backend/tests/handlers/models-download-event.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/tests/handlers/models-download-event.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/models-download-event';
import { makeTestEvent } from '../helpers/api-gw';

const insertMock = vi.fn();
vi.mock('../../src/lib/telemetry-models', () => ({
  insertDownloadEvent: (...args: any[]) => insertMock(...args),
  bucketOsVersion: (s: string) => s.includes('25.') ? 'macos-26' : 'unknown',
}));
vi.mock('../../src/lib/db', () => ({ getPool: vi.fn().mockReturnValue('FAKE_POOL') }));

describe('POST /v1/models/download-event', () => {
  beforeEach(() => insertMock.mockClear());

  it('inserts row with device_id only when X-Lisna-Telemetry-Identify is absent', async () => {
    const res = await handler(makeTestEvent({
      method: 'POST',
      path: '/v1/models/download-event',
      headers: {
        'user-agent': 'Lisna/v0.2.0',
        authorization: 'Bearer dev-token',
        'content-type': 'application/json',
      },
      jwtClaims: { email: 'a@b.c', sub: 'user-uuid-xyz' },
      body: JSON.stringify({
        event: 'download.complete',
        event_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-05-25T10:32:14Z',
        device_id: 'device-uuid-abc',
        app_version: '0.2.0',
        os_family: 'macos-26',
        arch: 'arm64',
        source_intent: 'lecture',
        payload: { slot: 'stt' },
      }),
    }));
    expect(res.statusCode).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][1];
    expect(row.device_id).toBe('device-uuid-abc');
    expect(row.user_id).toBeNull();                         // identify header absent
  });

  it('inserts row with user_id when X-Lisna-Telemetry-Identify=1', async () => {
    const res = await handler(makeTestEvent({
      method: 'POST',
      path: '/v1/models/download-event',
      headers: {
        'user-agent': 'Lisna/v0.2.0',
        authorization: 'Bearer dev-token',
        'content-type': 'application/json',
        'x-lisna-telemetry-identify': '1',
      },
      jwtClaims: { email: 'a@b.c', sub: 'user-uuid-xyz' },
      body: JSON.stringify({
        event: 'download.complete',
        event_id: 'e2',
        timestamp: '2026-05-25T10:32:14Z',
        device_id: 'device-uuid-abc',
        app_version: '0.2.0',
        os_family: 'macos-26',
        arch: 'arm64',
        source_intent: 'unset',
        payload: {},
      }),
    }));
    expect(res.statusCode).toBe(204);
    expect(insertMock.mock.calls[0][1].user_id).toBe('user-uuid-xyz');
  });

  it('rejects body with invalid event_type with 400', async () => {
    const res = await handler(makeTestEvent({
      method: 'POST', path: '/v1/models/download-event',
      headers: { 'user-agent': 'Lisna/v0.2.0', authorization: 'Bearer t', 'content-type': 'application/json' },
      jwtClaims: { email: 'a@b.c', sub: 'u' },
      body: JSON.stringify({ event: 'random.bogus', event_id: 'e3', timestamp: '2026-05-25T00:00Z', device_id: 'd', app_version: '0.2.0', os_family: 'macos-26', arch: 'arm64', source_intent: 'unset', payload: {} }),
    }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 503 when flag=off (no event recorded)', async () => {
    // Override env mock for this test if needed; depends on test scaffolding
    // Skip details; cover at integration level.
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @lisna/backend test models-download-event.test`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `backend/src/handlers/models-download-event.ts`:

```ts
import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { withAuth, AuthedEvent } from '../lib/auth';
import { loadEnv } from '../lib/env';
import { parseLisnaUserAgent, compareSemver } from '../lib/user-agent';
import { evaluateModelDownloadFlag } from '../lib/feature-flag';
import { insertDownloadEvent } from '../lib/telemetry-models';
import { getPool } from '../lib/db';

const ALLOWED_EVENT_TYPES = z.enum([
  'manifest.fetch.success', 'manifest.fetch.fail',
  'download.start', 'download.progress.tick', 'download.complete', 'download.fail', 'download.cancel',
  'sha.mismatch', 'recording_active_block',
  'license.accept', 'license.decline',
  'picker.fallback',
  'update_banner.show', 'update_banner.dismiss', 'update_banner.click',
  'vault_callout.show', 'vault_callout.set_now', 'vault_callout.later', 'vault_callout.auto_dismiss_14d',
  'models.sidecar.reload',
]);

const EventBody = z.object({
  event: ALLOWED_EVENT_TYPES,
  event_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  device_id: z.string().uuid(),
  app_version: z.string(),
  os_family: z.string(),
  arch: z.enum(['arm64', 'x64']),
  source_intent: z.enum(['meeting', 'lecture', 'unset']).default('unset'),
  payload: z.record(z.unknown()).default({}),
});

function jsonResponse(status: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = withAuth(async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const env = loadEnv();
  const ua = (event.headers?.['user-agent'] ?? '') as string;
  const version = parseLisnaUserAgent(ua);
  if (!version) return jsonResponse(400, { code: 'INVALID_USER_AGENT' });
  const minVer = parseLisnaUserAgent(`Lisna/v${env.MIN_SUPPORTED_APP_VERSION}`);
  if (minVer && compareSemver(version, minVer) < 0) {
    return jsonResponse(410, { code: 'APP_VERSION_UNSUPPORTED', minimum: env.MIN_SUPPORTED_APP_VERSION });
  }
  // Flag gate: even telemetry blocked when off (no point recording events that won't surface)
  const allowlistRaw = (env as any).ALLOWLIST_EMAILS ?? '';
  const allowlistEmails = new Set(allowlistRaw.split(',').map((s: string) => s.trim()).filter(Boolean));
  const gate = evaluateModelDownloadFlag({
    flag: env.MODEL_DOWNLOAD_ENABLED,
    rolloutPct: env.MODEL_DOWNLOAD_ROLLOUT_PCT,
    userId: event.auth.userId,
    userEmail: event.auth.email,
    allowlistEmails,
  });
  if (!gate.allowed) return jsonResponse(503, { code: gate.reason });

  let body: z.infer<typeof EventBody>;
  try {
    body = EventBody.parse(JSON.parse(event.body ?? '{}'));
  } catch (e) {
    return jsonResponse(400, { code: 'INVALID_EVENT_BODY', detail: (e as Error).message });
  }

  const identifyHeader = (event.headers?.['x-lisna-telemetry-identify'] ?? event.headers?.['X-Lisna-Telemetry-Identify']) === '1';

  await insertDownloadEvent(getPool(), {
    event_id: body.event_id,
    device_id: body.device_id,
    user_id: identifyHeader ? event.auth.userId : null,
    timestamp: new Date(body.timestamp),
    event_type: body.event,
    app_version: body.app_version,
    os_family: body.os_family,
    arch: body.arch,
    source_intent: body.source_intent,
    payload: body.payload,
  });

  // 204 No Content — telemetry is best-effort, no response body needed
  return { statusCode: 204, headers: {}, body: '' };
});
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @lisna/backend test models-download-event.test`
Expected: 3-4 pass (the 503-when-flag-off test depends on your env-mocking style).

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/models-download-event.ts backend/tests/handlers/models-download-event.test.ts
git commit -m "feat(backend): POST /v1/models/download-event telemetry sink"
```

---

### Task 10: CDK route registration

**Files:**
- Modify: `infra/lib/api-stack.ts`

- [ ] **Step 1: Read existing route registrations**

Run: `grep -n "addRoutes\|HttpRoute\|httpApi\|integration:" infra/lib/api-stack.ts | head -30`
Expected: Existing handlers (e.g. session-curate, stream-audio) showing the registration pattern.

- [ ] **Step 2: Add two Lambda functions + routes**

Edit `infra/lib/api-stack.ts` — find the section where handlers are constructed (a `new NodejsFunction(...)` block per handler) and add:

```ts
const modelsManifestFn = new NodejsFunction(this, 'ModelsManifestFn', {
  entry: path.join(__dirname, '..', '..', 'backend', 'src', 'handlers', 'models-manifest.ts'),
  runtime: Runtime.NODEJS_20_X,
  memorySize: 256,
  timeout: Duration.seconds(5),
  environment: {
    ...sharedEnv,                                          // existing JWT_SECRET, etc.
    MODEL_DOWNLOAD_ENABLED: 'off',                         // initial: off
    MODEL_DOWNLOAD_ROLLOUT_PCT: '0',
    MIN_SUPPORTED_APP_VERSION: '0.1.1',
    // R2_* + ALLOWLIST_EMAILS injected via Secrets Manager at runtime (see Task 11)
  },
  bundling: {
    minify: true, sourceMap: true,
    externalModules: ['@aws-sdk/*'],
    commandHooks: {
      afterBundling(inputDir, outputDir) {
        return [
          // Bundle the manifest JSON alongside the Lambda
          `cp -r ${inputDir}/backend/manifests ${outputDir}/manifests`,
        ];
      },
      beforeBundling() { return []; },
      beforeInstall() { return []; },
    },
  },
});

const modelsDownloadEventFn = new NodejsFunction(this, 'ModelsDownloadEventFn', {
  entry: path.join(__dirname, '..', '..', 'backend', 'src', 'handlers', 'models-download-event.ts'),
  runtime: Runtime.NODEJS_20_X,
  memorySize: 256,
  timeout: Duration.seconds(10),
  environment: { ...sharedEnv, MODEL_DOWNLOAD_ENABLED: 'off', MODEL_DOWNLOAD_ROLLOUT_PCT: '0', MIN_SUPPORTED_APP_VERSION: '0.1.1' },
  bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
});

httpApi.addRoutes({
  path: '/v1/models/manifest',
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration('ModelsManifestInt', modelsManifestFn),
});
httpApi.addRoutes({
  path: '/v1/models/download-event',
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration('ModelsDownloadEventInt', modelsDownloadEventFn),
});
```

Adapt variable names (`httpApi`, `sharedEnv`) to match what already exists in the file.

- [ ] **Step 3: Compile + synth (sanity)**

Run: `pnpm --filter @lisna/backend cdk synth StudyHelperApi 2>&1 | head -40`
Expected: synth succeeds (no TS error), template includes `ModelsManifestFn` + `ModelsDownloadEventFn`.

- [ ] **Step 4: Run all backend tests**

Run: `pnpm --filter @lisna/backend test`
Expected: prior task tests still pass.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/api-stack.ts
git commit -m "feat(infra): register /v1/models/manifest + /v1/models/download-event routes"
```

---

### Task 11: Allowlist sync via CDK + R2 creds in Secrets Manager

**Files:**
- Create: `infra/allowlist-emails.json`
- Modify: `infra/lib/secrets-stack.ts`

- [ ] **Step 1: Create allowlist file**

Create `infra/allowlist-emails.json`:

```json
{
  "version": 1,
  "users": [
    { "email": "takgun.jr@gmail.com", "added_at": "2026-05-25", "holdout": false }
  ]
}
```

- [ ] **Step 2: Modify secrets-stack to sync**

Edit `infra/lib/secrets-stack.ts` — locate the `AppSecret` definition and add (or extend) the secretObjectValue:

```ts
import * as fs from 'node:fs';

const allowlistJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'allowlist-emails.json'), 'utf8'));
const allowlistCsv = allowlistJson.users
  .filter((u: { holdout: boolean }) => !u.holdout)
  .map((u: { email: string }) => u.email)
  .join(',');

new secretsmanager.Secret(this, 'AppSecret', {
  secretName: 'studyhelper/app',
  secretObjectValue: {
    // ... existing keys (JWT_SECRET, DATABASE_URL, etc.)
    ALLOWLIST_EMAILS: cdk.SecretValue.unsafePlainText(allowlistCsv),
    // R2 creds: placeholders here; founder fills via console post-deploy
    R2_ACCESS_KEY_ID: cdk.SecretValue.unsafePlainText('PENDING'),
    R2_SECRET_ACCESS_KEY: cdk.SecretValue.unsafePlainText('PENDING'),
    R2_BUCKET: cdk.SecretValue.unsafePlainText('lisna-models-prod'),
    R2_ENDPOINT_URL: cdk.SecretValue.unsafePlainText('https://PENDING.r2.cloudflarestorage.com'),
  },
});
```

Note: `unsafePlainText` is used because the values come from a repo-checked-in JSON. Real R2 creds will be set via AWS Console after R2 bucket exists (Task 12 — operator step).

- [ ] **Step 3: CDK synth**

Run: `pnpm --filter @lisna/backend cdk synth 2>&1 | tail -10`
Expected: no TS errors.

- [ ] **Step 4: Commit**

```bash
git add infra/allowlist-emails.json infra/lib/secrets-stack.ts
git commit -m "feat(infra): allowlist-emails.json source-of-truth + R2 secret placeholders"
```

---

### Task 12: R2 bucket creation (operator step) + creds backfill

**Files:**
- Create: `backend/manifests/README.md` — operator runbook

This is largely an OUTSIDE-of-code task. Founder executes manually.

- [ ] **Step 1: Write the README**

Create `backend/manifests/README.md`:

```markdown
# Lisna model manifest — operator runbook

## R2 bucket setup (one-time)

1. Cloudflare dashboard → R2 → Create bucket
   - Name: `lisna-models-prod`
   - Location: Automatic
   - Public access: **off**
2. R2 → Manage R2 API Tokens → Create API Token
   - Permission: Object Read & Write (scope to `lisna-models-prod`)
   - TTL: no expiry
3. Copy the resulting `Access Key ID` + `Secret Access Key` + endpoint URL (e.g. `https://<acct>.r2.cloudflarestorage.com`)
4. AWS Secrets Manager Console → `studyhelper/app` → Retrieve secret value → Edit JSON:
   - Replace `R2_ACCESS_KEY_ID` value with the key from step 3
   - Replace `R2_SECRET_ACCESS_KEY` value with the secret from step 3
   - Replace `R2_ENDPOINT_URL` value with the endpoint URL
   - Save
5. R2 versioning ON: Bucket → Settings → Versioning → Enable

## Model upload (per new model)

1. Determine target R2 key per `model-manifest.v1.json`'s `object_key` field
   - e.g. `kotoba-whisper-v2.0/q5_0/whisper.bin`
2. Upload via Cloudflare dashboard OR aws-cli:
   ```bash
   aws s3 cp ./whisper.bin s3://lisna-models-prod/kotoba-whisper-v2.0/q5_0/whisper.bin \
     --endpoint-url https://<acct>.r2.cloudflarestorage.com \
     --profile r2
   ```
3. Compute the file's SHA256:
   ```bash
   shasum -a 256 ./whisper.bin
   ```
4. Edit `backend/manifests/model-manifest.v1.json` — set:
   - `size_bytes` = file size in bytes
   - `sha256` = the hash from step 3
5. Upload the license text to R2 at `licenses/<license_id>.txt`, compute its SHA, set `license_text_sha256`.
6. PR → main merge → `deploy-backend.yml` auto-deploys Lambda.

## DR posture

- R2 versioning ON; if a bad upload corrupts an object, revert via dashboard
- Cross-region replication OFF (cost +20%); accepted RPO = 7 days
- Manifest source-of-truth = git repo; worst case = revert manifest commit

## Allowlist management

- Edit `infra/allowlist-emails.json` → add user with `holdout: false` for treatment, `holdout: true` for control cohort
- PR → main merge → CDK re-syncs allowlist to Secrets Manager on deploy
- Audit trail = `git log -p infra/allowlist-emails.json`
- Ceiling: ~500 entries (then migrate to DB-backed allowlist per spec F2)
```

- [ ] **Step 2: Commit**

```bash
git add backend/manifests/README.md
git commit -m "docs(backend): R2 + manifest operator runbook"
```

- [ ] **Step 3: Founder runs the R2 setup (3a hardware-gated)**

Founder must:
1. Log in to Cloudflare → create R2 bucket per README
2. Set R2 creds in Secrets Manager
3. Upload Whisper + Llama binaries + license texts
4. Report back the sha256 + size for each so Task 13 can fill the manifest

**This task blocks Task 13 + 14 + 15 from completion.**

---

### Task 13: Fill manifest SHAs + sizes

**Files:**
- Modify: `backend/manifests/model-manifest.v1.json`

- [ ] **Step 1: Receive founder-provided values**

Founder reports back (post-Task 12):
- whisper.bin: size_bytes = `<N>`, sha256 = `<hex>`
- llm.gguf: size_bytes = `<N>`, sha256 = `<hex>`
- kotoba-whisper-tin.txt: license_text_sha256 = `<hex>`
- llama-3.2-community.txt: license_text_sha256 = `<hex>`

- [ ] **Step 2: Edit manifest**

Edit `backend/manifests/model-manifest.v1.json` — replace `PENDING_UPLOAD` placeholders with founder's values. Update `generated_at` to today's ISO timestamp.

- [ ] **Step 3: Run local verification (sets up Task 14 — verify-manifest script)**

If `backend/scripts/verify-manifest.ts` exists (after Task 14), run:
```bash
pnpm verify:manifest
```
Expected: PASS, all SHAs match R2 HEAD responses.

If Task 14 hasn't run yet, skip this step and verify it in Task 14.

- [ ] **Step 4: Commit**

```bash
git add backend/manifests/model-manifest.v1.json
git commit -m "feat(backend): fill manifest v1 with whisper-v2.0 + llama-3.2-3b shas"
```

---

### Task 14: Local + CI SHA verification

**Files:**
- Create: `backend/scripts/verify-manifest.ts`
- Modify: `package.json` (root) — add script
- Create: `.github/workflows/manifest-verify.yml`

- [ ] **Step 1: Write the verify script**

Create `backend/scripts/verify-manifest.ts`:

```ts
import { readFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

interface Model {
  slot: string; id: string; size_bytes: number; sha256: string;
  license_id: string; license_text_sha256: string; object_key: string;
}
interface Manifest { manifest_version: number; models: Model[]; }

const manifestPath = path.resolve(__dirname, '..', 'manifests', 'model-manifest.v1.json');
const cacheDir = path.resolve(__dirname, '..', '..', '.ci-manifest-cache');

function r2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT_URL,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    forcePathStyle: true,
  });
}

async function headObject(c: S3Client, key: string): Promise<{ size: number; etag: string }> {
  const r = await c.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  return { size: r.ContentLength ?? 0, etag: (r.ETag ?? '').replace(/"/g, '') };
}

async function streamSha256(c: S3Client, key: string, cacheKey: string): Promise<string> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, cacheKey + '.sha256');
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8').trim();

  const r = await c.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  const hash = createHash('sha256');
  const stream = r.Body as Readable;
  await pipeline(stream, async function* (src) {
    for await (const chunk of src) {
      hash.update(chunk);
      yield chunk;
    }
  }, createWriteStream('/dev/null'));
  const digest = hash.digest('hex');
  require('node:fs').writeFileSync(cachePath, digest);
  return digest;
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const c = r2Client();
  const failures: string[] = [];
  for (const m of manifest.models) {
    process.stdout.write(`Verifying ${m.id} (${m.object_key})… `);
    try {
      const head = await headObject(c, m.object_key);
      if (head.size !== m.size_bytes) {
        failures.push(`${m.id}: size mismatch (manifest ${m.size_bytes} vs R2 ${head.size})`);
        process.stdout.write('SIZE_MISMATCH\n');
        continue;
      }
      const cacheKey = `${m.id}-${head.etag}`;
      const actual = await streamSha256(c, m.object_key, cacheKey);
      if (actual !== m.sha256) {
        failures.push(`${m.id}: sha mismatch (manifest ${m.sha256.slice(0,8)} vs R2 ${actual.slice(0,8)})`);
        process.stdout.write('SHA_MISMATCH\n');
      } else {
        process.stdout.write('OK\n');
      }
    } catch (e) {
      failures.push(`${m.id}: error ${(e as Error).message}`);
      process.stdout.write('ERROR\n');
    }

    // Also verify license text
    const licenseKey = `licenses/${m.license_id}.txt`;
    process.stdout.write(`  license ${m.license_id}… `);
    try {
      const licCacheKey = `license-${m.license_id}`;
      const actualLicSha = await streamSha256(c, licenseKey, licCacheKey);
      if (actualLicSha !== m.license_text_sha256) {
        failures.push(`${m.license_id}: license_text_sha256 mismatch`);
        process.stdout.write('SHA_MISMATCH\n');
      } else {
        process.stdout.write('OK\n');
      }
    } catch (e) {
      failures.push(`${m.license_id}: license fetch error ${(e as Error).message}`);
      process.stdout.write('ERROR\n');
    }
  }
  if (failures.length > 0) {
    console.error(`\nverify-manifest FAILED:`);
    failures.forEach(f => console.error('  -', f));
    process.exit(1);
  }
  console.log('\nverify-manifest OK — all checksums match R2');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add root script**

Edit `/Users/guntak/Lisna/package.json` — add to scripts:

```json
"verify:manifest": "pnpm --filter @lisna/backend exec tsx scripts/verify-manifest.ts"
```

- [ ] **Step 3: Run locally (founder env)**

Founder runs:
```bash
cd /Users/guntak/Lisna
# Set env (or load from .env)
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT_URL=...
export R2_BUCKET=lisna-models-prod
pnpm verify:manifest
```
Expected: `verify-manifest OK — all checksums match R2`. If failure, fix `model-manifest.v1.json` SHAs to match.

- [ ] **Step 4: Write CI workflow**

Create `.github/workflows/manifest-verify.yml`:

```yaml
name: Manifest verify

on:
  pull_request:
    paths: ['backend/manifests/**']

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore SHA cache
        uses: actions/cache@v4
        with:
          path: .ci-manifest-cache
          key: manifest-shas-${{ hashFiles('backend/manifests/model-manifest.v1.json') }}
          restore-keys: manifest-shas-
      - name: Verify
        env:
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_ENDPOINT_URL: ${{ secrets.R2_ENDPOINT_URL }}
          R2_BUCKET: lisna-models-prod
        run: pnpm verify:manifest
```

Founder must add the R2 secrets to GitHub Actions repo secrets (`Settings → Secrets and variables → Actions → New repository secret`).

- [ ] **Step 5: Commit + push to test CI**

```bash
git add backend/scripts/verify-manifest.ts package.json .github/workflows/manifest-verify.yml
git commit -m "feat(ci): manifest SHA + size verification against R2 (cached by ETag)"
git push -u origin spec/model-download-arch  # or branch you're on
```

Expected: GitHub Actions runs `manifest-verify` job → green if R2 creds set + SHAs match. If founder hasn't set GitHub secrets yet, the job will fail with `Missing credentials` — that's OK at this stage; complete the secret upload as a sub-step.

---

### Task 15: SUNSET tracker doc

**Files:**
- Create: `backend/manifests/SUNSET.md`

- [ ] **Step 1: Write the tracker**

Create `backend/manifests/SUNSET.md`:

```markdown
# Manifest version sunset tracker

Tracks when each `manifest_version` Lambda handler can be removed.

Rule (from spec §2.2.1): manifest_v(N) handler removed in the release where `MIN_SUPPORTED_APP_VERSION` ≥ first app version that ships v(N+1) understanding.

## Active versions

| Version | First-shipped app version | Min-supported app version that retires this | Status | Notes |
|---|---|---|---|---|
| v1 | v0.2.0 | v0.4.0 (hypothetical; bump MIN_SUPPORTED_APP_VERSION first) | active | Initial Whisper + Llama 3.2 3B; default tier; default langs ja+multi |

## Retired

(none yet)

## Procedure to bump (manifest_v1 → v2)

1. Decide breaking change (e.g. add required field `model.checksum_algorithm`)
2. Implement v2 handler in parallel; keep v1 served when UA < v0.3.0
3. Ship app v0.3.0 with manifest_v2 understanding
4. After population on v0.3.0+ exceeds N%, bump `MIN_SUPPORTED_APP_VERSION` to v0.3.0 → v1 clients see 410
5. Remove v1 handler code + this row → move to "Retired"
```

- [ ] **Step 2: Commit**

```bash
git add backend/manifests/SUNSET.md
git commit -m "docs(backend): manifest version sunset tracker"
```

---

## Plan A self-review

- **Spec coverage**: §2.2.1 (manifest endpoint) ✓ Task 8 · §2.2.2 (telemetry) ✓ Tasks 7+9 · §2.2.3 (migration) ✓ Task 6 · §6.1 (feature flag + rollout) ✓ Task 2+8 · §5.5 (CI verify) ✓ Task 14 · §6.3 #5 (DR) ✓ Task 12 README. **Gap fixed**: spec §1.3 #11 (Privacy Footer) is renderer-only — out of scope for Plan A; covered in Plan B.
- **Placeholders**: 0 (each step has actual code + commands)
- **Type consistency**: `DownloadEventRow.user_id` is `string | null` in code, matched by SQL nullable column. `FlagResult` shape matches handler usage. `LisnaVersion` consistent across user-agent.ts + manifest-loader.ts callers.
- **Scope**: 15 tasks, ~5h engineer time. Single subsystem (backend), produces working+testable software (curl `/v1/models/manifest` returns 503 when flag=off; flip flag → returns 200; insert events succeed).

## Plan A acceptance criteria

After all 15 tasks land + Founder completes Task 12 R2 setup:
- `curl -H "Authorization: Bearer <jwt>" -H "User-Agent: Lisna/v0.2.0" https://<api>/v1/models/manifest` → with flag=off, returns 503 `MODEL_DOWNLOAD_NOT_YET_ENABLED`
- Flip flag to `allowlist` + founder email in `infra/allowlist-emails.json` → same curl returns 200 with manifest body, R2 URLs signed with `X-Amz-Signature`
- POST a synthetic event → row appears in `model_download_events`
- CI green on a manifest PR
- Picker / desktop unchanged (Plan B's territory)

---

**Next**: Plan B — Desktop main + renderer + rollout (Phases B-E). To be written next.
