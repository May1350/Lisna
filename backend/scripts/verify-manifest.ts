// CI verification script for model-manifest.v1.json.
//
// For each model entry:
//   1. HEAD the R2 object_key — compare Content-Length to size_bytes.
//   2. Streaming SHA256 of the full file — compare to sha256 field.
//   3. HEAD + SHA256 of licenses/<license_id>.txt — compare to license_text_sha256.
//
// Caches results by <id>-<etag> inside .ci-manifest-cache/ so repeated
// CI runs on an unchanged manifest skip the expensive streaming step.
//
// Exit 0 when all entries pass OR the manifest only has PENDING_UPLOAD
// placeholders (A13 not yet complete). Exit 1 on real mismatches.
//
// Required env vars:
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, R2_BUCKET
//
// Usage from backend/:
//   pnpm tsx scripts/verify-manifest.ts

import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelEntry {
  slot: string;
  id: string;
  version: string;
  size_bytes: number;
  sha256: string;
  tier: string;
  lang: string;
  license_url: string;
  license_id: string;
  license_text_sha256: string;
  object_key: string;
}

interface Manifest {
  manifest_version: number;
  generated_at: string;
  models: ModelEntry[];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_DIR = join(__dirname, '..', '.ci-manifest-cache');

function cacheKey(id: string, etag: string): string {
  // etag may contain quotes — strip them for a safe filename
  return `${id}-${etag.replace(/[^a-zA-Z0-9_\-.]/g, '_')}`;
}

function readCache(key: string): string | null {
  const p = join(CACHE_DIR, key);
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return null;
}

function writeCache(key: string, sha256: string): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, key), sha256 + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function makeS3Client(): S3Client {
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  const endpoint = process.env['R2_ENDPOINT_URL'];

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      'Missing required env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL',
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ contentLength: number; etag: string }> {
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  const contentLength = res.ContentLength ?? 0;
  const etag = (res.ETag ?? '').replace(/"/g, '');
  return { contentLength, etag };
}

async function streamingSha256(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  if (!res.Body) throw new Error(`Empty body for key: ${key}`);

  const hash = createHash('sha256');
  for await (const chunk of res.Body as Readable) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const PENDING = 'PENDING_UPLOAD';

async function verifyEntry(
  client: S3Client,
  bucket: string,
  entry: ModelEntry,
): Promise<'pending' | 'pass' | 'fail'> {
  const isPending =
    entry.sha256 === PENDING ||
    entry.license_text_sha256 === PENDING ||
    entry.size_bytes === 0;

  if (isPending) {
    console.log(`  [PENDING] ${entry.id} — PENDING_UPLOAD placeholder present, skipping`);
    return 'pending';
  }

  console.log(`  Checking model file: ${entry.object_key}`);
  let failed = false;

  // --- 1. Size check (HEAD) ---
  const { contentLength, etag } = await headObject(client, bucket, entry.object_key);
  if (contentLength !== entry.size_bytes) {
    console.error(
      `  [FAIL] ${entry.id} size mismatch: manifest=${entry.size_bytes} R2=${contentLength}`,
    );
    failed = true;
  } else {
    console.log(`  [OK]   size ${contentLength} bytes matches`);
  }

  // --- 2. SHA256 check (streaming, with ETag cache) ---
  const ck = cacheKey(entry.id, etag);
  let actualSha = readCache(ck);
  if (actualSha) {
    console.log(`  [CACHE] SHA256 hit for ${entry.id} (ETag ${etag})`);
  } else {
    console.log(`  Computing SHA256 for ${entry.object_key} ...`);
    actualSha = await streamingSha256(client, bucket, entry.object_key);
    writeCache(ck, actualSha);
  }

  if (actualSha !== entry.sha256) {
    console.error(
      `  [FAIL] ${entry.id} SHA256 mismatch:\n    manifest: ${entry.sha256}\n    actual:   ${actualSha}`,
    );
    failed = true;
  } else {
    console.log(`  [OK]   SHA256 matches`);
  }

  // --- 3. License file check ---
  const licenseKey = `licenses/${entry.license_id}.txt`;
  console.log(`  Checking license file: ${licenseKey}`);

  const { contentLength: licLen, etag: licEtag } = await headObject(
    client,
    bucket,
    licenseKey,
  );
  console.log(`  [OK]   license file present (${licLen} bytes)`);

  const licCk = cacheKey(`${entry.license_id}-license`, licEtag);
  let licSha = readCache(licCk);
  if (licSha) {
    console.log(`  [CACHE] license SHA256 hit (ETag ${licEtag})`);
  } else {
    console.log(`  Computing SHA256 for ${licenseKey} ...`);
    licSha = await streamingSha256(client, bucket, licenseKey);
    writeCache(licCk, licSha);
  }

  if (licSha !== entry.license_text_sha256) {
    console.error(
      `  [FAIL] ${entry.id} license SHA256 mismatch:\n    manifest: ${entry.license_text_sha256}\n    actual:   ${licSha}`,
    );
    failed = true;
  } else {
    console.log(`  [OK]   license SHA256 matches`);
  }

  return failed ? 'fail' : 'pass';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const manifestPath = join(__dirname, '..', 'manifests', 'model-manifest.v1.json');
  if (!existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  console.log(
    `Loaded manifest v${manifest.manifest_version} (${manifest.models.length} models)`,
  );

  // Check for PENDING_UPLOAD before requiring R2 credentials.
  // If every entry is PENDING (A13 not yet complete) we exit 0 immediately
  // with a warning — no false-failure, no credential requirement.
  const allPending = manifest.models.every(
    (e) => e.sha256 === PENDING || e.license_text_sha256 === PENDING || e.size_bytes === 0,
  );

  if (allPending) {
    console.log(
      '\nManifest contains only PENDING_UPLOAD entries — A13 not yet complete, nothing to verify.',
    );
    process.exit(0);
  }

  // At least one non-PENDING entry — now we need R2 credentials.
  const bucket = process.env['R2_BUCKET'];
  if (!bucket) {
    console.error('Missing required env var: R2_BUCKET');
    process.exit(1);
  }

  let client: S3Client;
  try {
    client = makeS3Client();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  let pendingCount = 0;
  let passCount = 0;
  let failCount = 0;

  for (const entry of manifest.models) {
    console.log(`\n▶ ${entry.id} (slot=${entry.slot})`);
    const result = await verifyEntry(client, bucket, entry);
    if (result === 'pending') pendingCount++;
    else if (result === 'pass') passCount++;
    else failCount++;
  }

  console.log('\n── Summary ──────────────────────────────────────');
  if (pendingCount > 0) {
    console.log(
      `⚠  ${pendingCount} PENDING_UPLOAD entries — A13 not yet complete, skipping verify for those entries`,
    );
  }
  if (passCount > 0) console.log(`✓  ${passCount} passed`);
  if (failCount > 0) console.log(`✗  ${failCount} failed`);

  if (failCount > 0) {
    console.error('\nManifest verification FAILED — see mismatches above.');
    process.exit(1);
  }

  console.log('\nManifest verification passed.');
  // Exit 0 in both mixed-pending-with-passes and all-pass cases
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
