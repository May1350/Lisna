// Production bundle boot smoke. Launches the built Electron main process
// long enough to prove its top-level ESM import graph resolves and the
// `app.whenReady().then(...)` chain runs at least one log line. Catches
// the class of bug where a CJS dependency is named-imported from an ESM
// main bundle and crashes at module load (e.g. v0.1.0's electron-updater
// SyntaxError). Vitest + typecheck + lint do not exercise this — only
// running the bundled `out/main/index.js` through real Electron does.
//
// Sidecar spawn will fail inside the smoke (resources are arranged at
// package time, not build time) — that's expected and not what we test.
// Module-load + early boot logging is the assertion.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const mainBundle = resolve(process.cwd(), 'out/main/index.js');
if (!existsSync(mainBundle)) {
  console.error(`smoke-main-boot: ${mainBundle} not found. Run \`pnpm build\` first.`);
  process.exit(1);
}

const SMOKE_DURATION_MS = 8000;

const child = spawn('npx', ['electron', mainBundle], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

const timer = setTimeout(() => child.kill('SIGTERM'), SMOKE_DURATION_MS);

await new Promise<void>((doneRes) => {
  child.on('exit', () => { clearTimeout(timer); doneRes(); });
});

const combined = `${stdout}\n${stderr}`;
const failures: string[] = [];

// (1) ESM/CJS interop — the specific v0.1.0 crash class. CJS dep named-
// imported from ESM main produces "SyntaxError: Named export 'X' not found".
if (/SyntaxError/.test(combined)) {
  failures.push('SyntaxError in output — likely ESM/CJS interop regression in main/index.ts imports');
}

// (2) Generic uncaught exception bubbled to Electron's default handler.
if (/Uncaught Exception/.test(combined)) {
  failures.push('Uncaught Exception in main process during smoke window');
}

// (3) Externalized dep that didn't resolve at runtime.
if (/Error: Cannot find module/.test(combined)) {
  failures.push('"Cannot find module" — an external dependency did not resolve at runtime');
}

// (4) Did the boot chain actually run? main/index.ts logs `[boot] models: ...`
// BEFORE supervisor.start(). Absence = module-load or app.whenReady() rejected
// without entering the handler — equivalent to the v0.1.0 crash class even
// if no error string was emitted (some crashes are silent).
if (!/\[boot\]/.test(combined)) {
  failures.push('No "[boot]" log line — main process did not reach app.whenReady() handler');
}

if (failures.length > 0) {
  console.error('smoke-main-boot FAIL:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\n--- stderr (last 2000 chars) ---');
  console.error(stderr.slice(-2000));
  console.error('\n--- stdout (last 2000 chars) ---');
  console.error(stdout.slice(-2000));
  process.exit(1);
}

console.log('smoke-main-boot OK — main bundle module-loaded + reached app.whenReady() within smoke window');
