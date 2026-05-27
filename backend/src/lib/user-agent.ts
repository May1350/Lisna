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
