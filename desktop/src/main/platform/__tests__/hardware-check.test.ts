import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:os BEFORE importing the SUT. The function under test uses
// `import os from 'node:os'` (default), so only the default export needs
// to be mocked.
const releaseMock = vi.fn<() => string>();
vi.mock('node:os', () => ({
  default: { release: () => releaseMock() },
}));

describe('isMacAudioLoopbackSupported', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    releaseMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p });
  }

  it('non-darwin → false', async () => {
    setPlatform('linux');
    releaseMock.mockReturnValue('6.0.0');
    const { isMacAudioLoopbackSupported } = await import('../hardware-check');
    expect(isMacAudioLoopbackSupported()).toBe(false);
  });

  it('darwin 23.3 (macOS 14.3) → false (below 14.4 floor)', async () => {
    setPlatform('darwin');
    releaseMock.mockReturnValue('23.3.0');
    const { isMacAudioLoopbackSupported } = await import('../hardware-check');
    expect(isMacAudioLoopbackSupported()).toBe(false);
  });

  it('darwin 23.4 (macOS 14.4) → true (at floor)', async () => {
    setPlatform('darwin');
    releaseMock.mockReturnValue('23.4.0');
    const { isMacAudioLoopbackSupported } = await import('../hardware-check');
    expect(isMacAudioLoopbackSupported()).toBe(true);
  });

  it('darwin 24.0 (future) → true (above floor)', async () => {
    setPlatform('darwin');
    releaseMock.mockReturnValue('24.0.0');
    const { isMacAudioLoopbackSupported } = await import('../hardware-check');
    expect(isMacAudioLoopbackSupported()).toBe(true);
  });
});
