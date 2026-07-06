import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ModelDescriptor } from '@shared/types';

/** Free-space margin required beyond the model's declared size (512 MiB). */
const FREE_SPACE_MARGIN_BYTES = 512 * 1024 * 1024;

export type DownloadProgress = { received: number; total: number };

export interface DownloadDeps {
  fetchImpl?: typeof fetch; // default: globalThis.fetch
  freeBytes?: (dir: string) => number; // default: statfs-based; injectable for tests
  onProgress?: (p: DownloadProgress) => void;
}

function defaultFreeBytes(dir: string): number {
  const stats = fs.statfsSync(dir);
  return stats.bavail * stats.bsize;
}

/**
 * Downloads a model descriptor's file into `destDir`, verifying sha256 and
 * writing atomically (stream to `<filename>.part`, rename on success).
 *
 * Throws `Error` with `.message` exactly one of INSUFFICIENT_DISK /
 * NETWORK_FAILED / CHECKSUM_MISMATCH. Any throw path removes the `.part`
 * file so no partial download is ever left as (or beside) the final name.
 */
export async function downloadModel(
  d: ModelDescriptor,
  destDir: string,
  deps: DownloadDeps = {},
): Promise<string> {
  const freeBytes = deps.freeBytes ?? defaultFreeBytes;
  const fetchImpl = deps.fetchImpl ?? fetch;

  fs.mkdirSync(destDir, { recursive: true });

  const need = d.sizeBytes + FREE_SPACE_MARGIN_BYTES;
  if (freeBytes(destDir) < need) {
    throw new Error('INSUFFICIENT_DISK');
  }

  const finalPath = path.join(destDir, d.filename);
  const partPath = `${finalPath}.part`;

  let res: Response;
  try {
    res = await fetchImpl(d.source.url);
  } catch {
    throw new Error('NETWORK_FAILED');
  }
  if (!res.ok || !res.body) {
    throw new Error('NETWORK_FAILED');
  }

  const total = Number(res.headers.get('content-length')) || d.sizeBytes;
  const hash = crypto.createHash('sha256');
  let received = 0;

  const fd = fs.openSync(partPath, 'w');
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const buf = Buffer.from(value);
        fs.writeSync(fd, buf);
        hash.update(buf);
        received += buf.length;
        deps.onProgress?.({ received, total });
      }
    }
  } catch {
    fs.closeSync(fd);
    fs.rmSync(partPath, { force: true });
    throw new Error('NETWORK_FAILED');
  }
  fs.closeSync(fd);

  const digest = hash.digest('hex');
  if (digest !== d.sha256) {
    fs.rmSync(partPath, { force: true });
    throw new Error('CHECKSUM_MISMATCH');
  }

  fs.renameSync(partPath, finalPath);
  return finalPath;
}
