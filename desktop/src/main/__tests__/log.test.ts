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

  // Route (b) latency decomposition (founder smoke 2026-06-09 → 4-min unattributable).
  // Three new shape-only breadcrumbs let the founder-visible main.log decompose a
  // finalize wall time into cold-cache (first attempt latency >> rest), retry
  // (totalAttempts > chunks), or RAM (per-chunk latency grows monotonically).
  describe('finalize* breadcrumbs', () => {
    it('finalizeAttempt: ok path with sanitized hits', () => {
      logSession.finalizeAttempt({
        family: 'lecture',
        chunkIndex: 0,
        totalChunks: 1,
        outerAttempt: 0,
        attempt: 1,
        seed: 5000,
        latencyMs: 24300,
        ok: true,
        sanitizedSlotCount: 2,
      });
      expect(sink.calls).toEqual([[
        'info',
        '[finalize:lecture] chunk=0/1 outerAttempt=0 attempt=1 seed=5000 latencyMs=24300 ok=true sanitized=2',
      ]]);
    });

    it('finalizeAttempt: failed path includes truncated reason; omits sanitized when 0/undefined', () => {
      logSession.finalizeAttempt({
        family: 'meeting',
        chunkIndex: 1,
        totalChunks: 3,
        outerAttempt: 0,
        attempt: 2,
        seed: 6100,
        latencyMs: 2800,
        ok: false,
        reason: 'ESCAPE_LITERAL_AT_$.sections[2].heading:"\\\\u4eca0"',
      });
      // reason is truncated at 60 chars to keep log lines scannable.
      expect(sink.calls).toEqual([[
        'info',
        '[finalize:meeting] chunk=1/3 outerAttempt=0 attempt=2 seed=6100 latencyMs=2800 ok=false reason=ESCAPE_LITERAL_AT_$.sections[2].heading:"\\\\u4eca0"',
      ]]);
    });

    it('finalizeAttempt: truncates reason longer than 60 chars with trailing "…"', () => {
      const longReason = 'A'.repeat(120);
      logSession.finalizeAttempt({
        family: 'interview',
        chunkIndex: 0,
        totalChunks: 1,
        outerAttempt: 0,
        attempt: 1,
        seed: 7000,
        latencyMs: 100,
        ok: false,
        reason: longReason,
      });
      expect(sink.calls).toEqual([[
        'info',
        `[finalize:interview] chunk=0/1 outerAttempt=0 attempt=1 seed=7000 latencyMs=100 ok=false reason=${'A'.repeat(60)}…`,
      ]]);
    });

    it('finalizeChunkDone: per-chunk roll-up', () => {
      logSession.finalizeChunkDone({
        family: 'brainstorm',
        chunkIndex: 0,
        totalChunks: 2,
        totalLatencyMs: 27100,
        outerAttempts: 2,
        totalAttempts: 4,
        freshSeedRetries: 1,
        sanitizedTotal: 3,
      });
      expect(sink.calls).toEqual([[
        'info',
        '[finalize:brainstorm] chunk=0/2 done latencyMs=27100 outerAttempts=2 totalAttempts=4 freshSeedRetries=1 sanitized=3',
      ]]);
    });

    it('finalizeDone: per-finalize roll-up', () => {
      logSession.finalizeDone({
        family: 'lecture',
        totalLatencyMs: 54200,
        chunkCount: 2,
        totalAttempts: 4,
        sanitizedTotal: 3,
      });
      expect(sink.calls).toEqual([[
        'info',
        '[finalize:lecture] DONE latencyMs=54200 chunks=2 totalAttempts=4 sanitized=3',
      ]]);
    });
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
