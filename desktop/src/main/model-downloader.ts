import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ipcMain, type BrowserWindow } from 'electron';
import type { ModelDescriptor } from '@shared/types';
import type { CoreModelSlot, ModelStatus, DownloadResult } from '@shared/ipc-protocol';
import { CHANNELS } from './ipc';
import { DEFAULT_MODELS } from '@shared/models/catalog';
import { saveModelsJson, resolveModels } from './model-resolver';
import { detectExistingModel, recordLocation } from './model-detect';
import { log } from './log';

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

export interface ModelDownloadIpcDeps {
  getMainWindow: () => BrowserWindow | undefined;
  userDataDir: string;
  onStatusChange?: (s: ModelStatus) => void;
  /** Injectable for tests — defaults to the real `downloadModel` above. */
  downloadImpl?: typeof downloadModel;
  /** Injectable for tests — defaults to the real `detectExistingModel`. */
  detectImpl?: typeof detectExistingModel;
}

/**
 * Register the in-app first-run downloader's IPC handler. For each of the
 * DEFAULT_MODELS slots (stt then llm), first checks whether a valid model
 * already exists on disk (`detectExistingModel`) and only downloads what's
 * missing, into `<userDataDir>/models`. Persists models.json and recomputes
 * ModelStatus via the same resolver `registerModelIpc` uses — so the two
 * handlers never disagree on what "ready" means.
 *
 * Any failure (network/disk/checksum from downloadModel, or a models.json
 * write failure) short-circuits with `{ok:false, code}` and leaves
 * models.json untouched — a retry re-detects/re-downloads both slots rather
 * than attempting a partial resume.
 */
export function registerModelDownloadIpc(deps: ModelDownloadIpcDeps): void {
  const downloadImpl = deps.downloadImpl ?? downloadModel;
  const detectImpl = deps.detectImpl ?? detectExistingModel;

  ipcMain.handle(CHANNELS.modelDownload, async (): Promise<DownloadResult> => {
    const destDir = path.join(deps.userDataDir, 'models');
    try {
      const slots: CoreModelSlot[] = ['stt', 'llm'];
      const paths: Record<CoreModelSlot, string> = { stt: '', llm: '' };
      for (const slot of slots) {
        const found = await detectImpl(DEFAULT_MODELS[slot], deps.userDataDir);
        const finalPath =
          found ??
          (await downloadImpl(DEFAULT_MODELS[slot], destDir, {
            onProgress: (p) => {
              deps.getMainWindow()?.webContents.send(CHANNELS.modelDownloadProgress, { slot, ...p });
            },
          }));
        recordLocation(deps.userDataDir, slot, finalPath);
        paths[slot] = finalPath;
      }

      try {
        await saveModelsJson(deps.userDataDir, { version: 1, sttPath: paths.stt, llmPath: paths.llm });
      } catch (err) {
        log.error('[model-downloader] saveModelsJson failed', err);
        throw new Error('MODEL_SAVE_FAILED');
      }

      const status = await resolveModels({ userDataDir: deps.userDataDir, envOverride: {} });
      deps.onStatusChange?.(status);
      return { ok: true, status };
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      log.error('[model-downloader] download failed', code);
      return { ok: false, code };
    }
  });
}
