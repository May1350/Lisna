import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signR2GetUrl, type R2Config } from './r2-signer.js';

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
// CDK esbuild bundle: index.js lands at /var/task/index.js and afterBundling copies
// backend/manifests/ to /var/task/manifests/ (one level up from here).
// Dev/test: this file is at backend/src/lib/, so ../../manifests/ = backend/manifests/.
// Try the bundle-layout path first; fall back to the source-layout path.
const MANIFEST_BUNDLE = path.resolve(here, 'manifests', 'model-manifest.v1.json');
const MANIFEST_SRC    = path.resolve(here, '..', '..', 'manifests', 'model-manifest.v1.json');
const MANIFEST_PATH   = existsSync(MANIFEST_BUNDLE) ? MANIFEST_BUNDLE : MANIFEST_SRC;

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
  signer?: SignerFn;    // injectable for tests; defaults to signR2GetUrl
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
    generated_at: new Date().toISOString(),
    cache_max_age_seconds: src.cache_max_age_seconds,
    models,
  };
}
