import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;     // e.g. 'https://<acct>.r2.cloudflarestorage.com'
}

const MAX_TTL_SECONDS = 7 * 24 * 3600;   // 7d — AWS SigV4 hard limit
const MIN_TTL_SECONDS = 60;

/**
 * Generate a presigned GET URL for an R2 object.
 * Cloudflare R2 is S3-API compatible; uses 'auto' region + forcePathStyle.
 * TTL clamped to [60s, 7d].
 */
export async function signR2GetUrl(
  cfg: R2Config,
  objectKey: string,
  ttlSeconds: number,
): Promise<string> {
  const expires = Math.min(Math.max(MIN_TTL_SECONDS, ttlSeconds), MAX_TTL_SECONDS);
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
  return getSignedUrl(client, cmd, { expiresIn: expires });
}
