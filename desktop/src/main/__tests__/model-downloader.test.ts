import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadModel, registerModelDownloadIpc } from '../model-downloader';
import type { ModelDescriptor } from '@shared/types';
import type { ModelStatus } from '@shared/ipc-protocol';
import { DEFAULT_MODELS } from '@shared/models/catalog';

// ─── mock electron (mirrors session-finalize.test.ts's captured-handler harness) ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (e: unknown, args: any) => Promise<any>;
const captured = new Map<string, AnyHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      captured.set(channel, handler as AnyHandler);
    }),
  },
}));

const BODY = Buffer.from('hello-model-bytes');
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');
function desc(over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { kind: 'stt', filename: 'm.bin', sizeBytes: BODY.length, sha256: SHA, source: { url: 'https://x/m.bin' }, ...over };
}
// Minimal fetch stub: one-chunk stream body + ok/status.
function okFetch(body = BODY, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300, status,
    body: { getReader: () => { let done = false; return { read: async () => done ? { done: true, value: undefined } : (done = true, { done: false, value: new Uint8Array(body) }) }; } },
    headers: new Map([['content-length', String(body.length)]]),
  })) as unknown as typeof fetch;
}
let base: string;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

it('downloads, verifies sha256, atomically writes final file (no .part left)', async () => {
  const seen: number[] = [];
  const p = await downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 10e9, onProgress: (x) => seen.push(x.received) });
  expect(p).toBe(path.join(base, 'm.bin'));
  expect(fs.readFileSync(p)).toEqual(BODY);
  expect(fs.existsSync(p + '.part')).toBe(false);
  expect(seen.at(-1)).toBe(BODY.length);
});
it('CHECKSUM_MISMATCH deletes .part and throws', async () => {
  await expect(downloadModel(desc({ sha256: 'deadbeef' }), base, { fetchImpl: okFetch(), freeBytes: () => 10e9 }))
    .rejects.toThrow('CHECKSUM_MISMATCH');
  expect(fs.readdirSync(base)).toEqual([]); // .part cleaned, no final
});
it('non-200 → NETWORK_FAILED', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(BODY, 404), freeBytes: () => 10e9 }))
    .rejects.toThrow('NETWORK_FAILED');
});
it('INSUFFICIENT_DISK when free < size + margin', async () => {
  await expect(downloadModel(desc(), base, { fetchImpl: okFetch(), freeBytes: () => 1 }))
    .rejects.toThrow('INSUFFICIENT_DISK');
});

// ─── registerModelDownloadIpc ───────────────────────────────────────────────

describe('registerModelDownloadIpc', () => {
  // Fresh CHANNELS import per suite run (module-level import is fine — ipc.ts
  // only touches the mocked `electron` at module scope via ipcMain.handle
  // calls that registerIpc/registerModelIpc perform, not registerModelDownloadIpc
  // itself, so importing CHANNELS here is side-effect-free).
  let CHANNELS: typeof import('../ipc').CHANNELS;
  let userDataDir: string;

  beforeEach(async () => {
    ({ CHANNELS } = await import('../ipc'));
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'userdata-'));
    captured.clear();
  });
  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  /** Injected downloadImpl: writes a stub file per descriptor, emits one
   *  progress tick, and returns the path — mirrors downloadModel's contract
   *  without touching the network. */
  function stubDownloadImpl(
    d: ModelDescriptor,
    destDir: string,
    deps?: { onProgress?: (p: { received: number; total: number }) => void },
  ): Promise<string> {
    fs.mkdirSync(destDir, { recursive: true });
    const p = path.join(destDir, d.filename);
    fs.writeFileSync(p, 'stub');
    deps?.onProgress?.({ received: 4, total: 4 });
    return Promise.resolve(p);
  }

  it('both slots succeed → writes models.json + onStatusChange(ready)', async () => {
    const statuses: ModelStatus[] = [];
    const sentWindow = { webContents: { send: vi.fn() } };

    registerModelDownloadIpc({
      getMainWindow: () => sentWindow as unknown as Electron.BrowserWindow,
      userDataDir,
      onStatusChange: (s) => statuses.push(s),
      downloadImpl: stubDownloadImpl as unknown as typeof downloadModel,
    });

    const handler = captured.get(CHANNELS.modelDownload);
    expect(handler).toBeDefined();
    const result = await handler!(undefined, undefined);

    expect(result.ok).toBe(true);
    expect(result.status).toEqual({ kind: 'ready', sttPath: expect.any(String), llmPath: expect.any(String) });

    const modelsJsonPath = path.join(userDataDir, 'models.json');
    expect(fs.existsSync(modelsJsonPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8'));
    expect(written.version).toBe(1);
    expect(written.sttPath).toContain('models');
    expect(written.llmPath).toContain('models');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({ kind: 'ready', sttPath: expect.any(String), llmPath: expect.any(String) });

    // progress relayed to the renderer for both slots
    expect(sentWindow.webContents.send).toHaveBeenCalledWith(
      CHANNELS.modelDownloadProgress,
      expect.objectContaining({ slot: 'stt', received: 4, total: 4 }),
    );
    expect(sentWindow.webContents.send).toHaveBeenCalledWith(
      CHANNELS.modelDownloadProgress,
      expect.objectContaining({ slot: 'llm', received: 4, total: 4 }),
    );
  });

  it('STT download throws → {ok:false, code}, no models.json written', async () => {
    const statuses: ModelStatus[] = [];
    const failingImpl = (d: ModelDescriptor, destDir: string): Promise<string> => {
      if (d.kind === 'stt') return Promise.reject(new Error('NETWORK_FAILED'));
      return stubDownloadImpl(d, destDir);
    };

    registerModelDownloadIpc({
      getMainWindow: () => undefined,
      userDataDir,
      onStatusChange: (s) => statuses.push(s),
      downloadImpl: failingImpl as unknown as typeof downloadModel,
    });

    const handler = captured.get(CHANNELS.modelDownload);
    expect(handler).toBeDefined();
    const result = await handler!(undefined, undefined);

    expect(result).toEqual({ ok: false, code: 'NETWORK_FAILED' });
    expect(fs.existsSync(path.join(userDataDir, 'models.json'))).toBe(false);
    expect(statuses).toHaveLength(0);
  });

  it('both slots detected → NO download, models.json written, onStatusChange(ready)', async () => {
    const statuses: ModelStatus[] = [];
    const sentWindow = { webContents: { send: vi.fn() } };
    const downloadImpl = vi.fn();

    const sttFound = path.join(userDataDir, 'existing-stt.bin');
    const llmFound = path.join(userDataDir, 'existing-llm.bin');
    fs.writeFileSync(sttFound, 'stt-existing');
    fs.writeFileSync(llmFound, 'llm-existing');
    const detectImpl = vi.fn((d: ModelDescriptor) => Promise.resolve(d.kind === 'stt' ? sttFound : llmFound));

    registerModelDownloadIpc({
      getMainWindow: () => sentWindow as unknown as Electron.BrowserWindow,
      userDataDir,
      onStatusChange: (s) => statuses.push(s),
      downloadImpl: downloadImpl as unknown as typeof downloadModel,
      detectImpl,
    });

    const handler = captured.get(CHANNELS.modelDownload);
    expect(handler).toBeDefined();
    const result = await handler!(undefined, undefined);

    expect(result.ok).toBe(true);
    expect(downloadImpl).not.toHaveBeenCalled();

    const modelsJsonPath = path.join(userDataDir, 'models.json');
    expect(fs.existsSync(modelsJsonPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8'));
    expect(written.sttPath).toBe(sttFound);
    expect(written.llmPath).toBe(llmFound);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual(expect.objectContaining({ kind: 'ready' }));

    // no progress events — nothing was downloaded
    expect(sentWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('one slot missing → downloads exactly that slot', async () => {
    const statuses: ModelStatus[] = [];
    const sentWindow = { webContents: { send: vi.fn() } };

    const sttFound = path.join(userDataDir, 'existing-stt.bin');
    fs.writeFileSync(sttFound, 'stt-existing');
    const detectImpl = vi.fn((d: ModelDescriptor) => Promise.resolve(d.kind === 'stt' ? sttFound : null));
    const downloadImpl = vi.fn(stubDownloadImpl as unknown as typeof downloadModel);

    registerModelDownloadIpc({
      getMainWindow: () => sentWindow as unknown as Electron.BrowserWindow,
      userDataDir,
      onStatusChange: (s) => statuses.push(s),
      downloadImpl,
      detectImpl,
    });

    const handler = captured.get(CHANNELS.modelDownload);
    expect(handler).toBeDefined();
    const result = await handler!(undefined, undefined);

    expect(result.ok).toBe(true);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(downloadImpl).toHaveBeenCalledWith(
      DEFAULT_MODELS.llm,
      expect.any(String),
      expect.anything(),
    );

    const modelsJsonPath = path.join(userDataDir, 'models.json');
    const written = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8'));
    expect(written.sttPath).toBe(sttFound);
    expect(written.llmPath).toContain('models');

    // progress relayed only for the llm slot that actually downloaded
    expect(sentWindow.webContents.send).toHaveBeenCalledWith(
      CHANNELS.modelDownloadProgress,
      expect.objectContaining({ slot: 'llm' }),
    );
    expect(sentWindow.webContents.send).not.toHaveBeenCalledWith(
      CHANNELS.modelDownloadProgress,
      expect.objectContaining({ slot: 'stt' }),
    );
  });
});
