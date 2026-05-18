import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionLog, redactPath } from '../log';

describe('log/session breadcrumbs', () => {
  // Capture-only sink so tests can assert the (level, message) tuples that
  // would have hit electron-log. The sink shape mirrors electron-log's API
  // surface that we actually use (info/error/warn).
  function makeSink() {
    const calls: Array<[string, string]> = [];
    return {
      calls,
      info: (msg: string) => calls.push(['info', msg]),
      warn: (msg: string) => calls.push(['warn', msg]),
      error: (msg: string) => calls.push(['error', msg]),
    };
  }

  let sink: ReturnType<typeof makeSink>;
  let logSession: ReturnType<typeof createSessionLog>;

  beforeEach(() => {
    sink = makeSink();
    logSession = createSessionLog(sink);
  });

  it('start: emits "[session] start lang=<lang>" at info level', () => {
    logSession.start('ja');
    expect(sink.calls).toEqual([['info', '[session] start lang=ja']]);
  });

  it('stop: emits "[session] stop note=<chars>chars segments=<n>" at info level', () => {
    logSession.stop({ noteChars: 412, segments: 13 });
    expect(sink.calls).toEqual([['info', '[session] stop note=412chars segments=13']]);
  });

  it('error: emits "[session] error code=<code>" at error level', () => {
    logSession.error('STT_TIMEOUT');
    expect(sink.calls).toEqual([['error', '[session] error code=STT_TIMEOUT']]);
  });

  it('phase: emits "[session] phase <name>=<ms>ms" at info level', () => {
    logSession.phase('stt-unload', 487);
    logSession.phase('llm-load', 12340);
    logSession.phase('generate', 8765);
    expect(sink.calls).toEqual([
      ['info', '[session] phase stt-unload=487ms'],
      ['info', '[session] phase llm-load=12340ms'],
      ['info', '[session] phase generate=8765ms'],
    ]);
  });

  it('respawn: emits "[sidecar] respawn attempt=<n> reason=<r>" at warn level', () => {
    logSession.respawn({ attempt: 1, reason: 'unexpected exit code=1' });
    expect(sink.calls).toEqual([
      ['warn', '[sidecar] respawn attempt=1 reason=unexpected exit code=1'],
    ]);
  });

  // PII safety — the founder's brief explicitly flagged log payload safety.
  // The session breadcrumbs above already shape-only (counts, durations,
  // codes). For paths, we add a redactPath helper that strips the
  // username segment of macOS-style /Users/<name>/... paths.
  describe('redactPath', () => {
    it('strips the macOS username from /Users/<name>/... paths', () => {
      expect(redactPath('/Users/guntak/.lisna-test-models/foo.gguf')).toBe(
        '/Users/<user>/.lisna-test-models/foo.gguf',
      );
    });
    it('strips the Linux username from /home/<name>/... paths', () => {
      expect(redactPath('/home/bob/models/llama.gguf')).toBe('/home/<user>/models/llama.gguf');
    });
    it('strips the Windows username from C:\\Users\\<name>\\... paths', () => {
      expect(redactPath('C:\\Users\\alice\\AppData\\models\\m.gguf')).toBe(
        'C:\\Users\\<user>\\AppData\\models\\m.gguf',
      );
    });
    it('returns the path unchanged when no username segment is present', () => {
      expect(redactPath('/opt/models/m.gguf')).toBe('/opt/models/m.gguf');
      expect(redactPath('')).toBe('');
    });
    it('handles undefined/null safely (returns "<unset>")', () => {
      expect(redactPath(undefined)).toBe('<unset>');
    });
  });
});
