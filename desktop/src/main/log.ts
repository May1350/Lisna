import { join } from 'node:path';
import { homedir } from 'node:os';
import log from 'electron-log/main';

// Module-load-time guard for tests. electron-log's default file transport
// computes its path eagerly on first write using `app.getName()`. Under
// vitest there is no Electron app context, so the first emitted line
// triggers a path-resolution against the package.json name → writes to
// `~/Library/Logs/@lisna/desktop/main.log`. We disable the file transport
// at module load so even un-`initFileLogger`'d modules (like ipc.ts under
// test) don't touch the filesystem.
if (process.env.VITEST) {
  log.transports.file.level = false;
}

/**
 * Initializes the main-process file logger. Idempotent: safe to call from
 * multiple module init paths.
 *
 * Destination on macOS: `~/Library/Logs/Lisna/main.log` (forced via
 * `resolvePathFn` — without this, electron-log uses `app.getName()` which
 * is the scoped pnpm package name `@lisna/desktop`, producing the wrong
 * path `~/Library/Logs/@lisna/desktop/main.log`. Alpha onboarding doc
 * directs users to a single known location, so we lock it here.)
 *
 * Rotation: 5MB × 5 files per the Step 5 §4.1 spec. electron-log's
 * `maxSize` triggers an in-place rotate (renames current to `.old`,
 * starts fresh file). The "× 5 files" part needs an `archiveLogFn` to
 * promote N→N+1; we accept "1 .log + 1 .old" for alpha (good enough to
 * cover the typical bug-report window of one or two sessions). v2.1 can
 * extend to numbered archives if needed.
 *
 * **Test isolation**: when running under Vitest (`VITEST` env var set by
 * the runner), the file transport is disabled so unit tests don't
 * pollute the real log directory. Console transport stays on — the
 * existing test snapshots can either filter `[session]` lines or
 * tolerate the noise. This is safer than mocking `electron-log` per
 * test file because the module-graph cache leaks across tests in this
 * codebase (multiple `vi.resetModules()` paths).
 *
 * **PII safety contract** (Step 5 reviewer brief): callers of the
 * convenience methods below pass shape-only values (counts, durations,
 * error codes). Never pass model paths, transcript text, prompts, or
 * audio bytes. If a path must be logged, route it through `redactPath`.
 */
export function initFileLogger(): void {
  if (process.env.VITEST) {
    // Disable file transport entirely during tests. `level: false` is the
    // electron-log convention for "don't fire this transport".
    log.transports.file.level = false;
    return;
  }
  // Be explicit about the file destination. macOS only for v2.0 alpha;
  // Linux/Windows paths get correct OS-conventional locations from
  // electron-log's defaults if/when we ever ship those targets.
  log.transports.file.resolvePathFn = () =>
    join(homedir(), 'Library', 'Logs', 'Lisna', 'main.log');
  log.transports.file.maxSize = 5 * 1024 * 1024;  // 5 MB
  log.transports.file.format =
    '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  // Level matrix:
  //   - file: info+ (debug noise omitted from the persistent record)
  //   - console: info+ in packaged builds; debug+ in dev (electron-log defaults)
  log.transports.file.level = 'info';
}

/**
 * Strip the username from filesystem paths so logs can be shared without
 * leaking the user's home-directory name. Step 5 reviewer-brief item:
 * "Phase F log payload PII safety."
 *
 * - macOS: `/Users/<name>/...` → `/Users/<user>/...`
 * - Linux: `/home/<name>/...` → `/home/<user>/...`
 * - Windows: `C:\Users\<name>\...` → `C:\Users\<user>\...`
 *
 * Returns `'<unset>'` for undefined/null so callers can use this
 * unconditionally on optional paths without adding their own null check.
 * Empty string passes through (it's a deliberate caller signal, not a
 * privacy concern).
 */
export function redactPath(path: string | undefined | null): string {
  if (path === undefined || path === null) return '<unset>';
  if (path === '') return '';
  return path
    .replace(/^\/Users\/[^/]+\//, '/Users/<user>/')
    .replace(/^\/home\/[^/]+\//, '/home/<user>/')
    .replace(/^([A-Za-z]):\\Users\\[^\\]+\\/, '$1:\\Users\\<user>\\');
}

/**
 * Minimal logger shape the breadcrumb helpers need. electron-log's
 * `LogFunctions` satisfies this naturally; tests inject a fake to capture
 * (level, message) tuples without standing up the real file transport.
 */
export interface LogSink {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/**
 * Step 5 §4.2 session breadcrumbs. Caller-friendly typed convenience
 * methods that emit the canonical breadcrumb strings — keeps callers
 * from inventing slightly-different formats at each emit site.
 *
 * All payloads are shape-only (counts, durations, codes). Do NOT extend
 * with raw content fields. If a new field carries user-derived text
 * (transcript, prompt, note body), add a separate emit method and route
 * it through `redactPath` or a length-only summarizer.
 */
export function createSessionLog(sink: LogSink) {
  return {
    start(language: string): void {
      sink.info(`[session] start lang=${language}`);
    },
    stop(args: { noteChars: number; segments: number }): void {
      sink.info(`[session] stop note=${args.noteChars}chars segments=${args.segments}`);
    },
    error(code: string): void {
      sink.error(`[session] error code=${code}`);
    },
    phase(name: string, durationMs: number): void {
      sink.info(`[session] phase ${name}=${durationMs}ms`);
    },
    respawn(args: { attempt: number; reason: string }): void {
      sink.warn(`[sidecar] respawn attempt=${args.attempt} reason=${args.reason}`);
    },
  };
}

/**
 * Default singleton session-log bound to electron-log's main sink. Modules
 * that need to emit breadcrumbs in production import this — tests use
 * `createSessionLog(fakeSink)` directly.
 */
export const sessionLog = createSessionLog(log);

export { log };
