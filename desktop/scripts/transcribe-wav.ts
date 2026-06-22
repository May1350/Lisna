/**
 * Transcribe an arbitrary 16 kHz mono PCM WAV with a chosen Whisper GGML
 * model, via the real production sidecar + WhisperCppSTT path. STT-track eval
 * instrument: lets us A/B models (and later preprocessing / params) on the
 * founder's actual recordings, not just the synthetic ja-30s fixture.
 *
 *   LISNA_TEST_STT_MODEL=<ggml.bin> pnpm -s tsx scripts/transcribe-wav.ts [--lang ja|en|ko|zh] <wav>
 *
 * `--lang` sets the Whisper decode language (default `ja`); required for the
 * Korean STT acceptance run (`--lang ko`) since the shipped `large-v3-turbo`
 * model is multilingual and `whisper_full.language` is set verbatim.
 *
 * Passes the WAV file path directly to the sidecar via `transcribeFile`; the
 * sidecar's C++ wav_reader validates 16 kHz mono PCM16 format and decodes the
 * file itself — no TS-side PCM decode. Prints the joined transcript to stdout
 * + a one-line diag (segs, wall) to stderr. STT progress (%) is streamed to
 * stderr as the sidecar emits `sttProgress` events.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from '../src/shared/types';
import { SidecarClient } from '../src/main/sidecar/client';
import { WhisperCppSTT } from '../src/main/engines/whisper-cpp-stt';

const LANGUAGES = ['ja', 'en', 'ko', 'zh'] as const;

interface CliArgs {
  wavPath?: string;
  lang: Language;
}

/** Parse argv: first non-flag token is the WAV path; `--lang`/`--language`
 *  sets the decode language (default `ja`). Throws on an unknown language code
 *  so a typo fails loud instead of silently transcribing in the wrong language. */
export function __testOnly_parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { lang: 'ja' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' || a === '--language') {
      const v = argv[++i];
      if (!v || !(LANGUAGES as readonly string[]).includes(v)) {
        throw new Error(`--lang must be one of ${LANGUAGES.join('|')} (got ${v ?? '∅'})`);
      }
      out.lang = v as Language;
    } else if (a !== undefined && !a.startsWith('--') && out.wavPath === undefined) {
      out.wavPath = a;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { wavPath, lang } = __testOnly_parseArgs(process.argv);
  const modelPath = process.env.LISNA_TEST_STT_MODEL;
  if (!wavPath || !modelPath) {
    console.error('usage: LISNA_TEST_STT_MODEL=<bin> tsx scripts/transcribe-wav.ts [--lang ja|en|ko|zh] <wav>');
    process.exit(1);
  }
  // Resolve to absolute path — the sidecar reads the file from disk and needs
  // an absolute path since its cwd may differ from the caller's.
  const absWavPath = resolve(wavPath);
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sidecarBin = process.env.LISNA_SIDECAR_BIN ?? resolve(__dirname, '../resources/sidecar');
  const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new SidecarClient(proc);
  const t0 = Date.now();
  try {
    await client.waitForReady(10_000);
    // Subscribe to sttProgress events so the manual run shows progress.
    const unsubProgress = client.onEvent((e) => {
      if (e.type === 'sttProgress') {
        process.stderr.write(`STT progress: ${e.pct}%\n`);
      }
    });
    const stt = new WhisperCppSTT(client);
    await stt.loadModel(modelPath, lang);
    try {
      // STT Phase 1 A/B: set LISNA_STT_INITIAL_PROMPT to a proper-noun glossary
      // to bias this run; unset = no bias. Same WAV × with/without = the A/B.
      const initialPrompt = process.env.LISNA_STT_INITIAL_PROMPT?.trim() || undefined;
      const segs = await stt.transcribeFile(absWavPath, initialPrompt ? { initialPrompt } : undefined);
      unsubProgress();
      const text = segs.map((s) => s.text).join('');
      console.error(`DIAG lang=${lang} segs=${segs.length} wall_ms=${Date.now() - t0} model=${modelPath.split('/').pop()} prompt=${initialPrompt ? JSON.stringify(initialPrompt) : '(none)'}`);
      process.stdout.write(text + '\n');
    } finally {
      await stt.unloadModel().catch(() => {});
    }
  } finally {
    proc.kill('SIGKILL');
  }
}

const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
