# LLM Connector Notes (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **House deviation from the plan template:** per `feedback_sdd_precommit_gate_stage_only`, implementers **STAGE ONLY** (`git add <files>`, NO commit, NO self-spawned reviewers). The controller builds the staged-diff package, dispatches ONE independent opus reviewer, then commits. Every task's final "Commit" step below therefore reads "Stage & report".
> **Integration-task rule** (`feedback_spec_pseudo_code_integration_point`): any task that edits an existing file MUST re-read the live file first and verify the cited line numbers/semantics — code blocks below are contracts, not paste-targets.

**Goal:** When the user has connected their own Anthropic API key, note generation at finalize runs as ONE Claude call (whole transcript + family prompt → schema-valid note) instead of the on-device 3B pipeline; the note lands in the same dump/History/NoteView machinery with an origin tag. On-device stays the default for unconnected users.

**Architecture:** New `desktop/src/main/connector/` module (key storage via keytar, one-shot cloud generation via `@anthropic-ai/sdk`, IPC). Finalize gains a `target: 'ondevice'|'claude'` arg; the cloud branch reuses whisper STT (runGenerationContext steps A–D) but skips the LLM load (steps E/F), then routes to `generateCloudNote` instead of `routeFamily`. Output re-enters the existing `runPostDecodePipeline` → `applyGeneratedMeta` path so persistence/rendering are unchanged. Renderer: connect view (disclosure + key input), target picker in FamilyPickerStep, cloud progress chip, origin badges.

**Tech Stack:** Electron 39 main (ESM, electron-vite, externalizeDepsPlugin), `@anthropic-ai/sdk` ^0.91.1 (ALREADY a dependency — do NOT touch package.json deps), keytar ^7.9.0 (already asarUnpack'd), Zod 3, Vitest 2, React 18 renderer (no router — View union FSM).

**Spec:** `docs/superpowers/specs/2026-07-07-llm-connector-notes-design.md` (incl. §8a Phase 0 resolution: v1 auth = user API key).

## Global Constraints

- Model default: `CLOUD_MODEL = 'claude-sonnet-5'` — ONE const in `claude-notes.ts`; never hardcode elsewhere. No `temperature`/`top_p` params (removed on this model family). `max_tokens: 16000`, non-streaming.
- All user-facing strings JA (polite です・ます, 「。」 terminator), via `renderer/i18n/` modules — never inline literals. Never use `§` in any user-visible string.
- Error signalling: `throw new Error('SCREAMING_SNAKE_CODE')` main-side; renderer matches `message.includes(code)`; every new code gets JA copy in `error-message-map.ts` (its header has the 3-step recipe).
- NEVER log or put in telemetry: the API key, transcript text, or note content (PII-strip precedent: `toFinalizeProgressPayload`).
- Secrets: the key lives ONLY in the macOS Keychain (keytar, service `com.lisna.desktop`). Never in userData JSON, logs, or test fixtures.
- Cloud generation MUST run inside the existing generation lane: `beginGeneration()` gate + `onSessionSettled` settle (ipc.ts:225, :740-751). Never bypass.
- Tests: mock the SDK/keytar boundary (testing.md rule); NEVER `run_in_background` for any pnpm test/verify command (MEMORY.md LLM-zombie HARD rule); verification gates run `pnpm --filter @lisna/desktop lint` + scoped vitest FILE paths (pitfalls: pre-push-lint, vitest-scope).
- Version bump: `desktop/package.json` "version" 0.1.39 → **0.1.40** exactly once, in Task 11.
- Worktree: all work happens in `/Users/guntak/Lisna` on branch `feat/llm-connector-notes`. Implementers: `pwd` before every git command; git usage = `git add` ONLY.

## File Structure (created / modified)

```
desktop/src/main/connector/claude-auth.ts          (new)  keytar key store
desktop/src/main/connector/ipc.ts                  (new)  connector/status|connect|disconnect
desktop/src/main/connector/claude-notes.ts         (new)  one-shot cloud generation
desktop/src/shared/families/util/cloud-prompt.ts   (new)  per-family single-shot prompt builder
desktop/src/renderer/routes/ConnectorView.tsx      (new)  connect view (disclosure + key input)
desktop/src/renderer/i18n/connector-strings.ts     (new)  all connector JA copy
desktop/src/main/auth/keychain.ts                  (mod)  export SERVICE
desktop/src/shared/note-schema/base.ts             (mod)  origin field (postDecodeOnly)
desktop/src/shared/note-schema/apply-generated-meta.ts (mod) origin param
desktop/src/main/sidecar/orchestrator.ts           (mod)  pass origin:'ondevice' (4 sites)
desktop/src/main/sidecar/ipc/session-finalize.ts   (mod)  target arg + cloud branch
desktop/src/main/ipc.ts                            (mod)  CHANNELS + transcript-only context + wiring
desktop/src/main/dump-finalize-context.ts          (mod)  skip-LLM variant for from-dump
desktop/src/main/session-dump-reader.ts            (mod)  read origin for History
desktop/src/shared/ipc-protocol.ts                 (mod)  DumpSummary.origin + cloud progress kinds
desktop/src/preload/index.ts                       (mod)  connector methods + finalize target
desktop/src/renderer/i18n/error-message-map.ts     (mod)  8 CONNECTOR_* codes
desktop/src/renderer/App.tsx                       (mod)  connector view kind, target threading, chip
desktop/src/renderer/components/FamilyPickerStep.tsx (mod) target picker + upsell
desktop/src/renderer/components/NoteRenderProgress.tsx (mod) 'cloud' phase
desktop/src/renderer/routes/Recording.tsx          (mod)  footer entry button
desktop/src/renderer/routes/NoteView.tsx           (mod)  origin badge
desktop/src/renderer/components/HistoryList.tsx    (mod)  origin badge
desktop/src/renderer/routes/History.tsx            (mod)  origin badge + target pass-through
docs/PRD.md                                        (mod)  posture amendment
desktop/package.json                               (mod)  0.1.40
```

---

### Task 1: Keychain-backed API key store (`claude-auth.ts`)

**Files:**
- Modify: `desktop/src/main/auth/keychain.ts` (export the `SERVICE` const, currently module-private at :17)
- Create: `desktop/src/main/connector/claude-auth.ts`
- Test: `desktop/src/main/connector/__tests__/claude-auth.test.ts`

**Interfaces:**
- Consumes: `SERVICE` from `../auth/keychain` (after export), `keytar` (already a dep, already asarUnpack'd).
- Produces: `ANTHROPIC_KEY_ACCOUNT = 'anthropic_api_key'`, `storeApiKey(key: string): Promise<void>`, `loadApiKey(): Promise<string | null>`, `clearApiKey(): Promise<void>` — Tasks 2 and 5 import these.

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/main/connector/__tests__/claude-auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setPassword = vi.fn(async () => {});
const getPassword = vi.fn(async () => null as string | null);
const deletePassword = vi.fn(async () => true);
vi.mock('keytar', () => ({ default: { setPassword, getPassword, deletePassword } }));

import { storeApiKey, loadApiKey, clearApiKey, ANTHROPIC_KEY_ACCOUNT } from '../claude-auth';

describe('claude-auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores under the shared keychain service with the anthropic account', async () => {
    await storeApiKey('sk-ant-test');
    expect(setPassword).toHaveBeenCalledWith('com.lisna.desktop', ANTHROPIC_KEY_ACCOUNT, 'sk-ant-test');
  });

  it('loads the stored key (null when absent)', async () => {
    getPassword.mockResolvedValueOnce('sk-ant-test');
    await expect(loadApiKey()).resolves.toBe('sk-ant-test');
    await expect(loadApiKey()).resolves.toBeNull();
  });

  it('clears the key', async () => {
    await clearApiKey();
    expect(deletePassword).toHaveBeenCalledWith('com.lisna.desktop', ANTHROPIC_KEY_ACCOUNT);
  });

  it('rejects empty/whitespace keys before touching the keychain', async () => {
    await expect(storeApiKey('  ')).rejects.toThrow('CONNECTOR_NO_KEY');
    expect(setPassword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/connector/__tests__/claude-auth.test.ts`
Expected: FAIL — cannot resolve `../claude-auth`.

- [ ] **Step 3: Implement**

First re-read `desktop/src/main/auth/keychain.ts`; change `const SERVICE` to `export const SERVICE` (its JSDoc at :14-16 already invites reuse with a new account). Then:

```ts
// desktop/src/main/connector/claude-auth.ts
/**
 * Anthropic API key storage for the LLM connector (spec 2026-07-07 §5, §8a).
 * Key lives ONLY in the macOS Keychain — same service as the device token,
 * per keychain.ts's stated convention. Never written to userData JSON or logs.
 */
import keytar from 'keytar';
import { SERVICE } from '../auth/keychain';

export const ANTHROPIC_KEY_ACCOUNT = 'anthropic_api_key';

export async function storeApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) throw new Error('CONNECTOR_NO_KEY');
  await keytar.setPassword(SERVICE, ANTHROPIC_KEY_ACCOUNT, trimmed);
}

export async function loadApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ANTHROPIC_KEY_ACCOUNT);
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, ANTHROPIC_KEY_ACCOUNT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/connector/__tests__/claude-auth.test.ts`
Expected: PASS (4 tests). Also run the existing keychain consumers' tests to prove the export change is inert: `pnpm --filter @lisna/desktop exec vitest run src/main/auth`.

- [ ] **Step 5: Stage & report**

`git add desktop/src/main/auth/keychain.ts desktop/src/main/connector/` — report staged files + test output. Do NOT commit.

---

### Task 2: Connector IPC + preload surface

**Files:**
- Create: `desktop/src/main/connector/ipc.ts`
- Modify: `desktop/src/main/ipc.ts` (CHANNELS const :39-116 — add 3 entries)
- Modify: `desktop/src/main/index.ts` (wire `registerConnectorIpc` beside `registerModelDownloadIpc` at :256, BEFORE `createWindow()` — ordering requirement documented at :235)
- Modify: `desktop/src/preload/index.ts` (methods + Window type block :198-231)
- Test: `desktop/src/main/connector/__tests__/connector-ipc.test.ts`

**Interfaces:**
- Consumes: Task 1's `storeApiKey/loadApiKey/clearApiKey`; `CLOUD_MODEL` does not exist yet — this task defines the status shape only.
- Produces: `CONNECTOR_CHANNELS = { status: 'connector/status', connect: 'connector/connect', disconnect: 'connector/disconnect' }`; `interface ConnectorStatus { connected: boolean }`; `registerConnectorIpc(deps?: { validateKey?: (key: string) => Promise<void> })`. Renderer surface: `window.lisna.connectorStatus(): Promise<ConnectorStatus>`, `connectorConnect(apiKey: string): Promise<ConnectorStatus>`, `connectorDisconnect(): Promise<ConnectorStatus>`.

- [ ] **Step 1: Write the failing test** (copy the vi.mock('electron') handler-capture pattern from `desktop/src/main/__tests__/ipc.test.ts:14-31` — the electron mock exposes ONLY `ipcMain.handle` + `app` stubs; do not import anything else from 'electron' in connector code)

```ts
// desktop/src/main/connector/__tests__/connector-ipc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...a: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn) },
}));
const store = { key: null as string | null };
vi.mock('../claude-auth', () => ({
  storeApiKey: vi.fn(async (k: string) => { store.key = k; }),
  loadApiKey: vi.fn(async () => store.key),
  clearApiKey: vi.fn(async () => { store.key = null; }),
}));

import { registerConnectorIpc, CONNECTOR_CHANNELS } from '../ipc';

const invoke = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args);

describe('connector IPC', () => {
  beforeEach(() => { handlers.clear(); store.key = null; });

  it('status reflects key presence', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.status)).resolves.toEqual({ connected: false });
    store.key = 'sk-ant-x';
    await expect(invoke(CONNECTOR_CHANNELS.status)).resolves.toEqual({ connected: true });
  });

  it('connect validates BEFORE storing; invalid key stores nothing', async () => {
    registerConnectorIpc({ validateKey: async () => { throw new Error('CONNECTOR_AUTH_INVALID'); } });
    await expect(invoke(CONNECTOR_CHANNELS.connect, 'bad')).rejects.toThrow('CONNECTOR_AUTH_INVALID');
    expect(store.key).toBeNull();
  });

  it('connect stores after successful validation and returns connected', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.connect, ' sk-ant-y ')).resolves.toEqual({ connected: true });
    expect(store.key).toBe('sk-ant-y');
  });

  it('rejects non-string payloads with CONNECTOR_NO_KEY', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    await expect(invoke(CONNECTOR_CHANNELS.connect, 42)).rejects.toThrow('CONNECTOR_NO_KEY');
  });

  it('disconnect clears and returns disconnected', async () => {
    registerConnectorIpc({ validateKey: async () => {} });
    store.key = 'sk-ant-z';
    await expect(invoke(CONNECTOR_CHANNELS.disconnect)).resolves.toEqual({ connected: false });
    expect(store.key).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — same vitest single-file command; expected FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// desktop/src/main/connector/ipc.ts
/** Connector IPC: connect = validate-then-store (a bad key must never persist). */
import { ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { storeApiKey, loadApiKey, clearApiKey } from './claude-auth';

export const CONNECTOR_CHANNELS = {
  status: 'connector/status',
  connect: 'connector/connect',
  disconnect: 'connector/disconnect',
} as const;

export interface ConnectorStatus { connected: boolean }

async function defaultValidateKey(key: string): Promise<void> {
  try {
    await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('CONNECTOR_AUTH_INVALID');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('CONNECTOR_OFFLINE');
    throw new Error('CONNECTOR_AUTH_INVALID');
  }
}

export function registerConnectorIpc(deps: { validateKey?: (key: string) => Promise<void> } = {}): void {
  const validateKey = deps.validateKey ?? defaultValidateKey;

  ipcMain.handle(CONNECTOR_CHANNELS.status, async (): Promise<ConnectorStatus> => ({
    connected: (await loadApiKey()) !== null,
  }));

  ipcMain.handle(CONNECTOR_CHANNELS.connect, async (_e, apiKey: unknown): Promise<ConnectorStatus> => {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) throw new Error('CONNECTOR_NO_KEY');
    const trimmed = apiKey.trim();
    await validateKey(trimmed);
    await storeApiKey(trimmed);
    return { connected: true };
  });

  ipcMain.handle(CONNECTOR_CHANNELS.disconnect, async (): Promise<ConnectorStatus> => {
    await clearApiKey();
    return { connected: false };
  });
}
```

Then wiring (re-read live files first):
1. `desktop/src/main/ipc.ts` CHANNELS: add `connectorStatus: 'connector/status'`, `connectorConnect: 'connector/connect'`, `connectorDisconnect: 'connector/disconnect'` with one-line JSDoc each (naming source of truth; keep literal strings in sync with `CONNECTOR_CHANNELS`).
2. `desktop/src/main/index.ts`: `registerConnectorIpc()` next to `registerModelDownloadIpc(...)` (:256), before `createWindow()`.
3. `desktop/src/preload/index.ts`: add to the exposed object —
```ts
connectorStatus: () => ipcRenderer.invoke(CHANNELS.connectorStatus),
connectorConnect: (apiKey: string) => ipcRenderer.invoke(CHANNELS.connectorConnect, apiKey),
connectorDisconnect: () => ipcRenderer.invoke(CHANNELS.connectorDisconnect),
```
and mirror the three signatures in the `declare global` Window block (:198-231) — same edit, same commit, or the renderer type-checks fail.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/connector/ && pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: connector tests PASS; typecheck clean (Window type + CHANNELS in sync).

- [ ] **Step 5: Stage & report** — `git add desktop/src/main/connector/ desktop/src/main/ipc.ts desktop/src/main/index.ts desktop/src/preload/index.ts`.

---

### Task 3: Cloud prompt builder (`cloud-prompt.ts`)

**Files:**
- Create: `desktop/src/shared/families/util/cloud-prompt.ts`
- Test: `desktop/src/shared/families/util/__tests__/cloud-prompt.test.ts`
- (Possibly modify the four prompt files ONLY to `export` currently-private SYSTEM constants — no text changes.)

**Interfaces:**
- Consumes: family system-prompt sources — lecture `prompts/v2.ts` SYSTEM (:32-57), meeting `prompts/v1.ts` SYSTEM (:3-31) + `PASS2_FIELD_SEMANTICS.meeting` (`util/two-pass-prompts.ts:47-55`), interview `prompts/v2.ts` SYSTEM (:28-60), brainstorm `prompts/v1.ts` SYSTEM (:3-34); `SessionTranscript` type (same one `routeFamily` produces via `adaptToV2Transcript`, session-finalize.ts:237).
- Produces: `buildCloudNotePrompt(family: 'lecture'|'meeting'|'interview'|'brainstorm', transcript: SessionTranscript, language: 'ja'|'en'|'ko'): { system: string; user: string }` — Task 5 consumes.

**Key design (from the code map):** the model must emit the note's CONTENT fields + `family` + `title` (+ `purpose` where required) as a single JSON object. It must NOT emit `from` provenance or brainstorm `ideas[].id` (both `postDecodeOnly` — `runPostDecodePipeline` fills them), and NOT emit NoteBase system meta (`schemaVersion/generatedAt/generatedBy/language/durationSec` — Task 5 injects stubs before the pipeline). The existing JA system prompts already carry the field semantics; the builder wraps them with a cloud addendum.

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/shared/families/util/__tests__/cloud-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildCloudNotePrompt } from '../cloud-prompt';

const transcript = {
  sessionId: 's1',
  speakers: [{ id: 0 }],
  bucket_seconds: 10,
  transcripts: [
    { ts: 0, text: '会議を始めます。', speakerId: 0 },
    { ts: 95, text: '価格は3,480円に決定しました。', speakerId: 0 },
  ],
} as never; // implementer: use the real SessionTranscript type, not `never`

const FAMILIES = ['lecture', 'meeting', 'interview', 'brainstorm'] as const;

describe('buildCloudNotePrompt', () => {
  it.each(FAMILIES)('%s: system carries family field semantics; user carries the full transcript', (family) => {
    const { system, user } = buildCloudNotePrompt(family, transcript, 'ja');
    expect(system.length).toBeGreaterThan(200);
    expect(user).toContain('価格は3,480円に決定しました。');
    expect(user).toContain('[01:35]');            // mm:ss timestamps
    expect(system).toContain('JSON');              // JSON-only output instruction
  });

  it.each(FAMILIES)('%s: forbids postDecodeOnly + system-meta fields', (family) => {
    const { system } = buildCloudNotePrompt(family, transcript, 'ja');
    expect(system).toContain('from');              // the do-not-emit instruction names them
    expect(system).toContain('generatedBy');
  });

  it('meeting system includes the decision-vs-label semantics (iter2 bank)', () => {
    const { system } = buildCloudNotePrompt('meeting', transcript, 'ja');
    expect(system).toMatch(/decisions|決定/);
    expect(system).toMatch(/next_steps/);
  });

  it('non-ja language is passed through as an output-language instruction', () => {
    const { system } = buildCloudNotePrompt('meeting', transcript, 'ko');
    expect(system).toMatch(/한국어|Korean|ko/);
  });

  it('multi-speaker transcripts render speaker markers', () => {
    const multi = { ...(transcript as object), transcripts: [{ ts: 0, text: 'こんにちは', speakerId: 1 }] } as never;
    const { user } = buildCloudNotePrompt('interview', multi, 'ja');
    expect(user).toContain('話者1');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (module missing).

- [ ] **Step 3: Implement**

Shape (implementer re-reads the four prompt files and exports SYSTEM consts if private — text unchanged):

```ts
// desktop/src/shared/families/util/cloud-prompt.ts
/**
 * Single-shot cloud prompt per family (spec §5 "Prompt reuse").
 * Reuses the JA field-semantics the on-device prompts already encode; the
 * cloud model gets the WHOLE transcript in one call (no chunking, no GBNF).
 * postDecodeOnly fields (from, ideas[].id) and NoteBase system meta are
 * filled/overwritten by the caller — the model is told NOT to emit them.
 */
import type { SessionTranscript } from '<implementer: exact import path used by routeFamily>';
import { SYSTEM as LECTURE_SYSTEM } from '../lecture/prompts/v2';
import { SYSTEM as MEETING_SYSTEM } from '../meeting/prompts/v1';
import { SYSTEM as INTERVIEW_SYSTEM } from '../interview/prompts/v2';
import { SYSTEM as BRAINSTORM_SYSTEM } from '../brainstorm/prompts/v1';
import { PASS2_FIELD_SEMANTICS } from './two-pass-prompts';

export const CLOUD_PROMPT_VERSION = 'cloud-v1';

const FAMILY_SYSTEM: Record<CloudFamily, string> = {
  lecture: LECTURE_SYSTEM,
  meeting: `${MEETING_SYSTEM}\n\n${PASS2_FIELD_SEMANTICS.meeting}`,
  interview: INTERVIEW_SYSTEM,
  brainstorm: BRAINSTORM_SYSTEM,
};

const CLOUD_ADDENDUM = `
## 出力形式（クラウド生成・厳守）
- 出力は JSON オブジェクト 1 個のみ。前後に説明文・コードフェンスを付けないでください。
- ノート全体を一度に出力します（チャンク分割はありません）。
- 「from」フィールドと ideas[].id は出力しないでください（システムが後段で付与します）。
- schemaVersion / generatedAt / generatedBy / language / durationSec も出力不要です（システムが設定します）。
- family と title（内容を要約した日本語タイトル）は必ず含めてください。`;

function formatTs(sec: number): string { /* mm:ss (hh:mm:ss over 1h) */ }
function formatTranscript(t: SessionTranscript): string {
  // one line per segment: `[mm:ss] 話者N: text` — speaker marker only when >1 speaker id present
}
function languageLine(language: 'ja' | 'en' | 'ko'): string {
  // ja -> '' (templates are JA-native); en/ko -> explicit output-language override line,
  // mirroring renderSystemTemplate's approach (util/prompts.ts:53-64)
}

export function buildCloudNotePrompt(family: CloudFamily, transcript: SessionTranscript, language: 'ja' | 'en' | 'ko') {
  const system = `${FAMILY_SYSTEM[family]}\n${CLOUD_ADDENDUM}${languageLine(language)}`;
  const user = `以下は録音全体の文字起こしです。この内容から ${family} ノートを JSON で作成してください。\n\n${formatTranscript(transcript)}`;
  return { system, user };
}
```

- [ ] **Step 4: Run tests** — the new test file + `pnpm --filter @lisna/desktop exec vitest run src/shared/families` (prove the export changes broke nothing) + `tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Stage & report** — `git add desktop/src/shared/families/util/cloud-prompt.ts desktop/src/shared/families/util/__tests__/cloud-prompt.test.ts <touched prompt files>`.

---

### Task 4: Origin tag (`origin: 'ondevice'|'claude'`) through NoteBase → meta → dumps → IPC types

**Files:**
- Modify: `desktop/src/shared/note-schema/base.ts` (:47-61)
- Modify: `desktop/src/shared/note-schema/apply-generated-meta.ts` (:29-36)
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (the 4 `applyGeneratedMeta` call sites — lecture :807 region, meeting, interview, brainstorm; re-read live)
- Modify: `desktop/src/main/session-dump-reader.ts` (read `origin` from `note.json` next to where `noteTitle` is read, :59-70)
- Modify: `desktop/src/shared/ipc-protocol.ts` (`DumpSummary` :268-285 and `DumpTranscript` :307-318 gain `origin?: 'ondevice' | 'claude'`)
- Test: extend `desktop/src/shared/note-schema/__tests__/` (follow existing file layout) + `desktop/src/main/__tests__/session-dump-reader.test.ts` if present (re-read live; else colocate)

**Interfaces:**
- Produces: `NoteOrigin = 'ondevice' | 'claude'`; `NoteBaseSchema` gains `origin: postDecodeOnly(z.enum(['ondevice','claude'])).optional()`; `applyGeneratedMeta(note, { model, promptVersion, language, durationSec, origin })` (origin REQUIRED in the meta arg — compiler forces all call sites); `DumpSummary.origin?`.
- **GBNF invariant:** `postDecodeOnly` fields are omitted from the on-device grammar by construction — add the regression test below anyway (this is the one change that could silently break on-device generation).

- [ ] **Step 1: Write failing tests**

```ts
// extend the note-schema test file (implementer: match existing test file location/naming)
import { zodToGbnf } from '<implementer: actual zod-to-gbnf import>';
import { MeetingNoteSchema } from '../../families/meeting/schema';

it('origin is postDecodeOnly: absent from the on-device grammar', () => {
  const grammar = zodToGbnf(MeetingNoteSchema);
  expect(grammar).not.toContain('origin');
});

it('applyGeneratedMeta stamps origin', () => {
  const stamped = applyGeneratedMeta(validMeetingNoteFixture, {
    model: 'x', promptVersion: 'v', language: 'ja', durationSec: 60, origin: 'claude',
  });
  expect(stamped.origin).toBe('claude');
});

it('notes without origin still parse (backward compat with existing dumps)', () => {
  expect(() => MeetingNoteSchema.parse(legacyNoteFixtureWithoutOrigin)).not.toThrow();
});
```

- [ ] **Step 2: Run to verify FAIL** (origin param/field missing → type + assertion failures).

- [ ] **Step 3: Implement**
  1. `base.ts`: `origin: postDecodeOnly(z.enum(['ondevice', 'claude'])).optional(),` in `NoteBaseSchema` + export `type NoteOrigin`.
  2. `apply-generated-meta.ts`: add required `origin: NoteOrigin` to the meta arg; set `note.origin = meta.origin`.
  3. `orchestrator.ts`: all 4 call sites pass `origin: 'ondevice'` (compiler finds them).
  4. `session-dump-reader.ts`: where `noteTitle` is read from `note.json`, also read `origin` (string-guard to the two allowed values; else undefined) into `DumpSummary`/`DumpTranscript`.
  5. `ipc-protocol.ts`: optional `origin` on both types (old dumps have none — keep the `?? fallback` defensive pattern HistoryList already uses for `family`).

- [ ] **Step 4: Run** — scoped: note-schema tests + `src/main/sidecar/__tests__/` orchestrator tests + dump-reader tests + `tsc --noEmit`. Expected: PASS, no on-device test regressions.

- [ ] **Step 5: Stage & report.**

---

### Task 5: Cloud note generation core (`claude-notes.ts`)

**Files:**
- Create: `desktop/src/main/connector/claude-notes.ts`
- Test: `desktop/src/main/connector/__tests__/claude-notes.test.ts`

**Interfaces:**
- Consumes: Task 1 `loadApiKey`; Task 3 `buildCloudNotePrompt` + `CLOUD_PROMPT_VERSION`; Task 4 `applyGeneratedMeta` (origin `'claude'`); existing `runPostDecodePipeline(rawJson, familyCore, transcript)` (`shared/post-decode/pipeline.ts:28-65`), `familyCoreRegistry` lookup, `findLanguageMismatch` (`grammar-call.ts:339-352`, reuse as fabrication circuit-breaker).
- Produces (Task 6 consumes): 
  ```ts
  export const CLOUD_MODEL = process.env.LISNA_CLOUD_MODEL ?? 'claude-sonnet-5'; // spec §8a "overridable, not scattered"
  export interface CloudGenerateArgs {
    family: 'lecture' | 'meeting' | 'interview' | 'brainstorm';
    transcript: SessionTranscript;
    language: 'ja' | 'en' | 'ko';
    durationSec: number;
  }
  export interface CloudNoteDeps {
    loadApiKey?: () => Promise<string | null>;          // default: claude-auth
    createClient?: (apiKey: string) => CloudMessages;   // default: new Anthropic({ apiKey, maxRetries: 1 })
    onEvent?: (e: { kind: 'cloud-start' } | { kind: 'cloud-retry'; attempt: number }) => void;
  }
  export async function generateCloudNote(args: CloudGenerateArgs, deps?: CloudNoteDeps):
    Promise<{ note: NoteBase; telemetry: { model: string; durationMs: number; inputChars: number; attempts: number } }>
  ```
- Error codes thrown (Task 7 maps them): `CONNECTOR_NO_KEY`, `CONNECTOR_AUTH_INVALID`, `CONNECTOR_RATE_LIMITED`, `CONNECTOR_NO_CREDIT`, `CONNECTOR_OFFLINE`, `CONNECTOR_TIMEOUT`, `CONNECTOR_BAD_RESPONSE`, `CONNECTOR_TRANSCRIPT_TOO_LONG`.

**Flow contract:**
1. `loadApiKey()` → null ⇒ `CONNECTOR_NO_KEY`.
2. Transcript char guard: total text chars > `700_000` ⇒ `CONNECTOR_TRANSCRIPT_TOO_LONG` (1M-token context safety margin; cheap, practically never fires).
3. Build prompt once. Up to **2 attempts** of: `client.messages.create({ model: CLOUD_MODEL, max_tokens: 16000, system, messages: [{ role: 'user', content: user }] }, { timeout: 300_000 })` → take the first text block → strip optional ```json fences → `JSON.parse` → **inject system-meta stubs** (`{ schemaVersion: 1, generatedAt: '', generatedBy: { model: '', promptVersion: '' }, language, durationSec, ...parsed }` — parsed content wins on collision except the stubs listed) → `findLanguageMismatch` guard (ja only) → `runPostDecodePipeline(JSON.stringify(injected), fam, transcript)` (fills `from`/ids, drops empties, `.strict()` schema parse).
4. Parse/pipeline failure on attempt 1 ⇒ `onEvent({kind:'cloud-retry',attempt:2})`, retry once; failure again ⇒ `CONNECTOR_BAD_RESPONSE`.
5. SDK errors classified via typed classes (never string-match): `Anthropic.AuthenticationError`⇒AUTH_INVALID; `Anthropic.RateLimitError`⇒RATE_LIMITED; `Anthropic.BadRequestError` whose message mentions credit/billing⇒NO_CREDIT; `Anthropic.APIConnectionTimeoutError`⇒TIMEOUT; `Anthropic.APIConnectionError`⇒OFFLINE; other `Anthropic.APIError` ⇒ BAD_RESPONSE. SDK errors are NOT retried by the attempt loop (the SDK's own `maxRetries:1` handles transient 5xx).
6. Success ⇒ `applyGeneratedMeta(note, { model: CLOUD_MODEL, promptVersion: CLOUD_PROMPT_VERSION, language, durationSec, origin: 'claude' })` → return with telemetry. **Never log key/transcript/note.**

- [ ] **Step 1: Write failing tests** — mock client returning: (a) valid meeting-note JSON ⇒ resolves, note.origin==='claude', generatedBy.model===CLOUD_MODEL, telemetry.attempts===1; (b) garbage then valid ⇒ resolves, attempts===2, onEvent saw cloud-retry; (c) garbage twice ⇒ rejects CONNECTOR_BAD_RESPONSE; (d) throws `Anthropic.AuthenticationError` ⇒ CONNECTOR_AUTH_INVALID; (e) no key ⇒ CONNECTOR_NO_KEY without client construction; (f) fence-wrapped ```json output parses; (g) oversized transcript ⇒ CONNECTOR_TRANSCRIPT_TOO_LONG without client call. Build the valid-note fixture from the REAL MeetingNoteSchema shape minus postDecodeOnly/system-meta fields (this is also the executable proof the stub-injection + pipeline contract holds — the test fails if pipeline stage 4 rejects).
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement per the flow contract** (single file, ~150 lines; DI shape copied from `model-downloader.ts:43`).
- [ ] **Step 4: Run** — connector tests + `tsc --noEmit` + `pnpm --filter @lisna/desktop lint`. Expected: PASS.
- [ ] **Step 5: Stage & report.**

---

### Task 6: Finalize branch — target arg, transcript-only context, cloud progress

**Files:**
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts` (args :42-45/:193, deps :103-179, handlers :283/:314, `KNOWN_FAMILIES` gate :294, language gate :232)
- Modify: `desktop/src/main/ipc.ts` (`runGenerationContext` :518-582 — `needLlm` param skipping steps E/F; deps wiring :667-781; progress payload)
- Modify: `desktop/src/main/dump-finalize-context.ts` (skip-LLM variant for from-dump regen — it loads the LLM unconditionally today)
- Modify: `desktop/src/shared/ipc-protocol.ts` (FinalizeProgressPayload: add `{ kind: 'cloud-start' }` / `{ kind: 'cloud-retry'; attempt: number }` kinds)
- Modify: `desktop/src/preload/index.ts` (finalize/finalizeFromDump arg types carry `target`)
- Test: extend `desktop/src/main/__tests__/ipc.test.ts` + session-finalize tests (re-read live layout first)

**Interfaces:**
- Consumes: Task 5 `generateCloudNote`/`CLOUD_MODEL`; Task 1 `loadApiKey` (target-gate check).
- Produces: `SessionFinalizeArgs`/`SessionFinalizeFromDumpArgs` gain `target?: 'ondevice' | 'claude'` (default `'ondevice'` — absent field keeps every existing caller byte-identical). Renderer relies on: `window.lisna.finalize({ family, target })`, cloud progress kinds on the SAME `session/finalize-progress` channel.

**Contract (each numbered item = a test):**
1. `target: 'claude'` + key present ⇒ handler resolves a transcript-only session (STT steps A–D run; **LLM load step E and sidecar-wrap F are skipped**), emits `cloud-start`, calls `generateCloudNote`, settles through `onSessionSettled` with the SAME `SessionSettleResult` shape (note lands in dump `note.json` — History/NoteView pick it up with zero changes there).
2. `target: 'claude'` + NO key ⇒ throws `CONNECTOR_NO_KEY` BEFORE any STT work.
3. `target` absent / `'ondevice'` ⇒ byte-identical behavior to today (regression: existing ipc.test.ts finalize tests pass unmodified).
4. The cloud branch runs INSIDE `beginGeneration()`/settle — a second finalize during cloud generation throws `FINALIZE_IN_FLIGHT`; settle fires on both success and error (idle-stop re-arms; `genInFlight` clears).
5. From-dump regen with `target:'claude'` uses the skip-LLM dump context (no LLM load).
6. Language notes-gate (:232): applies ONLY to the ondevice branch (Claude handles ko/en natively; the gate exists because the 3B can't).
7. Cloud errors settle as `{ ok: false, family, error: <code> }` in `result.json` — same as on-device failures (diagnosability precedent).

Implementation sketch for the branch (verify against live code — the handler body around :297):

```ts
const target = args.target === 'claude' ? 'claude' : 'ondevice';
if (target === 'claude' && (await deps.loadApiKey()) === null) throw new Error('CONNECTOR_NO_KEY');
// inside the beginGeneration-guarded body:
if (target === 'claude') {
  const ctx = await deps.getCurrentSessionTranscriptOnly();      // runGenerationContext({ needLlm: false })
  deps.emitProgress({ kind: 'cloud-start' });
  const transcript = adaptToV2Transcript(ctx.segments);           // same adapter routeFamily uses (:237)
  const { note } = await generateCloudNote(
    { family, transcript, language: ctx.language, durationSec: ctx.durationSec },
    { onEvent: (e) => deps.emitProgress(e) },
  );
  return settleAndReturn(note, ctx);                              // identical settle path as routeFamily results
}
```

- [ ] **Step 1: Write the failing tests** (contract items 1–7; mock `generateCloudNote` module + reuse the existing electron/engine mocks in ipc.test.ts).
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — smallest diff satisfying the contract: `needLlm` param on `runGenerationContext` (default true), `getCurrentSessionTranscriptOnly` dep, `target` on both arg types, the branch, progress kinds, gate reorder. Re-read every cited region first; the step-E skip MUST NOT skip steps A–D (dump dir, STT, EMPTY_RECORDING guard, transcript.json write).
- [ ] **Step 4: Run** — `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/ipc.test.ts src/main/sidecar/ipc src/main/connector && pnpm --filter @lisna/desktop exec tsc --noEmit && pnpm --filter @lisna/desktop lint`. Expected: ALL PASS incl. untouched on-device finalize tests.
- [ ] **Step 5: Stage & report.**

---

### Task 7: Connector error codes → JA copy

**Files:**
- Modify: `desktop/src/renderer/i18n/error-message-map.ts` (follow the header's 3-step recipe; ALL_ERROR_CODES :22-58)
- Test: extend its existing `__tests__` (style invariants are pinned there — new entries must satisfy polite-form/「。」 rules)

**Interfaces:** Consumes the 8 codes from Task 5. Produces JA copy the chip/ConnectorView render via `toFriendlyJa`.

- [ ] **Step 1: Failing test** — assert each of the 8 `CONNECTOR_*` codes is in `ALL_ERROR_CODES` and maps to non-empty JA copy ending in 「。」.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — copy set (adjust to house style against the live file's tone):

| Code | JA copy |
|---|---|
| CONNECTOR_NO_KEY | `Claudeが接続されていません。設定から接続してください。` |
| CONNECTOR_AUTH_INVALID | `APIキーが無効です。Anthropicコンソールで確認し、接続し直してください。` |
| CONNECTOR_RATE_LIMITED | `リクエストが混み合っています。しばらくしてからもう一度お試しください。` |
| CONNECTOR_NO_CREDIT | `Anthropicアカウントのクレジット残高が不足しています。チャージ後にもう一度お試しください。` |
| CONNECTOR_OFFLINE | `ネットワークに接続できません。接続を確認してからもう一度お試しください。` |
| CONNECTOR_TIMEOUT | `Claudeの応答がタイムアウトしました。もう一度お試しください。` |
| CONNECTOR_BAD_RESPONSE | `ノートの生成結果を読み取れませんでした。もう一度お試しいただくか、オンデバイス生成をご利用ください。` |
| CONNECTOR_TRANSCRIPT_TOO_LONG | `文字起こしが長すぎるため、クラウド生成できません。オンデバイス生成をご利用ください。` |

- [ ] **Step 4: Run the i18n tests.** Expected: PASS.
- [ ] **Step 5: Stage & report.**

---

### Task 8: ConnectorView (connect UX + disclosure) + entry point

**Files:**
- Create: `desktop/src/renderer/i18n/connector-strings.ts` (model: `disclosure-strings.ts`)
- Create: `desktop/src/renderer/routes/ConnectorView.tsx` (structural template: `TermsView.tsx` — header + ← 戻る + prose + action rows)
- Modify: `desktop/src/renderer/App.tsx` (View union :43-52 gains `{ kind: 'connector' }` + renderView case; wire like the 'terms' case :338-339)
- Modify: `desktop/src/renderer/routes/Recording.tsx` (idle footer :387 — `Claude連携 ›` button next to 用語集, via a new `onOpenConnector` prop, wired exactly like `onOpenTerms`)
- Test: `desktop/src/renderer/routes/__tests__/ConnectorView.test.tsx` (follow NoteView.test.tsx conventions)

**Interfaces:** Consumes `window.lisna.connectorStatus/connectorConnect/connectorDisconnect` (Task 2), `toFriendlyJa` (Task 7). Produces: `<ConnectorView onBack={...} />`; App-level `connectorConnected: boolean` state (fetched on mount + after connect/disconnect — Task 9 passes it to FamilyPickerStep).

**View content (spec §7 disclosure — all strings in connector-strings.ts):**
- Title `Claude連携`, status line (未接続 / 接続済み).
- Disclosure block (ALWAYS visible, before the input): ①選んだ録音の文字起こしテキストだけが、あなた自身のAnthropicアカウントに直接送信されます（利用料はご自身のAPIキーに課金されます・ノート1件あたり数円〜十数円程度）。②音声がMacの外に出ることはありません。③Lisnaのサーバーが内容を見ることはありません。④接続はいつでも解除できます。
- `<input type="password">` (masked; never re-displays a stored key), `接続` button → `connectorConnect(key)` → success clears the field + flips status; failure shows `toFriendlyJa(err)` inline. `解除` button when connected.
- Styling: `--lz-*` tokens + `lz-primary`/`lz-label`/`lz-hint` classes ONLY (native-Mac; NO legal-pad decoration; do NOT copy FirstRunAudioNotice's hardcoded hex).

- [ ] **Step 1: Failing tests** — renders disclosure before connect; connect success path calls `connectorConnect` with the typed key, clears input, shows 接続済み; connect failure renders JA error; disconnect calls `connectorDisconnect`; back button fires `onBack`.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** (view + strings + App/Recording wiring).
- [ ] **Step 4: Run** — new test file + `tsc --noEmit` + lint. Expected: PASS.
- [ ] **Step 5: Stage & report.**

---

### Task 9: Target picker in FamilyPickerStep + App threading

**Files:**
- Modify: `desktop/src/renderer/components/FamilyPickerStep.tsx` (target `lz-seg` control above the submit row :135-142; upsell banner below the family list :123)
- Modify: `desktop/src/renderer/App.tsx` (`runFinalize` :552-560 + `runFinalizeFromDump` :597-605 pass `target`; `BackgroundJob` :512-525 gains `target`; `connectorConnected` from Task 8 passed down)
- Modify: `desktop/src/renderer/routes/History.tsx` (regen picker gets the same props :131-140)
- Test: extend/create FamilyPickerStep tests (follow existing renderer test conventions)

**Interfaces:** `FamilyPickerStep` Props gain `connectorConnected: boolean`, `onOpenConnector: () => void`; `onPick` (:65) widens to `onPick(choice, target: 'ondevice' | 'claude')`. Both mounts (App live + History regen) updated in the same task — the component has exactly two call sites.

**Behavior (spec §4-3):**
- Connected: `lz-seg` segmented control `[Claudeで生成] [オンデバイス]`, Claude preselected. Transcript-only choice ignores target (no note generated).
- Not connected: no segmented control; every pick is `'ondevice'`; a dismissible GlossaryAdded-style banner (`Claude連携でノート品質を上げられます → 設定`) with ✕; dismissal persisted `localStorage['lisna.claudeUpsellDismissed']` (App.tsx:136-138 ack pattern); banner's 設定 link fires `onOpenConnector`.

- [ ] **Step 1: Failing tests** — connected shows the seg with Claude preselected and `onPick(family,'claude')` on submit; switching seg yields `'ondevice'`; not-connected hides seg + always picks `'ondevice'`; upsell renders when not connected + not dismissed, ✕ persists dismissal; upsell hidden when connected.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** (component + both mounts + BackgroundJob.target threading into `window.lisna.finalize({family, target})`).
- [ ] **Step 4: Run** — component tests + `tsc --noEmit` + lint. Expected: PASS.
- [ ] **Step 5: Stage & report.**

---

### Task 10: Cloud progress chip, origin badges, cloud-error fallback action

**Files:**
- Modify: `desktop/src/renderer/components/NoteRenderProgress.tsx` (ProgressPhase :15 gains `'cloud'`; label `Claudeでノート生成中…` + elapsed line — no chunk counts on the cloud path)
- Modify: `desktop/src/renderer/App.tsx` (`applyFinalizeProgress` :455-503 folds `cloud-start`/`cloud-retry`; GenerationChip :622-654 cloud label + error-state extra action)
- Modify: `desktop/src/renderer/routes/NoteView.tsx` (header meta :59-63 appends `· Claude` / `· オンデバイス` from `note.origin` — absent ⇒ オンデバイス)
- Modify: `desktop/src/renderer/components/HistoryList.tsx` (:77-79 row meta) + `desktop/src/renderer/routes/History.tsx` (:98-100 detail meta) using `DumpSummary.origin`/`DumpTranscript.origin` (absent ⇒ no badge, defensive like the `family` fallback :9)
- Test: extend App progress-fold tests / NoteView test / HistoryList test per existing conventions

**Interfaces:** Consumes Task 6's progress kinds + Task 4's origin fields + Task 7's JA copy. Origin labels live in `connector-strings.ts` (Task 8): `ORIGIN_LABEL_JA = { ondevice: 'オンデバイス', claude: 'Claude' }`.

**Cloud-error fallback (spec §6 — explicit offer, never silent):** when a BackgroundJob with `target:'claude'` errors, the error chip shows `toFriendlyJa(code)` (today the chip shows no message text — add it for cloud errors) + a `オンデバイスで再生成` button that re-runs the same family with `target:'ondevice'` (and, for CONNECTOR_NO_KEY/AUTH_INVALID, a `設定を開く` action → connector view).

- [ ] **Step 1: Failing tests** — `applyFinalizeProgress` maps cloud-start ⇒ phase 'cloud' and cloud-retry ⇒ attempt counter; NoteView renders `· Claude` for origin claude and `· オンデバイス` when absent; HistoryList renders badge only when origin present; cloud-error chip offers オンデバイスで再生成 which fires finalize with `target:'ondevice'`.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — touched renderer tests + `tsc --noEmit` + lint. Expected: PASS.
- [ ] **Step 5: Stage & report.**

---

### Task 11: PRD amendment, version bump, full verify

**Files:**
- Modify: `docs/PRD.md` (re-read it first; amend the on-device/privacy posture section)
- Modify: `desktop/package.json` (version 0.1.39 → 0.1.40)

- [ ] **Step 1: PRD amendment** — locate the "100% on-device" / privacy posture clause and amend to: notes are on-device by default; users may OPT IN to generating notes via their own Anthropic API key (transcript text sent directly user→Anthropic; audio never leaves; Lisna servers see nothing; per-recording choice). Cite spec §7/§8a. Do not touch pricing/quota sections.
- [ ] **Step 2: Version bump** to `0.1.40` (single site; release.yml gates tags on it).
- [ ] **Step 3: Full gate** — `pnpm --filter @lisna/desktop verify` (typecheck + lint + tests; FOREGROUND, never background). Expected: clean. Fix anything it surfaces before staging.
- [ ] **Step 4: Stage & report** — `git add docs/PRD.md desktop/package.json`.

---

## Verification & rollout (controller, after all tasks land)

1. Per-task: independent opus review gate → commit (house SDD flow).
2. Full suite: `pnpm --filter @lisna/desktop verify` foreground.
3. Packaged-app smoke (founder gate per `feedback_recording_via_desktop_app`): rebuild `/Applications/Lisna.app`, real recording → 設定→Claude連携 (founder's real key — the ONE credential ask) → note via Claude → origin badge + History regen + on-device fallback path.
4. Real-call latency/quality numbers recorded then (no key on dev machine — spec §8a).
5. Push + PR = founder-gated as always.

## Deliberate non-goals (v1, from spec §10)

No GPT/Gemini, no claude.ai-history write, no team connections, no removal of on-device, no auto-send-everything (per-recording choice stands), no streaming partial-note UI (chip + elapsed only), no NoteView "Ask Claude" (Phase B).
