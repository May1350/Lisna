# Lisna v2.0 Alpha — On-Device AI Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 `2026-05-12-on-device-v2-design.md` §1~10 을 macOS 14.4+ / Apple Silicon 16GB+ 환경에서 동작하는 사이닝·노터라이즈된 v2.0 알파 DMG 까지 구현. 단일 화자 모드, 4개 언어 (JA / EN / KO / ZH), 클라우드 fallback 없음, 시간 분할 STT↔LLM 메모리 모델.

**Architecture:** 3-process Electron app — Renderer (React+TS, UI) ↔ Main (Node, 오디오 캡쳐 + 사이드카 슈퍼바이저 + 모델 다운로더) ↔ AI Sidecar (C++ 단일 바이너리, whisper.cpp + llama.cpp Metal backend, stdin/stdout NDJSON IPC). STT 와 LLM 은 메모리 예산상 동시 상주 금지 — 사이드카가 OS-confirmed reclaim 까지 await 후 다음 모델을 로드.

**Tech Stack:**
- App shell: Electron 39+ (CoreAudio Tap 기본 enable 필요), `electron-vite`, React 18, TypeScript 5.x
- AI runtime (sidecar): C++17, CMake, whisper.cpp (Metal), llama.cpp (Metal), nlohmann/json
- Models (Q4 GGUF):
  - STT: Kotoba-Whisper v2.0 (JA, ~0.4GB), Distil-Whisper Large-v3 (EN, ~0.4GB), Whisper Large-v3 (KO/ZH, ~1.5GB)
  - LLM: Gemma 4 4B Q4 if available at freeze, otherwise Gemma 3 4B Q4 (~2.5GB)
- Tests: vitest (TS), GoogleTest (C++), Playwright (Electron E2E)
- Packaging: electron-builder, electron-updater, Apple Developer ID 코드 사이닝 + 노터라이즈
- Monorepo: 기존 pnpm workspace 에 `desktop` 패키지 신규 추가

**External blockers (병렬 트랙):**
- **Apple Developer ID:** 이미 enrolled 가정. 미가입 상태면 등록 1~3 영업일. Phase 6 시작 전 확인 필수.
- **Hugging Face 모델 호스팅:** Kotoba-Whisper / Distil-Whisper / Whisper Large-v3 / Gemma 4B GGUF — HF Hub 공개 다운로드 OR 우리가 R2/S3 에 미러링. 라이선스 (Apache 2.0 / Gemma terms) 확인 후 결정. Phase 4 시작 전 결정 필요.
- **50-meeting JA eval-set (v2.1 dependency):** *이 plan 범위 밖.* 스펙 §9 Risk 7 에 따라 v2.0 freeze 전 owner 지정 필요 — 별도 워크스트림으로 발주. plan 종료 후 별도 결정 항목.
- **개발 하드웨어:** M1 16GB Mac (또는 동급) 한 대 + 테스트 매트릭스 (M1/M2/M3 16GB, 가능하면 KO/ZH 사용자 시연용 M1 16GB) 확보.

---

## File Structure

```
Lisna/
├── pnpm-workspace.yaml             # NEW: 'desktop' 워크스페이스 추가
├── desktop/                        # NEW: v2 Electron 앱 워크스페이스
│   ├── package.json                # Electron 39+, electron-vite, electron-builder 핀
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── electron.vite.config.ts     # electron-vite 설정 (main / preload / renderer 빌드)
│   ├── electron-builder.yml        # macOS dmg target, 사이닝/노터라이즈/extraResources
│   ├── README.md                   # 빌드/실행 절차
│   ├── src/
│   │   ├── main/                   # Electron Main process (Node.js)
│   │   │   ├── index.ts            # 엔트리: BrowserWindow + 앱 lifecycle
│   │   │   ├── audio/
│   │   │   │   ├── microphone.ts   # getUserMedia 래퍼 + permission flow
│   │   │   │   ├── system-audio.ts # desktopCapturer.enableLocalLoopback
│   │   │   │   ├── chunker.ts      # 2s 초기 / 10s 후속 청크 파이프라인
│   │   │   │   ├── encoder.ts      # Float32 → 16kHz mono Float32 (whisper input)
│   │   │   │   └── index.ts        # 외부 API: startRecording / stopRecording / onChunk
│   │   │   ├── sidecar/
│   │   │   │   ├── supervisor.ts   # spawn + crash detection + restart
│   │   │   │   ├── client.ts       # NDJSON stdin/stdout 래퍼
│   │   │   │   ├── protocol.ts     # request/response/event 타입
│   │   │   │   └── orchestrator.ts # 시간 분할 load/unload 시퀀스
│   │   │   ├── downloader/
│   │   │   │   ├── manifest.ts     # 모델 카탈로그 (url, size, sha256)
│   │   │   │   ├── manager.ts      # 다운로드 큐 + resume + 검증
│   │   │   │   └── ram-pressure.ts # 호스트 free RAM watcher → pause/resume
│   │   │   ├── platform/
│   │   │   │   ├── hardware-check.ts # M1+ / 16GB+ / macOS 14.4+ 게이트
│   │   │   │   ├── mac-permissions.ts # mic / system audio TCC prompt 헬퍼
│   │   │   │   └── paths.ts        # userData / 모델 디렉토리 위치
│   │   │   └── ipc.ts              # renderer ↔ main 채널 정의 (ipcMain.handle)
│   │   ├── preload/
│   │   │   └── index.ts            # contextBridge.exposeInMainWorld('lisna', {...})
│   │   ├── renderer/               # React UI (Vite)
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── routes/             # 단순 라우팅: setup / record / notes / settings
│   │   │   │   ├── FirstRunSetup.tsx
│   │   │   │   ├── Recording.tsx
│   │   │   │   ├── NoteView.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── components/
│   │   │   │   ├── RecordingControls.tsx
│   │   │   │   ├── LanguagePicker.tsx
│   │   │   │   ├── DownloadProgress.tsx
│   │   │   │   ├── HardwareCheckGate.tsx
│   │   │   │   └── BelowFloorRedirect.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useRecording.ts
│   │   │   │   ├── useDownloadStatus.ts
│   │   │   │   └── useNote.ts
│   │   │   ├── i18n/               # v1 i18n 테이블 포팅
│   │   │   │   ├── index.ts
│   │   │   │   ├── ja.json
│   │   │   │   ├── en.json
│   │   │   │   ├── ko.json
│   │   │   │   └── zh.json
│   │   │   └── styles/
│   │   │       └── tokens.css      # v1 design tokens 포팅
│   │   └── shared/
│   │       ├── engine-interfaces.ts # STTEngine, LLMEngine (스펙 §5)
│   │       ├── ipc-protocol.ts      # sidecar 프로토콜 + renderer ↔ main 메시지
│   │       └── types.ts             # Language, ModelDescriptor, TranscriptSegment, Note
│   ├── sidecar/                    # C++ AI 바이너리
│   │   ├── CMakeLists.txt          # whisper.cpp + llama.cpp + sidecar
│   │   ├── deps/
│   │   │   ├── whisper.cpp/        # git submodule
│   │   │   ├── llama.cpp/          # git submodule
│   │   │   └── json/               # nlohmann/json single-header 또는 submodule
│   │   ├── src/
│   │   │   ├── main.cpp            # stdin NDJSON 이벤트 루프
│   │   │   ├── ipc/
│   │   │   │   ├── json_protocol.h
│   │   │   │   └── json_protocol.cpp
│   │   │   ├── stt/
│   │   │   │   ├── whisper_engine.h
│   │   │   │   └── whisper_engine.cpp
│   │   │   ├── llm/
│   │   │   │   ├── llama_engine.h
│   │   │   │   └── llama_engine.cpp
│   │   │   └── memory/
│   │   │       ├── os_reclaim.h    # madvise(MADV_DONTNEED) + mach_vm 검증
│   │   │       └── os_reclaim.cpp
│   │   ├── tests/                  # GoogleTest
│   │   │   ├── CMakeLists.txt
│   │   │   ├── test_json_protocol.cpp
│   │   │   ├── test_whisper_engine.cpp
│   │   │   ├── test_llama_engine.cpp
│   │   │   └── test_os_reclaim.cpp
│   │   └── scripts/
│   │       └── build.sh            # CMake 빌드 + 결과물을 resources/ 로 복사
│   ├── resources/                  # extraResources 출처 (signed sidecar 바이너리 위치)
│   │   └── .gitkeep
│   ├── tests/
│   │   ├── e2e/                    # Playwright Electron
│   │   │   ├── smoke.spec.ts
│   │   │   └── record-and-note.spec.ts
│   │   ├── soak/                   # Phase 5 시간 분할 메모리 소크
│   │   │   ├── soak-harness.ts
│   │   │   └── memory-probe.ts
│   │   └── fixtures/
│   │       ├── audio/              # 30s / 1h 일본어·영어 샘플
│   │       └── transcripts/        # 기대 전사 결과
│   └── ci/
│       └── gates.ts                # Electron 버전 / TS / lint / soak 결과 통합 게이트
```

**구조 결정 요약:**
- 모노레포 안에 `desktop/` 워크스페이스를 추가. v1 (`extension/`) 은 그대로 살아있고 — 스펙 §6 PRD 정책상 v2.0 출시 후에도 v1 은 "validation infrastructure" 로 유지.
- 사이드카는 **하나의 C++ 바이너리** 에 whisper.cpp + llama.cpp 양쪽 정적 링크. IPC 프로토콜로 `loadModel({kind: "stt"|"llm", ...})` 명령으로 어떤 엔진을 띄울지 결정.
- TS 인터페이스 (`STTEngine`, `LLMEngine`) 는 메인 프로세스의 사이드카 클라이언트 위에 얹혀서, 향후 v3.0 WhisperKit/MLX 재작성 때 *조직화 경계* 역할만 함 (스펙 §5 의 "informed rewrite, not swap" 명시).

---

## Phase 0 — 프로젝트 부트스트랩

목표: `desktop/` 워크스페이스 생성, Electron 39+ 빈 윈도우 띄우기, CI 게이트 (Electron 버전 / lint / TS) 정착. 이후 모든 phase 의 기반.

### Task 0.1: `desktop` 워크스페이스 디렉토리 생성

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `desktop/package.json`
- Create: `desktop/.gitignore`

- [ ] **Step 1: pnpm-workspace.yaml 에 `desktop` 추가**

```yaml
packages:
  - 'extension'
  - 'backend'
  - 'web'
  - 'shared'
  - 'desktop'
```

- [ ] **Step 2: `desktop/package.json` 작성**

```json
{
  "name": "@lisna/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:sidecar": "bash sidecar/scripts/build.sh",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "package": "pnpm build:sidecar && pnpm build && electron-builder --mac"
  }
}
```

- [ ] **Step 3: `desktop/.gitignore` 작성**

```
node_modules
out
dist
resources/sidecar
resources/models
sidecar/build
sidecar/deps/whisper.cpp/build
sidecar/deps/llama.cpp/build
*.log
.DS_Store
```

- [ ] **Step 4: pnpm install 로 워크스페이스 인식 확인**

Run: `cd /Users/guntak/Lisna && pnpm install`
Expected: `@lisna/desktop` 가 `pnpm -r ls --depth 0` 출력에 나타남.

- [ ] **Step 5: 커밋**

```bash
git add pnpm-workspace.yaml desktop/package.json desktop/.gitignore
git commit -m "feat(desktop): bootstrap desktop workspace skeleton"
```

---

### Task 0.2: Electron 39+ + electron-vite + React TS scaffold

**Files:**
- Create: `desktop/electron.vite.config.ts`
- Create: `desktop/tsconfig.json`
- Create: `desktop/tsconfig.node.json`
- Create: `desktop/src/main/index.ts`
- Create: `desktop/src/preload/index.ts`
- Create: `desktop/src/renderer/index.html`
- Create: `desktop/src/renderer/main.tsx`
- Create: `desktop/src/renderer/App.tsx`
- Modify: `desktop/package.json` (dependencies)

- [ ] **Step 1: 의존성 추가**

Run:
```bash
cd desktop && pnpm add -D \
  electron@^39.0.0 \
  electron-vite@^3.0.0 \
  electron-builder@^25.0.0 \
  vite@^5.4.0 \
  @vitejs/plugin-react@^4.3.0 \
  typescript@~5.5.0 \
  @types/node@^20 \
  eslint@^9 \
  vitest@^2
pnpm add react@^18 react-dom@^18
pnpm add -D @types/react@^18 @types/react-dom@^18
```

CI 게이트는 Task 0.3 에서 Electron < 39 일 때 실패하도록 추가.

- [ ] **Step 2: `desktop/electron.vite.config.ts` 작성**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main', rollupOptions: { input: 'src/main/index.ts' } },
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload', rollupOptions: { input: 'src/preload/index.ts' } },
  },
  renderer: {
    plugins: [react()],
    build: { outDir: 'out/renderer' },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    root: 'src/renderer',
  },
});
```

- [ ] **Step 3: `desktop/tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vite/client"],
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: `desktop/src/main/index.ts` 빈 BrowserWindow**

```ts
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 5: `desktop/src/preload/index.ts` 스텁**

```ts
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('lisna', { ping: () => 'pong' });
```

- [ ] **Step 6: 렌더러 스캐폴드 작성**

`desktop/src/renderer/index.html`:
```html
<!doctype html>
<html><head><meta charset="UTF-8"><title>Lisna</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

`desktop/src/renderer/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);
```

`desktop/src/renderer/App.tsx`:
```tsx
export function App() {
  return <main style={{ fontFamily: 'system-ui', padding: 24 }}>
    <h1>Lisna v2 — on-device</h1>
    <p>Phase 0 scaffold. Models not loaded yet.</p>
  </main>;
}
```

- [ ] **Step 7: `pnpm dev` 로 윈도우 띄우기 검증**

Run: `cd desktop && pnpm dev`
Expected: Electron 윈도우가 뜨고 "Lisna v2 — on-device" 표시. devtools 콘솔에 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add desktop/
git commit -m "feat(desktop): electron-vite + React skeleton renders empty window"
```

---

### Task 0.3: CI 게이트 — Electron 39+ 강제 + lint + typecheck

**Files:**
- Create: `desktop/ci/gates.ts`
- Create: `.github/workflows/desktop.yml` (이미 GH Actions 가 있으면 기존 워크플로우에 잡 추가)
- Modify: `desktop/package.json` (`scripts.ci`)

- [ ] **Step 1: 게이트 스크립트 작성**

`desktop/ci/gates.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const range = pkg.devDependencies?.electron ?? '';
const minMajor = Number(range.replace(/[^\d.]/g, '').split('.')[0]);
if (!Number.isFinite(minMajor) || minMajor < 39) {
  console.error(`CI gate failed: Electron ${range} < 39 (CoreAudio Tap 요구). 스펙 §7 참고.`);
  process.exit(1);
}
console.log(`Electron version gate OK (>= ${minMajor})`);
```

- [ ] **Step 2: `desktop/package.json` 의 scripts 에 ci 추가**

```json
{
  "scripts": {
    "ci": "tsx ci/gates.ts && pnpm typecheck && pnpm lint && pnpm test"
  }
}
```

(`tsx` 가 없으면 `pnpm add -D tsx` 추가)

- [ ] **Step 3: 일부러 Electron 핀을 ^38 로 내려서 게이트 실패 확인**

Run: 임시로 `electron: "^38.0.0"` 으로 수정 후 `pnpm ci`
Expected: 게이트가 `Electron ... < 39` 로 실패. 다시 ^39 로 되돌리고 `pnpm ci` 통과.

- [ ] **Step 4: GitHub Actions 잡 (또는 기존 워크플로우) 추가**

`.github/workflows/desktop.yml` (저장소에 이미 워크플로우가 있으면 매트릭스 잡 추가로 대체):
```yaml
name: desktop-ci
on: [pull_request, push]
jobs:
  ci:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @lisna/desktop ci
```

- [ ] **Step 5: 커밋**

```bash
git add desktop/ci .github/workflows/desktop.yml desktop/package.json
git commit -m "ci(desktop): gate Electron >= 39, wire typecheck+lint+test"
```

---

### Task 0.4: 공유 타입 — STTEngine / LLMEngine / IPC 프로토콜 스켈레톤

**Files:**
- Create: `desktop/src/shared/engine-interfaces.ts`
- Create: `desktop/src/shared/ipc-protocol.ts`
- Create: `desktop/src/shared/types.ts`
- Create: `desktop/src/shared/__tests__/types.test.ts`

목표: 스펙 §5 의 인터페이스를 코드로 박아둔다. 이후 phase 에서 구현이 이 시그니처를 어기지 못하게 함.

- [ ] **Step 1: 실패하는 타입 일치성 테스트 작성**

`desktop/src/shared/__tests__/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { STTEngine, LLMEngine, Language, TranscriptSegment } from '../engine-interfaces';
import { SUPPORTED_LANGUAGES } from '../types';

describe('shared types', () => {
  it('SUPPORTED_LANGUAGES 는 JA/EN/KO/ZH 4종만', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['ja', 'en', 'ko', 'zh']);
  });

  it('STTEngine.transcribe 는 Float32Array 를 받고 segments 배열을 돌려준다', () => {
    const e: STTEngine = {
      loadModel: async () => {},
      unloadModel: async () => {},
      transcribe: async () => ([] as TranscriptSegment[]),
    };
    expect(typeof e.transcribe).toBe('function');
  });

  it('LLMEngine.generate 는 AsyncIterable<string> 을 돌려준다', async () => {
    const e: LLMEngine = {
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async function* () { yield 'a'; yield 'b'; },
    };
    const out: string[] = [];
    for await (const tok of e.generate('hi', {})) out.push(tok);
    expect(out).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd desktop && pnpm test`
Expected: FAIL — `../engine-interfaces` 와 `../types` 가 아직 없음.

- [ ] **Step 3: `desktop/src/shared/types.ts` 작성**

```ts
export type Language = 'ja' | 'en' | 'ko' | 'zh';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['ja', 'en', 'ko', 'zh'] as const;

export interface ModelDescriptor {
  kind: 'stt' | 'llm';
  language?: Language;       // stt 만 사용
  filename: string;          // gguf 파일명
  sizeBytes: number;
  sha256: string;
  source: { url: string };   // hf hub or self-mirror
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface Note {
  language: Language;
  generatedAt: string;       // ISO
  markdown: string;
  transcriptSegments: TranscriptSegment[];
}
```

- [ ] **Step 4: `desktop/src/shared/engine-interfaces.ts` 작성**

```ts
import type { Language, TranscriptSegment } from './types';

export type { Language, TranscriptSegment };

export interface STTEngine {
  /** GGUF 모델 파일 로드. 호출 후 transcribe 가능 상태로 만든다. */
  loadModel(path: string, language: Language): Promise<void>;
  /** OS-confirmed reclamation 까지 대기 (스펙 §4 — 단순 Promise resolve 가 아닌, madvise + mach_vm 검증까지). */
  unloadModel(): Promise<void>;
  /**
   * 한 번 호출 = 약 10초 청크 1개 (마지막 부분 청크는 더 짧을 수 있음).
   * 청킹은 호출자(오디오 캡쳐 파이프라인) 책임. 엔진은 내부 스트리밍/클록 보유 안 함.
   */
  transcribe(audio: Float32Array): Promise<TranscriptSegment[]>;
}

export interface GenOpts {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface LLMEngine {
  loadModel(path: string): Promise<void>;
  unloadModel(): Promise<void>;
  generate(prompt: string, opts: GenOpts): AsyncIterable<string>;
}
```

- [ ] **Step 5: `desktop/src/shared/ipc-protocol.ts` 작성 (sidecar 프로토콜)**

```ts
import type { Language, TranscriptSegment } from './types';

export type SidecarRequest =
  | { id: string; type: 'load'; kind: 'stt'; path: string; language: Language }
  | { id: string; type: 'load'; kind: 'llm'; path: string }
  | { id: string; type: 'unload'; kind: 'stt' | 'llm' }
  | { id: string; type: 'transcribe'; audioBase64: string; sampleRate: number }
  | { id: string; type: 'generate'; prompt: string; maxTokens?: number; temperature?: number; stop?: string[] };

export type SidecarResponse =
  | { id: string; type: 'ok' }                                       // load/unload 성공
  | { id: string; type: 'segments'; segments: TranscriptSegment[] }  // transcribe 결과
  | { id: string; type: 'token'; token: string }                     // generate 스트리밍 1 token
  | { id: string; type: 'done' }                                     // generate 종료
  | { id: string; type: 'error'; code: string; message: string };

export type SidecarEvent =
  | { type: 'ready'; pid: number; version: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'memory'; rssBytes: number; phase: 'idle' | 'stt' | 'llm' | 'transition' };
```

- [ ] **Step 6: 테스트 재실행 — 통과 확인**

Run: `cd desktop && pnpm test`
Expected: PASS (3 tests).

- [ ] **Step 7: 커밋**

```bash
git add desktop/src/shared
git commit -m "feat(desktop): lock STTEngine/LLMEngine + sidecar IPC types"
```

---

## Phase 1 — 오디오 캡쳐 (마이크 + 시스템 오디오)

목표: Renderer 의 녹음 버튼 → Main 의 캡쳐 파이프라인 → 16kHz mono Float32 청크가 IPC 이벤트로 흘러나오는 상태까지. 사이드카는 아직 없음 — 청크는 임시 디스크 저장으로 검증.

스펙 근거: §1 macOS 14.4 + CoreAudio Tap floor, §2 10s 청크 (첫 청크 ~2s), §6 macOS 13 graceful degradation (mic-only).

### Task 1.1: Renderer → Main IPC 채널 + Recording 화면 스켈레톤

**Files:**
- Create: `desktop/src/main/ipc.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Create: `desktop/src/renderer/routes/Recording.tsx`
- Modify: `desktop/src/renderer/App.tsx`

- [ ] **Step 1: IPC 채널 이름 + 메인 핸들러 작성**

`desktop/src/main/ipc.ts`:
```ts
import { ipcMain } from 'electron';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  onChunk: 'recording/chunk',
} as const;

export function registerIpc() {
  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Phase 1 후속 task 에서 audio/index.ts 의 startRecording 호출로 교체
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
}
```

`desktop/src/main/index.ts` 의 `app.whenReady().then(...)` 전에 `registerIpc()` 호출 추가.

- [ ] **Step 2: preload 에서 contextBridge 노출**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc';

contextBridge.exposeInMainWorld('lisna', {
  startRecording: (source: 'mic' | 'system') => ipcRenderer.invoke(CHANNELS.startRecording, { source }),
  stopRecording: () => ipcRenderer.invoke(CHANNELS.stopRecording),
  onChunk: (cb: (chunk: { index: number; durationMs: number }) => void) => {
    const sub = (_: unknown, payload: { index: number; durationMs: number }) => cb(payload);
    ipcRenderer.on(CHANNELS.onChunk, sub);
    return () => ipcRenderer.off(CHANNELS.onChunk, sub);
  },
});

declare global {
  interface Window {
    lisna: {
      startRecording(source: 'mic' | 'system'): Promise<{ ok: boolean; source: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      onChunk(cb: (chunk: { index: number; durationMs: number }) => void): () => void;
    };
  }
}
```

- [ ] **Step 3: Recording 라우트 + App 라우팅 추가**

`desktop/src/renderer/routes/Recording.tsx`:
```tsx
import { useState } from 'react';

export function Recording() {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState(0);

  async function start() {
    await window.lisna.startRecording('mic');
    setRunning(true);
    window.lisna.onChunk(() => setChunks(c => c + 1));
  }
  async function stop() { await window.lisna.stopRecording(); setRunning(false); }

  return <section>
    <h2>Recording (Phase 1 stub)</h2>
    <button onClick={running ? stop : start}>{running ? 'Stop' : 'Start'}</button>
    <p>Chunks captured: {chunks}</p>
  </section>;
}
```

`App.tsx` 를 Recording 페이지가 기본 화면이 되도록 수정.

- [ ] **Step 4: `pnpm dev` 로 버튼 클릭 → IPC 왕복 확인**

Run: `cd desktop && pnpm dev`
Expected: Start 클릭 → 메인 콘솔에 핸들러 호출 로그. 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add desktop/src/main/ipc.ts desktop/src/main/index.ts desktop/src/preload desktop/src/renderer
git commit -m "feat(desktop): wire recording start/stop IPC scaffold"
```

---

### Task 1.2: 마이크 캡쳐 — getUserMedia + 권한 플로우

**Files:**
- Create: `desktop/src/renderer/audio/mic-capture.ts`
- Create: `desktop/src/renderer/audio/__tests__/mic-capture.test.ts`
- Create: `desktop/src/main/platform/mac-permissions.ts`

**설계 메모:** Electron 39 에서 `desktopCapturer.enableLocalLoopback` 로 시스템 오디오를 *Renderer 의 `getUserMedia`* 로 가져온다 — 캡쳐는 메인이 아닌 렌더러에서 일어남. 마이크도 동일하게 렌더러의 `getUserMedia` 가 표준. 따라서 캡쳐 코드는 **렌더러 측**, 청크 인코딩 후 메인으로 ArrayBuffer 전송하는 구조.

- [ ] **Step 1: 실패 테스트 — vitest 환경에 MediaStream stub 으로 mic-capture 검증**

`desktop/src/renderer/audio/__tests__/mic-capture.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startMicCapture, stopMicCapture } from '../mic-capture';

describe('mic-capture', () => {
  beforeEach(() => {
    (globalThis as any).navigator = {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        } as unknown as MediaStream),
      },
    };
  });

  it('start 시 getUserMedia({audio:true}) 호출', async () => {
    await startMicCapture();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    await stopMicCapture();
  });

  it('stop 은 트랙 stop() 호출', async () => {
    const stop = vi.fn();
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValueOnce({ getTracks: () => [{ stop }] });
    await startMicCapture();
    await stopMicCapture();
    expect(stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd desktop && pnpm test`
Expected: FAIL — `../mic-capture` 미존재.

- [ ] **Step 3: 구현**

`desktop/src/renderer/audio/mic-capture.ts`:
```ts
let activeStream: MediaStream | null = null;

export async function startMicCapture(): Promise<MediaStream> {
  if (activeStream) return activeStream;
  activeStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return activeStream;
}

export async function stopMicCapture(): Promise<void> {
  if (!activeStream) return;
  for (const track of activeStream.getTracks()) track.stop();
  activeStream = null;
}
```

- [ ] **Step 4: macOS TCC 권한 헬퍼 — 첫 호출 실패 시 안내 메시지로 매핑**

`desktop/src/main/platform/mac-permissions.ts`:
```ts
import { systemPreferences } from 'electron';

export type Permission = 'microphone' | 'screen';

export async function ensurePermission(p: Permission): Promise<'granted' | 'denied'> {
  if (process.platform !== 'darwin') return 'granted';
  if (p === 'microphone') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return 'granted';
    const ok = await systemPreferences.askForMediaAccess('microphone');
    return ok ? 'granted' : 'denied';
  }
  // screen (시스템 오디오 캡쳐 시 시스템 화면 기록 권한 필요 — Task 1.4 에서 처리)
  const status = systemPreferences.getMediaAccessStatus('screen');
  return status === 'granted' ? 'granted' : 'denied';
}
```

- [ ] **Step 5: 테스트 통과 확인 + 실기 검증**

Run: `cd desktop && pnpm test`
Expected: PASS.

수동 검증: `pnpm dev` 후 Start 버튼 → 시스템 권한 프롬프트 한 번 노출 → 허용 시 콘솔에 stream active 로그. (이 검증을 위해 Recording.tsx 의 start 핸들러에서 startMicCapture 를 잠시 호출하여 확인.)

- [ ] **Step 6: 커밋**

```bash
git add desktop/src/renderer/audio desktop/src/main/platform/mac-permissions.ts
git commit -m "feat(audio): mic capture via getUserMedia + TCC permission helper"
```

---

### Task 1.3: 청크 파이프라인 — 2s 초기 / 10s 후속, 16kHz mono Float32

**Files:**
- Create: `desktop/src/renderer/audio/chunker.ts`
- Create: `desktop/src/renderer/audio/__tests__/chunker.test.ts`

**설계 메모:** AudioWorklet 으로 raw PCM (48kHz Float32) 을 캡쳐 → 16kHz 로 리샘플 (whisper 입력 표준) → 첫 2s, 이후 10s 단위로 컷. 청크 종료 시 콜백.

- [ ] **Step 1: 실패 테스트**

`desktop/src/renderer/audio/__tests__/chunker.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ChunkAccumulator } from '../chunker';

const SR = 16000;

describe('ChunkAccumulator (16kHz mono Float32, 2s 초기 / 10s 후속)', () => {
  it('첫 청크는 2초 (32000 샘플) 모이면 emit', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR));            // 1s
    expect(emitted).toHaveLength(0);
    acc.push(new Float32Array(SR));            // +1s = 2s
    expect(emitted).toHaveLength(1);
    expect(emitted[0].length).toBe(SR * 2);
  });

  it('두 번째 청크부터는 10초 (160000 샘플)', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR * 2));        // 첫 청크 emit
    acc.push(new Float32Array(SR * 9));        // 9s → 아직 모자람
    expect(emitted).toHaveLength(1);
    acc.push(new Float32Array(SR));            // +1s = 10s
    expect(emitted).toHaveLength(2);
    expect(emitted[1].length).toBe(SR * 10);
  });

  it('flush() 는 남은 잔여를 마지막 (부분) 청크로 emit', () => {
    const emitted: Float32Array[] = [];
    const acc = new ChunkAccumulator({ onChunk: c => emitted.push(c) });
    acc.push(new Float32Array(SR * 2));        // 첫 청크
    acc.push(new Float32Array(SR * 3));        // 잔여 3s
    acc.flush();
    expect(emitted).toHaveLength(2);
    expect(emitted[1].length).toBe(SR * 3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd desktop && pnpm test chunker`
Expected: FAIL.

- [ ] **Step 3: 구현**

`desktop/src/renderer/audio/chunker.ts`:
```ts
export const SAMPLE_RATE = 16000;

export interface ChunkAccumulatorOptions {
  onChunk(chunk: Float32Array): void;
  firstChunkSec?: number;   // default 2
  chunkSec?: number;        // default 10
}

export class ChunkAccumulator {
  private buffer: Float32Array[] = [];
  private bufferLen = 0;
  private chunkIndex = 0;
  private readonly firstSamples: number;
  private readonly subsequentSamples: number;
  private readonly onChunk: (c: Float32Array) => void;

  constructor(opts: ChunkAccumulatorOptions) {
    this.firstSamples = (opts.firstChunkSec ?? 2) * SAMPLE_RATE;
    this.subsequentSamples = (opts.chunkSec ?? 10) * SAMPLE_RATE;
    this.onChunk = opts.onChunk;
  }

  push(samples: Float32Array): void {
    this.buffer.push(samples);
    this.bufferLen += samples.length;
    const need = this.chunkIndex === 0 ? this.firstSamples : this.subsequentSamples;
    while (this.bufferLen >= need) {
      this.emit(need);
    }
  }

  flush(): void {
    if (this.bufferLen > 0) this.emit(this.bufferLen);
  }

  private emit(targetLen: number): void {
    const out = new Float32Array(targetLen);
    let written = 0;
    while (written < targetLen) {
      const head = this.buffer[0]!;
      const take = Math.min(head.length, targetLen - written);
      out.set(head.subarray(0, take), written);
      written += take;
      if (take === head.length) this.buffer.shift();
      else this.buffer[0] = head.subarray(take);
    }
    this.bufferLen -= targetLen;
    this.chunkIndex += 1;
    this.onChunk(out);
  }
}
```

- [ ] **Step 4: 테스트 통과**

Run: `cd desktop && pnpm test chunker`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add desktop/src/renderer/audio/chunker.ts desktop/src/renderer/audio/__tests__/chunker.test.ts
git commit -m "feat(audio): ChunkAccumulator with 2s-first/10s-rest segmentation"
```

---

### Task 1.4: 시스템 오디오 캡쳐 (CoreAudio Tap loopback)

**Files:**
- Create: `desktop/src/renderer/audio/system-capture.ts`
- Modify: `desktop/src/main/index.ts` (Electron 39 의 `setDisplayMediaRequestHandler`)
- Create: `desktop/src/main/audio/system-audio-handler.ts`

**설계 메모:** Electron 39 에서 시스템 오디오는 `getDisplayMedia` 로 가져오되, 메인 프로세스에서 `setDisplayMediaRequestHandler` 로 `enableLocalLoopback: true` 를 설정해야 함. 이게 CoreAudio Tap 을 활성화하는 핵심 스위치 (스펙 §2 / §7).

- [ ] **Step 1: 메인에서 loopback enable**

`desktop/src/main/audio/system-audio-handler.ts`:
```ts
import { session, desktopCapturer } from 'electron';

export function installSystemAudioHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: sources[0], audio: 'loopback', enableLocalLoopback: true });
  }, { useSystemPicker: false });
}
```

`desktop/src/main/index.ts` 의 `app.whenReady` 안에서 `installSystemAudioHandler()` 호출 추가.

- [ ] **Step 2: 렌더러 측 캡쳐 래퍼**

`desktop/src/renderer/audio/system-capture.ts`:
```ts
export async function startSystemAudioCapture(): Promise<MediaStream> {
  // video 는 받지만 즉시 stop 해서 오디오 트랙만 사용
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1 },
    audio: true,
  });
  for (const v of stream.getVideoTracks()) v.stop();
  return stream;
}

export function stopSystemAudioCapture(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}
```

- [ ] **Step 3: macOS 14.4+ 인지 검증하는 graceful gate**

`desktop/src/main/platform/hardware-check.ts` (Task 4.1 에서 본격 작성 — 여기서는 stub):
```ts
import os from 'node:os';

export function isMacAudioLoopbackSupported(): boolean {
  if (process.platform !== 'darwin') return false;
  // os.release() returns Darwin kernel; macOS 14.4 ≈ Darwin 23.4+
  const [maj, min] = os.release().split('.').map(Number);
  return (maj ?? 0) > 23 || ((maj ?? 0) === 23 && (min ?? 0) >= 4);
}
```

캡쳐 시작 시 false 면 mic-only 모드로 폴백하고 UI 에 한 줄 안내. (메시지 텍스트는 Task 4.4 i18n 에서 채움.)

- [ ] **Step 4: 수동 검증 (자동화 어려움 — TCC 권한 + 실기 필요)**

Run: `pnpm dev` → Recording 화면에서 "Capture system audio" 버튼 추가하여 startSystemAudioCapture 호출.
Expected:
- macOS 14.4+ + 권한 허용 시: 무성 (BlackHole 없이) 시스템 사운드가 트랙으로 옴.
- macOS 13.x: `enableLocalLoopback` 무시되거나 에러. mic-only 폴백 안내 노출.

검증 후 결과를 `desktop/docs/manual-verification.md` 에 메모로 기록 (있다면 append, 없으면 신규).

- [ ] **Step 5: 커밋**

```bash
git add desktop/src/main/audio/system-audio-handler.ts desktop/src/main/platform/hardware-check.ts desktop/src/renderer/audio/system-capture.ts desktop/src/main/index.ts
git commit -m "feat(audio): system audio loopback via Electron 39 enableLocalLoopback"
```

---

### Task 1.5: 녹음 오케스트레이터 — 캡쳐 → 청커 → 메인 IPC 청크 전송

**Files:**
- Create: `desktop/src/renderer/audio/orchestrator.ts`
- Create: `desktop/src/renderer/audio/__tests__/orchestrator.test.ts`
- Modify: `desktop/src/main/ipc.ts` (실제 chunk 수신 핸들러 추가)

- [ ] **Step 1: 실패 테스트 — orchestrator 가 청크 이벤트를 메인에 보낸다**

`desktop/src/renderer/audio/__tests__/orchestrator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from '../orchestrator';

describe('RecordingOrchestrator', () => {
  it('start→stop 1회 → 최소 1개 청크가 sender 로 흘러나간다', async () => {
    const sender = vi.fn();
    const fakeCapturer = {
      async start() { return { samplesPerCallback: 1600 }; },     // 0.1s
      tick(samples: Float32Array) { orch['onSamples'](samples); }, // 테스트용
      stop: vi.fn(),
    };
    const orch = new RecordingOrchestrator({ sender, capturer: fakeCapturer as any });
    await orch.start('mic');
    // 25 × 1600 = 40000 samples = 2.5s → 첫 청크 emit
    for (let i = 0; i < 25; i++) fakeCapturer.tick(new Float32Array(1600));
    await orch.stop();
    expect(sender).toHaveBeenCalled();
    const first = sender.mock.calls[0][0];
    expect(first.index).toBe(0);
    expect(first.samples.length).toBe(16000 * 2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd desktop && pnpm test orchestrator`
Expected: FAIL.

- [ ] **Step 3: 구현**

`desktop/src/renderer/audio/orchestrator.ts`:
```ts
import { ChunkAccumulator, SAMPLE_RATE } from './chunker';

export interface ChunkSender {
  (chunk: { index: number; samples: Float32Array; startMs: number; endMs: number }): void;
}

interface Capturer {
  start(onSamples: (s: Float32Array) => void): Promise<{ sampleRate: number }>;
  stop(): Promise<void>;
}

export class RecordingOrchestrator {
  private acc?: ChunkAccumulator;
  private capturer: Capturer;
  private sender: ChunkSender;
  private startMs = 0;
  private samplesSeen = 0;

  constructor(opts: { sender: ChunkSender; capturer: Capturer }) {
    this.capturer = opts.capturer;
    this.sender = opts.sender;
  }

  async start(_source: 'mic' | 'system'): Promise<void> {
    this.startMs = Date.now();
    this.samplesSeen = 0;
    let index = 0;
    this.acc = new ChunkAccumulator({
      onChunk: (chunk) => {
        const endMs = Math.round((this.samplesSeen / SAMPLE_RATE) * 1000);
        const startMs = endMs - Math.round((chunk.length / SAMPLE_RATE) * 1000);
        this.sender({ index: index++, samples: chunk, startMs, endMs });
      },
    });
    await this.capturer.start((s) => this.onSamples(s));
  }

  private onSamples(s: Float32Array) {
    this.samplesSeen += s.length;
    this.acc?.push(s);
  }

  async stop(): Promise<void> {
    await this.capturer.stop();
    this.acc?.flush();
  }
}
```

- [ ] **Step 4: AudioWorklet 기반 실 Capturer 작성**

`desktop/src/renderer/audio/worklet-capturer.ts`:
```ts
import { startMicCapture, stopMicCapture } from './mic-capture';
import { startSystemAudioCapture, stopSystemAudioCapture } from './system-capture';
import { SAMPLE_RATE } from './chunker';

const WORKLET_URL = new URL('./pcm-worklet.js', import.meta.url);

export function createCapturer(source: 'mic' | 'system') {
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let stream: MediaStream | null = null;

  return {
    async start(onSamples: (s: Float32Array) => void) {
      stream = source === 'mic' ? await startMicCapture() : await startSystemAudioCapture();
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.audioWorklet.addModule(WORKLET_URL.toString());
      node = new AudioWorkletNode(ctx, 'pcm-worklet');
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
      ctx.createMediaStreamSource(stream).connect(node);
      return { sampleRate: SAMPLE_RATE };
    },
    async stop() {
      node?.disconnect();
      await ctx?.close();
      if (stream) source === 'mic' ? await stopMicCapture() : stopSystemAudioCapture(stream);
    },
  };
}
```

`desktop/src/renderer/audio/pcm-worklet.js` (AudioWorkletProcessor — 별도 파일이어야 함):
```js
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // mono 채널 [0] 만 사용, 메인 스레드로 Float32Array 전송
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
```

(AudioContext 가 `sampleRate: 16000` 으로 생성되면 브라우저가 자동 리샘플. 대부분 환경에서 동작. 안 되는 환경은 phase 5 검증에서 catch.)

- [ ] **Step 5: 메인 측 청크 수신 핸들러**

`desktop/src/main/ipc.ts` 에 추가:
```ts
export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  chunk: 'recording/chunk',      // 렌더러 → 메인
  onChunk: 'recording/onChunk',  // 메인 → 렌더러 (UI 표시)
} as const;

// registerIpc 안에:
ipcMain.handle(CHANNELS.chunk, async (_e, payload: { index: number; samples: ArrayBuffer; startMs: number; endMs: number }) => {
  // Phase 2 에서 사이드카로 전달. 지금은 디스크에 dump 만.
  return { received: payload.index };
});
```

preload 에 `sendChunk` 추가.

orchestrator 의 sender 가 `window.lisna.sendChunk(...)` 를 호출하도록 Recording.tsx 에서 연결.

- [ ] **Step 6: 통합 수동 검증**

Run: `pnpm dev` → Start → 30초 녹음 → Stop.
Expected: 메인 콘솔에 청크 ~4개 (2s, 10s, 10s, 8s 잔여) 수신 로그. 디스크 dump 가 활성화돼있다면 4개 wav/raw 파일 생성.

- [ ] **Step 7: 커밋**

```bash
git add desktop/src/renderer/audio desktop/src/main/ipc.ts desktop/src/preload
git commit -m "feat(audio): end-to-end capture → chunker → main process IPC"
```

---

### Task 1.6: macOS 13 graceful degradation 통합

**Files:**
- Modify: `desktop/src/renderer/routes/Recording.tsx`
- Modify: `desktop/src/main/ipc.ts`
- Create: `desktop/src/renderer/components/SystemAudioUnavailableNotice.tsx`

- [ ] **Step 1: 메인에 capability 쿼리 IPC 추가**

```ts
// ipc.ts CHANNELS 에 추가
capabilities: 'platform/capabilities',

// handler
ipcMain.handle(CHANNELS.capabilities, () => ({
  systemAudio: isMacAudioLoopbackSupported(),
  platform: process.platform,
  osRelease: os.release(),
}));
```

- [ ] **Step 2: 렌더러에서 source picker UI 게이트**

Recording.tsx 가 mount 시 `window.lisna.capabilities()` 호출 → systemAudio false 이면 시스템 오디오 옵션 disabled + `<SystemAudioUnavailableNotice/>` 표시.

`SystemAudioUnavailableNotice.tsx`:
```tsx
export function SystemAudioUnavailableNotice() {
  return <aside style={{ background: '#fff7e6', padding: 12, borderRadius: 8 }}>
    macOS 14.4+ 부터 시스템 오디오 캡쳐가 지원됩니다. 현재 환경에서는 마이크 녹음만 가능합니다.
    (LMS 강의 브라우저 재생 시나리오는 macOS 업데이트 후 이용 가능.)
  </aside>;
}
```

(메시지 i18n 처리는 Task 4.4 에서 일괄.)

- [ ] **Step 3: 수동 검증 — macOS 13 머신 또는 `os.release()` 를 강제 stub 한 dev 환경에서 확인**

(Phase 0~1 은 dev 머신 1대로 진행 가정. macOS 13 검증은 Phase 6 packaging 직전 매트릭스 검증에서 한 번에 처리. 여기서는 stub 로만 검증 후 메모.)

수동 검증 로그를 `desktop/docs/manual-verification.md` 에 append.

- [ ] **Step 4: 커밋**

```bash
git add desktop/src
git commit -m "feat(audio): graceful mic-only fallback on macOS < 14.4"
```

---

## Phase 2 — STT 사이드카 (whisper.cpp, 일본어 우선)

목표: C++ 사이드카 바이너리가 stdin/stdout NDJSON 프로토콜로 `load → transcribe → unload` 사이클을 수행. 일본어 (Kotoba-Whisper v2.0) 한 가지 언어로 end-to-end 전사가 동작.

스펙 근거: §2 (모델 + 청크), §5 (사이드카 구조 + STTEngine 인터페이스), §7 (사이드카 supervisor + 크래시 복구).

### Task 2.1: C++ 사이드카 CMake 스캐폴드 + main loop

**Files:**
- Create: `desktop/sidecar/CMakeLists.txt`
- Create: `desktop/sidecar/src/main.cpp`
- Create: `desktop/sidecar/src/ipc/json_protocol.h`
- Create: `desktop/sidecar/src/ipc/json_protocol.cpp`
- Create: `desktop/sidecar/scripts/build.sh`
- Create: `desktop/sidecar/deps/json/json.hpp` (nlohmann/json single-header)

- [ ] **Step 1: 의존성 — nlohmann/json single-header 다운로드**

Run:
```bash
mkdir -p desktop/sidecar/deps/json
curl -L -o desktop/sidecar/deps/json/json.hpp \
  https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp
shasum -a 256 desktop/sidecar/deps/json/json.hpp
```
SHA256 을 README 에 기록.

- [ ] **Step 2: CMakeLists.txt 최소 본**

`desktop/sidecar/CMakeLists.txt`:
```cmake
cmake_minimum_required(VERSION 3.20)
project(lisna_sidecar CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(LISNA_WITH_TESTS "Build GoogleTest tests" OFF)

add_executable(lisna_sidecar
  src/main.cpp
  src/ipc/json_protocol.cpp
)
target_include_directories(lisna_sidecar PRIVATE src deps/json)

if(LISNA_WITH_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
```

- [ ] **Step 3: main.cpp — 라인 단위 NDJSON 에코 루프 (최소 동작 검증용)**

`desktop/sidecar/src/main.cpp`:
```cpp
#include <iostream>
#include <string>
#include "ipc/json_protocol.h"

int main() {
  lisna::ipc::emit_event(R"({"type":"ready","pid":)" + std::to_string(getpid()) + R"(,"version":"0.0.1"})");
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    try {
      auto resp = lisna::ipc::dispatch(line);
      std::cout << resp << "\n" << std::flush;
    } catch (const std::exception& e) {
      std::cout << R"({"id":"-","type":"error","code":"parse","message":")" << e.what() << R"("})" << "\n" << std::flush;
    }
  }
  return 0;
}
```

(unistd.h 의 `getpid` 사용 → main.cpp 상단에 `#include <unistd.h>` 추가)

- [ ] **Step 4: `json_protocol.h/cpp` — 미구현 스텁 dispatch + emit_event**

`desktop/sidecar/src/ipc/json_protocol.h`:
```cpp
#pragma once
#include <string>

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine);
  void emit_event(const std::string& jsonLine);
}
```

`desktop/sidecar/src/ipc/json_protocol.cpp`:
```cpp
#include "json_protocol.h"
#include <iostream>
#include <nlohmann/json.hpp>

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine) {
    auto req = nlohmann::json::parse(jsonLine);
    const std::string id = req.value("id", "-");
    const std::string type = req.value("type", "");
    // Phase 2 후속 task 에서 load/transcribe/unload 분기 추가
    if (type == "ping") {
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return nlohmann::json{{"id", id}, {"type", "error"}, {"code", "unimpl"}, {"message", type}}.dump();
  }
  void emit_event(const std::string& jsonLine) {
    std::cout << jsonLine << "\n" << std::flush;
  }
}
```

(include 경로 보정: deps/json/json.hpp 라면 `#include "json.hpp"` 또는 CMake target_include_directories 로 `deps/json` 추가했으니 `#include <nlohmann/json.hpp>` 가 동작하도록 — 실제 nlohmann single header 는 `using nlohmann::json` 형태로 노출, 인클루드 경로는 `#include "json.hpp"` 가 가장 안전. 위 코드도 그렇게 정정.)

`json_protocol.cpp` 의 include 를 `#include "json.hpp"` 로 정정.

- [ ] **Step 5: 빌드 스크립트**

`desktop/sidecar/scripts/build.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j
mkdir -p ../../resources
cp lisna_sidecar ../../resources/sidecar
```

`chmod +x desktop/sidecar/scripts/build.sh`

- [ ] **Step 6: 빌드 + ping echo 검증**

Run:
```bash
cd desktop && pnpm build:sidecar
echo '{"id":"1","type":"ping"}' | ./resources/sidecar
```
Expected:
```
{"type":"ready","pid":NNNN,"version":"0.0.1"}
{"id":"1","type":"ok"}
```

- [ ] **Step 7: 커밋**

```bash
git add desktop/sidecar
git commit -m "feat(sidecar): C++ scaffold with NDJSON ping echo"
```

---

### Task 2.2: GoogleTest 부트스트랩 + json_protocol 단위 테스트

**Files:**
- Create: `desktop/sidecar/tests/CMakeLists.txt`
- Create: `desktop/sidecar/tests/test_json_protocol.cpp`
- Modify: `desktop/sidecar/scripts/build.sh` (테스트 빌드 옵션)

- [ ] **Step 1: GoogleTest FetchContent**

`desktop/sidecar/tests/CMakeLists.txt`:
```cmake
include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.tar.gz
)
FetchContent_MakeAvailable(googletest)

add_executable(sidecar_tests
  test_json_protocol.cpp
  ../src/ipc/json_protocol.cpp
)
target_include_directories(sidecar_tests PRIVATE ../src ../deps/json)
target_link_libraries(sidecar_tests PRIVATE gtest_main)

include(GoogleTest)
gtest_discover_tests(sidecar_tests)
```

- [ ] **Step 2: 실패 테스트 작성**

`desktop/sidecar/tests/test_json_protocol.cpp`:
```cpp
#include <gtest/gtest.h>
#include "ipc/json_protocol.h"
#include "json.hpp"

using nlohmann::json;

TEST(JsonProtocol, PingReturnsOk) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"abc","type":"ping"})"));
  EXPECT_EQ(r["id"], "abc");
  EXPECT_EQ(r["type"], "ok");
}

TEST(JsonProtocol, UnknownTypeReturnsError) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"x","type":"banana"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "unimpl");
}

TEST(JsonProtocol, MalformedThrowsForCaller) {
  EXPECT_THROW(lisna::ipc::dispatch("{not json"), std::exception);
}
```

- [ ] **Step 3: 테스트 빌드 + 실행**

`scripts/build.sh` 에 `-DLISNA_WITH_TESTS=ON` 옵션 + `ctest --output-on-failure` 추가. 또는 별도 `scripts/test.sh` 생성.

Run:
```bash
cd desktop/sidecar && mkdir -p build && cd build
cmake .. -DLISNA_WITH_TESTS=ON && cmake --build . -j && ctest --output-on-failure
```
Expected: 3 tests pass.

- [ ] **Step 4: 커밋**

```bash
git add desktop/sidecar/tests desktop/sidecar/scripts
git commit -m "test(sidecar): GoogleTest for json_protocol dispatch"
```

---

### Task 2.3: whisper.cpp 서브모듈 + Metal 빌드 통합

**Files:**
- Modify: `desktop/sidecar/CMakeLists.txt`
- Modify: `desktop/sidecar/.gitmodules` (저장소 루트 .gitmodules 에 등록)
- Create: `desktop/sidecar/src/stt/whisper_engine.h`
- Create: `desktop/sidecar/src/stt/whisper_engine.cpp`

- [ ] **Step 1: whisper.cpp 서브모듈 추가**

Run (저장소 루트에서):
```bash
git submodule add https://github.com/ggerganov/whisper.cpp desktop/sidecar/deps/whisper.cpp
cd desktop/sidecar/deps/whisper.cpp
git checkout v1.6.0   # 또는 v2.0 freeze 시점의 최신 stable tag
cd ../../../..
```

(태그 핀은 v2.0 freeze 시점에 그 시점 stable 로 조정. 본 plan 작성 시점에선 v1.6.x 가 reference.)

- [ ] **Step 2: CMakeLists 에서 whisper.cpp 통합**

`desktop/sidecar/CMakeLists.txt` 수정:
```cmake
# whisper.cpp 옵션
set(WHISPER_METAL ON CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(deps/whisper.cpp EXCLUDE_FROM_ALL)

# stt 소스 추가
target_sources(lisna_sidecar PRIVATE
  src/stt/whisper_engine.cpp
)
target_link_libraries(lisna_sidecar PRIVATE whisper)
```

- [ ] **Step 3: 빌드 검증 (모델 없이 빌드만)**

Run: `pnpm build:sidecar`
Expected: `lisna_sidecar` 바이너리 생성. `otool -L resources/sidecar` 결과에 Metal.framework 가 링크돼 있어야 함.

- [ ] **Step 4: whisper_engine 헤더 정의**

`desktop/sidecar/src/stt/whisper_engine.h`:
```cpp
#pragma once
#include <string>
#include <vector>
#include <optional>

namespace lisna::stt {

struct Segment {
  double startSec;
  double endSec;
  std::string text;
};

class WhisperEngine {
public:
  WhisperEngine();
  ~WhisperEngine();
  bool load(const std::string& ggufPath, const std::string& languageCode);
  void unload();
  std::vector<Segment> transcribe(const float* samples, size_t n, int sampleRate);
  bool loaded() const;

private:
  struct Impl;
  Impl* impl_;
};

}
```

- [ ] **Step 5: 구현 (load / transcribe / unload)**

`desktop/sidecar/src/stt/whisper_engine.cpp`:
```cpp
#include "whisper_engine.h"
#include <whisper.h>
#include <cstring>

namespace lisna::stt {

struct WhisperEngine::Impl {
  whisper_context* ctx = nullptr;
  std::string lang;
};

WhisperEngine::WhisperEngine() : impl_(new Impl{}) {}
WhisperEngine::~WhisperEngine() { unload(); delete impl_; }

bool WhisperEngine::loaded() const { return impl_->ctx != nullptr; }

bool WhisperEngine::load(const std::string& path, const std::string& langCode) {
  unload();
  whisper_context_params cp = whisper_context_default_params();
  cp.use_gpu = true;        // Metal
  impl_->ctx = whisper_init_from_file_with_params(path.c_str(), cp);
  impl_->lang = langCode;
  return impl_->ctx != nullptr;
}

void WhisperEngine::unload() {
  if (impl_->ctx) {
    whisper_free(impl_->ctx);
    impl_->ctx = nullptr;
  }
}

std::vector<Segment> WhisperEngine::transcribe(const float* samples, size_t n, int sampleRate) {
  std::vector<Segment> out;
  if (!impl_->ctx) return out;
  whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  p.language = impl_->lang.c_str();
  p.translate = false;
  p.print_realtime = false;
  p.print_progress = false;
  // 16kHz mono Float32 가정 (호출자 책임). sampleRate != 16000 이면 호출자가 리샘플.
  if (whisper_full(impl_->ctx, p, samples, static_cast<int>(n)) != 0) return out;
  const int nSeg = whisper_full_n_segments(impl_->ctx);
  for (int i = 0; i < nSeg; ++i) {
    Segment s;
    s.startSec = whisper_full_get_segment_t0(impl_->ctx, i) / 100.0;
    s.endSec   = whisper_full_get_segment_t1(impl_->ctx, i) / 100.0;
    s.text     = whisper_full_get_segment_text(impl_->ctx, i);
    out.push_back(std::move(s));
  }
  return out;
}

}
```

- [ ] **Step 6: 빌드 + ld 검증 (실 모델 로드는 다음 task)**

Run: `pnpm build:sidecar`
Expected: 빌드 성공. `nm resources/sidecar | grep -i whisper_init` 가 결과 출력.

- [ ] **Step 7: 커밋**

```bash
git add .gitmodules desktop/sidecar/CMakeLists.txt desktop/sidecar/src/stt
git commit -m "feat(sidecar): integrate whisper.cpp with Metal backend"
```

---

### Task 2.4: 사이드카 IPC — load / transcribe / unload (STT) 분기

**Files:**
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp`
- Modify: `desktop/sidecar/src/main.cpp`
- Create: `desktop/sidecar/src/ipc/base64.cpp` + `.h`
- Modify: `desktop/sidecar/tests/test_json_protocol.cpp`

- [ ] **Step 1: base64 디코더 (transcribe 페이로드용)**

`desktop/sidecar/src/ipc/base64.h`:
```cpp
#pragma once
#include <string>
#include <vector>
namespace lisna::ipc { std::vector<uint8_t> b64_decode(const std::string& s); }
```

`desktop/sidecar/src/ipc/base64.cpp`: 표준 base64 디코드 (간단 32-line 구현 — 인터넷 reference 참조하되 외부 라이브러리 없이).

- [ ] **Step 2: 실패 테스트 — load/transcribe/unload 분기**

`test_json_protocol.cpp` 에 추가:
```cpp
TEST(JsonProtocol, LoadSttMissingPathReturnsError) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"1","type":"load","kind":"stt"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST(JsonProtocol, UnloadWithoutLoadIsNoop) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"2","type":"unload","kind":"stt"})"));
  EXPECT_EQ(r["type"], "ok");
}
```

(Transcribe 의 실제 결과 테스트는 실 모델 + fixture audio 가 있는 Task 2.6 에서.)

- [ ] **Step 3: 실패 확인**

Run: `ctest --output-on-failure`
Expected: 2 failures.

- [ ] **Step 4: dispatch 구현 확장**

`desktop/sidecar/src/ipc/json_protocol.cpp` 가 process-level state (싱글톤) 으로 `WhisperEngine` 인스턴스를 보유:
```cpp
#include "stt/whisper_engine.h"
#include "ipc/base64.h"
#include <memory>

namespace lisna::ipc {
namespace {
  std::unique_ptr<lisna::stt::WhisperEngine> g_stt;
}

std::string dispatch(const std::string& line) {
  auto req = nlohmann::json::parse(line);
  const std::string id = req.value("id", "-");
  const std::string type = req.value("type", "");
  auto err = [&](const char* code, const std::string& msg) {
    return nlohmann::json{{"id", id}, {"type", "error"}, {"code", code}, {"message", msg}}.dump();
  };

  if (type == "ping") return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();

  if (type == "load") {
    const std::string kind = req.value("kind", "");
    if (kind == "stt") {
      if (!req.contains("path") || !req.contains("language"))
        return err("missing_field", "path/language required");
      if (!g_stt) g_stt = std::make_unique<lisna::stt::WhisperEngine>();
      if (!g_stt->load(req["path"], req["language"])) return err("load_failed", "whisper_init returned null");
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return err("unimpl", "load kind=" + kind);
  }

  if (type == "unload") {
    const std::string kind = req.value("kind", "");
    if (kind == "stt") {
      if (g_stt) g_stt->unload();
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return err("unimpl", "unload kind=" + kind);
  }

  if (type == "transcribe") {
    if (!g_stt || !g_stt->loaded()) return err("not_loaded", "stt model not loaded");
    if (!req.contains("audioBase64") || !req.contains("sampleRate"))
      return err("missing_field", "audioBase64/sampleRate required");
    auto raw = b64_decode(req["audioBase64"]);
    const float* samples = reinterpret_cast<const float*>(raw.data());
    const size_t n = raw.size() / sizeof(float);
    auto segs = g_stt->transcribe(samples, n, req["sampleRate"]);
    auto arr = nlohmann::json::array();
    for (auto& s : segs) arr.push_back({{"startSec", s.startSec}, {"endSec", s.endSec}, {"text", s.text}});
    return nlohmann::json{{"id", id}, {"type", "segments"}, {"segments", arr}}.dump();
  }

  return err("unimpl", "type=" + type);
}
}
```

- [ ] **Step 5: 테스트 통과**

Run: `ctest --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 6: 커밋**

```bash
git add desktop/sidecar
git commit -m "feat(sidecar): STT load/transcribe/unload IPC dispatch"
```

---

### Task 2.5: Main 프로세스 사이드카 클라이언트 + 슈퍼바이저

**Files:**
- Create: `desktop/src/main/sidecar/client.ts`
- Create: `desktop/src/main/sidecar/supervisor.ts`
- Create: `desktop/src/main/sidecar/__tests__/client.test.ts`

- [ ] **Step 1: 실패 테스트 — fake 사이드카 (echo 스크립트) 와 왕복**

`desktop/src/main/sidecar/__tests__/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { SidecarClient } from '../client';

describe('SidecarClient with /bin/cat (echo loop)', () => {
  it('request 보내면 같은 line 이 응답으로 돌아온다 (id 매칭은 별도)', async () => {
    // 진짜 사이드카 없이 stdio echo 만 검증
    const proc = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new SidecarClient(proc);
    // cat 는 type:"ok" 가 아닌 입력 그대로 돌려주므로 raw stream 만 검증
    const seen: string[] = [];
    client.onRawLine(l => seen.push(l));
    proc.stdin!.write('{"id":"1","type":"ping"}\n');
    await new Promise(r => setTimeout(r, 50));
    expect(seen[0]).toContain('"id":"1"');
    proc.kill();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과**

`desktop/src/main/sidecar/client.ts`:
```ts
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SidecarRequest, SidecarResponse, SidecarEvent } from '@shared/ipc-protocol';

type Pending = { resolve: (r: SidecarResponse) => void; reject: (e: Error) => void };

export class SidecarClient {
  private buf = '';
  private pending = new Map<string, Pending>();
  private rawLineListeners: ((l: string) => void)[] = [];
  private eventListeners: ((e: SidecarEvent) => void)[] = [];

  constructor(private proc: ChildProcess) {
    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr!.on('data', (d) => console.error('[sidecar stderr]', d.toString()));
  }

  onRawLine(cb: (l: string) => void) { this.rawLineListeners.push(cb); }
  onEvent(cb: (e: SidecarEvent) => void) { this.eventListeners.push(cb); }

  private onData(chunk: string) {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      for (const l of this.rawLineListeners) l(line);
      try {
        const obj = JSON.parse(line);
        if (!('id' in obj)) {
          for (const e of this.eventListeners) e(obj as SidecarEvent);
        } else {
          const p = this.pending.get(obj.id);
          if (p) { this.pending.delete(obj.id); p.resolve(obj as SidecarResponse); }
        }
      } catch { /* skip malformed */ }
    }
  }

  send(req: Omit<SidecarRequest, 'id'>): Promise<SidecarResponse> {
    const id = randomUUID();
    const full = JSON.stringify({ id, ...req });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(full + '\n');
    });
  }
}
```

- [ ] **Step 3: 슈퍼바이저 — spawn / 크래시 감지 / 재시작 / 2회 연속 실패 후 UI 알림**

`desktop/src/main/sidecar/supervisor.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { join } from 'node:path';
import { SidecarClient } from './client';

export class SidecarSupervisor {
  private proc?: ChildProcess;
  private client?: SidecarClient;
  private failuresInARow = 0;
  private readonly onCrash: (msg: string) => void;

  constructor(opts: { onCrash: (msg: string) => void }) { this.onCrash = opts.onCrash; }

  start(): SidecarClient {
    const bin = app.isPackaged
      ? join(process.resourcesPath, 'sidecar')
      : join(app.getAppPath(), 'resources', 'sidecar');
    this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.client = new SidecarClient(this.proc);
    this.proc.on('exit', (code, sig) => this.handleExit(code, sig));
    return this.client;
  }

  private handleExit(code: number | null, sig: NodeJS.Signals | null) {
    this.failuresInARow += 1;
    if (this.failuresInARow >= 2) {
      this.onCrash(`Sidecar exited twice in a row (code=${code} sig=${sig})`);
      return;
    }
    setTimeout(() => this.start(), 500);
  }

  resetFailureCount() { this.failuresInARow = 0; }

  async shutdown() {
    if (!this.proc) return;
    this.proc.kill('SIGTERM');
  }
}
```

- [ ] **Step 4: app 부팅 시 supervisor.start() 호출 + ready 이벤트 대기 helper**

`desktop/src/main/index.ts` 의 `app.whenReady` 안에 supervisor.start() 후 ready 이벤트 첫 1개 대기, 메인 컨텍스트에 client 저장.

- [ ] **Step 5: 테스트 + 수동 검증**

Run: `cd desktop && pnpm test client`
Expected: PASS.

수동: `pnpm dev` 후 메인 콘솔에 사이드카 ready 이벤트 로그 (`type:"ready"`) 출력 확인.

- [ ] **Step 6: 커밋**

```bash
git add desktop/src/main/sidecar
git commit -m "feat(desktop): main-process SidecarSupervisor + JSON client"
```

---

### Task 2.6: TS 측 STTEngine 어댑터 + 실 모델 전사 검증

**Files:**
- Create: `desktop/src/main/engines/whisper-cpp-stt.ts`
- Create: `desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts`
- Create: `desktop/tests/fixtures/audio/ja-30s.wav`  (직접 녹음/조달 — 일본어 30초 모노 16kHz)
- Create: `desktop/tests/fixtures/transcripts/ja-30s.txt`

- [ ] **Step 1: 모델 다운로드 (Kotoba-Whisper v2.0 Q4 GGUF)**

```bash
mkdir -p ~/.lisna-test-models
curl -L -o ~/.lisna-test-models/kotoba-whisper-v2.0-q4.gguf \
  https://huggingface.co/.../kotoba-whisper-v2.0-q4.gguf   # 실제 URL 은 freeze 시점에 확정
shasum -a 256 ~/.lisna-test-models/kotoba-whisper-v2.0-q4.gguf
```
SHA256 을 fixture 매니페스트에 기록. (테스트는 ENV `LISNA_TEST_STT_MODEL` 이 가리키는 경로 사용 — CI 에선 캐시.)

> **주의 (HF URL 정확성):** 위 curl URL 은 의도적으로 placeholder 형태로 남김. 실제 다운로드는 `huggingface.co` 의 Kotoba-Whisper 저장소를 `huggingface-cli` 또는 웹 UI 에서 확인 후 해당 정확한 GGUF revision URL 로 교체. 추측 URL 을 plan/스크립트에 박지 말 것 (CLAUDE.md URL 인용 규칙).

- [ ] **Step 2: 실 모델 통합 테스트 작성**

`desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { WhisperCppSTT } from '../whisper-cpp-stt';
import { SidecarSupervisor } from '../../sidecar/supervisor';
import { SidecarClient } from '../../sidecar/client';

const modelPath = process.env.LISNA_TEST_STT_MODEL;
const skip = !modelPath ? describe.skip : describe;

skip('WhisperCppSTT (실 모델)', () => {
  let client: SidecarClient;
  let stt: WhisperCppSTT;

  beforeAll(async () => {
    // supervisor 대신 직접 spawn 으로 단순화 가능
    const sv = new SidecarSupervisor({ onCrash: () => {} });
    client = sv.start();
    await new Promise(r => setTimeout(r, 500));
    stt = new WhisperCppSTT(client);
    await stt.loadModel(modelPath!, 'ja');
  }, 60_000);

  it('30s 일본어 wav → 핵심 단어가 결과 텍스트에 포함', async () => {
    const wav = readFileSync('tests/fixtures/audio/ja-30s.wav');
    // wav → Float32Array (헤더 44바이트 가정, mono 16kHz 16-bit PCM)
    const pcm = new Int16Array(wav.buffer, 44);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const segs = await stt.transcribe(f32);
    const joined = segs.map(s => s.text).join('');
    // fixture transcript 의 처음 5글자가 결과에 포함되는지만 약하게 검증 (CER 정밀 검증은 phase 5)
    const expected = readFileSync('tests/fixtures/transcripts/ja-30s.txt', 'utf8').slice(0, 5);
    expect(joined).toContain(expected);
  }, 120_000);

  afterAll(async () => { await stt.unloadModel(); });
});
```

- [ ] **Step 3: 실패 확인 (어댑터 미존재)**

Run: `LISNA_TEST_STT_MODEL=~/.lisna-test-models/kotoba-whisper-v2.0-q4.gguf pnpm test whisper-cpp`
Expected: FAIL — `../whisper-cpp-stt` 미존재.

- [ ] **Step 4: 어댑터 구현**

`desktop/src/main/engines/whisper-cpp-stt.ts`:
```ts
import type { STTEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';

export class WhisperCppSTT implements STTEngine {
  constructor(private client: SidecarClient) {}

  async loadModel(path: string, language: Language): Promise<void> {
    const r = await this.client.send({ type: 'load', kind: 'stt', path, language });
    if (r.type !== 'ok') throw new Error(`load failed: ${JSON.stringify(r)}`);
  }

  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'stt' });
    if (r.type !== 'ok') throw new Error(`unload failed: ${JSON.stringify(r)}`);
  }

  async transcribe(audio: Float32Array): Promise<TranscriptSegment[]> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const audioBase64 = Buffer.from(bytes).toString('base64');
    const r = await this.client.send({ type: 'transcribe', audioBase64, sampleRate: 16000 });
    if (r.type !== 'segments') throw new Error(`transcribe failed: ${JSON.stringify(r)}`);
    return r.segments;
  }
}
```

- [ ] **Step 5: 테스트 통과**

Run: `LISNA_TEST_STT_MODEL=~/.lisna-test-models/kotoba-whisper-v2.0-q4.gguf pnpm test whisper-cpp`
Expected: PASS (1 integration test).

- [ ] **Step 6: 커밋**

```bash
git add desktop/src/main/engines/whisper-cpp-stt.ts desktop/src/main/engines/__tests__ desktop/tests/fixtures
git commit -m "feat(desktop): WhisperCppSTT adapter + JA fixture integration test"
```

---

### Task 2.7: end-to-end — Recording 화면이 실제 사이드카 전사 결과 표시

**Files:**
- Modify: `desktop/src/main/ipc.ts`
- Modify: `desktop/src/renderer/routes/Recording.tsx`
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: 메인의 chunk 핸들러가 STT 어댑터로 청크 전달**

`ipc.ts` 의 chunk 핸들러를 수정:
```ts
ipcMain.handle(CHANNELS.chunk, async (_e, payload: { index: number; samples: ArrayBuffer; startMs: number; endMs: number }) => {
  const f32 = new Float32Array(payload.samples);
  const segs = await deps.stt.transcribe(f32);
  // 렌더러로 결과 push
  e.sender.send(CHANNELS.onChunk, { index: payload.index, segments: segs, startMs: payload.startMs });
  return { ok: true };
});
```

(`deps.stt` 는 부팅 시 supervisor 띄운 후 어댑터 초기화 — Phase 4 의 first-run 다운로드 흐름이 들어오기 전까지는 ENV LISNA_DEV_STT_MODEL 로 모델 경로 강제 주입.)

- [ ] **Step 2: Recording.tsx 가 segments 누적 표시**

```tsx
const [segs, setSegs] = useState<TranscriptSegment[]>([]);
useEffect(() => window.lisna.onChunk(({ segments }) => setSegs(prev => [...prev, ...segments])), []);
return <pre>{segs.map(s => `[${s.startSec.toFixed(1)}s] ${s.text}`).join('\n')}</pre>;
```

- [ ] **Step 3: 수동 검증 — 일본어 음성으로 dev 모드 녹음**

Run: `LISNA_DEV_STT_MODEL=~/.lisna-test-models/kotoba-whisper-v2.0-q4.gguf pnpm dev`
일본어로 30초 정도 말한 뒤 stop. 렌더러에 자막 형태로 전사 결과가 누적되어야 함.

검증 결과 `desktop/docs/manual-verification.md` 에 기록.

- [ ] **Step 4: 커밋**

```bash
git add desktop/src
git commit -m "feat(desktop): live JA transcription end-to-end via sidecar"
```

---

## Phase 3 — LLM 사이드카 + 시간 분할 메모리 오케스트레이션

목표: 동일 사이드카 바이너리에 llama.cpp 정적 링크. 세션 종료 시 STT 언로드 (OS-confirmed reclaim 까지 await) → LLM 로드 → 구조화 노트 생성 → LLM 언로드. KO/ZH 의 1.5GB→2.5GB 트랜지션이 검증 대상.

스펙 근거: §3 (LLM 모델/런타임), §4 (메모리 예산 + OS reclaim 의무), §5 (LLMEngine 인터페이스).

### Task 3.1: llama.cpp 서브모듈 + Metal 빌드 통합

**Files:**
- Modify: `.gitmodules`
- Modify: `desktop/sidecar/CMakeLists.txt`

- [ ] **Step 1: 서브모듈 추가**

```bash
git submodule add https://github.com/ggerganov/llama.cpp desktop/sidecar/deps/llama.cpp
cd desktop/sidecar/deps/llama.cpp
git checkout b3500   # v2.0 freeze 시점의 stable build tag 로 교체
cd ../../../..
```

(태그 핀: Gemma 4 4B 지원이 들어간 가장 최신 stable. freeze 시점에 재확정.)

- [ ] **Step 2: CMakeLists 통합**

```cmake
set(LLAMA_METAL ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
add_subdirectory(deps/llama.cpp EXCLUDE_FROM_ALL)

target_sources(lisna_sidecar PRIVATE
  src/llm/llama_engine.cpp
)
target_link_libraries(lisna_sidecar PRIVATE llama)
```

- [ ] **Step 3: 빌드 검증 (모델 없이)**

Run: `pnpm build:sidecar`
Expected: 빌드 성공. `otool -L resources/sidecar` 에 Metal/Accelerate framework 포함. 바이너리 크기 확인 (whisper + llama 둘 다 정적 링크하면 60~120MB 정도 예상).

- [ ] **Step 4: 커밋**

```bash
git add .gitmodules desktop/sidecar/CMakeLists.txt
git commit -m "feat(sidecar): integrate llama.cpp with Metal backend"
```

---

### Task 3.2: LlamaEngine — load / generate (스트리밍) / unload

**Files:**
- Create: `desktop/sidecar/src/llm/llama_engine.h`
- Create: `desktop/sidecar/src/llm/llama_engine.cpp`
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp` (load/unload/generate 분기)
- Modify: `desktop/sidecar/tests/test_json_protocol.cpp`

- [ ] **Step 1: 헤더**

`desktop/sidecar/src/llm/llama_engine.h`:
```cpp
#pragma once
#include <string>
#include <functional>

namespace lisna::llm {

struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
};

class LlamaEngine {
public:
  LlamaEngine();
  ~LlamaEngine();
  bool load(const std::string& ggufPath);
  void unload();
  bool loaded() const;
  // onToken 은 각 디코드 step 직후 호출. 스트리밍 출력.
  void generate(const std::string& prompt, const GenOpts& opts,
                const std::function<void(const std::string&)>& onToken);
private:
  struct Impl;
  Impl* impl_;
};

}
```

- [ ] **Step 2: 구현 (llama.cpp 표준 API 사용)**

`desktop/sidecar/src/llm/llama_engine.cpp` — llama.cpp 의 `llama_model_load_from_file` / `llama_new_context_with_model` / `llama_decode` 표준 패턴. (라이브러리 API 가 핀 시점에 따라 약간 다를 수 있어 정확 시그니처는 deps/llama.cpp/llama.h 참고 후 작성. 본 plan 은 구조만 명시.)

핵심 동작:
- `load(path)`: `llama_model_load_from_file(path, params)` → `llama_new_context_with_model(model, ctx_params)` 으로 ctx 만들고 보관. `ctx_params.n_ctx = 131072` (128K). `params.n_gpu_layers = 999` (전 레이어 Metal).
- `generate`: tokenize prompt → loop { decode → sample → detokenize → onToken } until EOS or maxTokens.
- `unload`: `llama_free(ctx)` + `llama_model_free(model)` 후 ctx/model 포인터 null 처리. (OS reclaim 검증은 Task 3.4 에서.)

- [ ] **Step 3: 실패 테스트 — generate 의 prompt missing 케이스**

`test_json_protocol.cpp` 에 추가:
```cpp
TEST(JsonProtocol, GenerateWithoutLoadReturnsNotLoaded) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"g1","type":"generate","prompt":"hi"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}
```

- [ ] **Step 4: dispatch 확장**

`json_protocol.cpp` 에 LLM 분기 추가:
```cpp
namespace { std::unique_ptr<lisna::llm::LlamaEngine> g_llm; }

if (type == "load" && req["kind"] == "llm") {
  if (!req.contains("path")) return err("missing_field", "path required");
  if (!g_llm) g_llm = std::make_unique<lisna::llm::LlamaEngine>();
  if (!g_llm->load(req["path"])) return err("load_failed", "llama init failed");
  return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
}
if (type == "unload" && req["kind"] == "llm") {
  if (g_llm) g_llm->unload();
  return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
}
if (type == "generate") {
  if (!g_llm || !g_llm->loaded()) return err("not_loaded", "llm not loaded");
  lisna::llm::GenOpts opts;
  opts.maxTokens = req.value("maxTokens", 1024);
  opts.temperature = req.value("temperature", 0.4f);
  // 스트리밍: 토큰마다 stdout 으로 {"id":..,"type":"token","token":..} 라인 push
  g_llm->generate(req["prompt"], opts, [&](const std::string& tok) {
    std::cout << nlohmann::json{{"id", id}, {"type", "token"}, {"token", tok}}.dump() << "\n" << std::flush;
  });
  return nlohmann::json{{"id", id}, {"type", "done"}}.dump();
}
```

(주의: generate 는 동기 stream 이라 dispatch 함수가 token 이벤트들을 직접 stdout 으로 흘려보낸 뒤 마지막에 `done` 응답을 반환. SidecarClient 는 같은 id 의 token 들을 누적하다 done 받으면 종료로 처리해야 함. → Task 3.3 에서 클라이언트 수정.)

- [ ] **Step 5: 테스트 통과**

Run: `ctest --output-on-failure`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop/sidecar
git commit -m "feat(sidecar): LlamaEngine load/generate(stream)/unload IPC"
```

---

### Task 3.3: TS 측 LLMEngine 어댑터 (스트리밍 AsyncIterable)

**Files:**
- Modify: `desktop/src/main/sidecar/client.ts` (streaming response 지원)
- Create: `desktop/src/main/engines/llama-cpp-llm.ts`
- Create: `desktop/src/main/engines/__tests__/llama-cpp-llm.test.ts`

- [ ] **Step 1: 클라이언트가 한 id 에 대해 token 스트림 + done 종료를 처리하도록 확장**

`client.ts` 에 별도 메서드 추가:
```ts
async *sendStream(req: Omit<SidecarRequest, 'id'>): AsyncIterable<string> {
  const id = randomUUID();
  const tokens: string[] = [];
  let doneResolve: () => void;
  const doneP = new Promise<void>(r => { doneResolve = r; });
  let errored: Error | null = null;
  const onLine = (line: string) => {
    try {
      const o = JSON.parse(line);
      if (o.id !== id) return;
      if (o.type === 'token') tokens.push(o.token);
      else if (o.type === 'done') doneResolve();
      else if (o.type === 'error') { errored = new Error(o.message); doneResolve(); }
    } catch {}
  };
  this.rawLineListeners.push(onLine);
  this.proc.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
  while (true) {
    if (errored) throw errored;
    if (tokens.length) { yield tokens.shift()!; continue; }
    // done 도 도착 안 했고 token 도 없으면 짧게 대기
    await Promise.race([doneP, new Promise(r => setTimeout(r, 10))]);
    if (await Promise.race([doneP.then(() => 'done'), Promise.resolve('wait')]) === 'done' && !tokens.length) break;
  }
  // 정리
  this.rawLineListeners = this.rawLineListeners.filter(l => l !== onLine);
  if (errored) throw errored;
}
```

(이 generator 로직은 정밀하게 다듬을 필요 — 위 코드는 race 가 까다로움. 구현 task 진입 시 단순 채널 패턴으로 리팩터: tokens queue + done flag + Promise 알림.)

- [ ] **Step 2: 어댑터 작성**

`desktop/src/main/engines/llama-cpp-llm.ts`:
```ts
import type { LLMEngine, GenOpts } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';

export class LlamaCppLLM implements LLMEngine {
  constructor(private client: SidecarClient) {}
  async loadModel(path: string): Promise<void> {
    const r = await this.client.send({ type: 'load', kind: 'llm', path });
    if (r.type !== 'ok') throw new Error(`llm load failed: ${JSON.stringify(r)}`);
  }
  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'llm' });
    if (r.type !== 'ok') throw new Error(`llm unload failed: ${JSON.stringify(r)}`);
  }
  generate(prompt: string, opts: GenOpts): AsyncIterable<string> {
    return this.client.sendStream({
      type: 'generate', prompt,
      maxTokens: opts.maxTokens, temperature: opts.temperature, stop: opts.stop,
    });
  }
}
```

- [ ] **Step 3: 통합 테스트 (실 모델, ENV gate)**

`LISNA_TEST_LLM_MODEL=~/.lisna-test-models/gemma-3-4b-q4.gguf` 으로 "1+1=?" 프롬프트에 응답이 비어있지 않은지 검증.

```ts
const skip = !process.env.LISNA_TEST_LLM_MODEL ? describe.skip : describe;
skip('LlamaCppLLM 실 모델', () => {
  it('짧은 프롬프트에 비어있지 않은 응답', async () => {
    const llm = new LlamaCppLLM(client);
    await llm.loadModel(process.env.LISNA_TEST_LLM_MODEL!);
    let out = '';
    for await (const tok of llm.generate('1+1=', { maxTokens: 16, temperature: 0 })) out += tok;
    expect(out.length).toBeGreaterThan(0);
    await llm.unloadModel();
  }, 120_000);
});
```

- [ ] **Step 4: 테스트 통과**

Run: `LISNA_TEST_LLM_MODEL=... pnpm test llama-cpp`
Expected: PASS (1 test).

- [ ] **Step 5: 커밋**

```bash
git add desktop/src/main/engines/llama-cpp-llm.ts desktop/src/main/engines/__tests__ desktop/src/main/sidecar/client.ts
git commit -m "feat(desktop): LlamaCppLLM streaming adapter"
```

---

### Task 3.4: OS-confirmed memory reclamation (madvise + mach_vm 검증)

**Files:**
- Create: `desktop/sidecar/src/memory/os_reclaim.h`
- Create: `desktop/sidecar/src/memory/os_reclaim.cpp`
- Modify: `desktop/sidecar/src/stt/whisper_engine.cpp` (unload 시 호출)
- Modify: `desktop/sidecar/src/llm/llama_engine.cpp` (unload 시 호출)
- Create: `desktop/sidecar/tests/test_os_reclaim.cpp`

**스펙 핵심:** §4 의 "OS-confirmed reclamation" — 단순히 `free`/`whisper_free` 호출 후 Promise resolve 가 아니라, 실제 vm pages 가 OS 로 반환된 것까지 검증한 후에야 unloadModel() 의 Promise 가 resolve 되어야 한다. 안 그러면 KO/ZH 경로에서 STT 1.5GB + LLM 2.5GB ≈ 4GB 가 트랜지션 중 잠시 동시 점유되어 사용자 시스템이 스왑.

- [ ] **Step 1: helper 헤더**

`desktop/sidecar/src/memory/os_reclaim.h`:
```cpp
#pragma once
#include <cstddef>
namespace lisna::memory {
  /** 프로세스의 현재 resident set size (bytes). 실패 시 0. */
  size_t process_rss_bytes();
  /** mmapped 영역에 대해 OS 가 페이지를 회수하도록 advise + 짧은 폴링. */
  void advise_release_and_wait(void* addr, size_t length, size_t targetRssDropBytes, int timeoutMs);
}
```

- [ ] **Step 2: macOS 구현 — mach API + madvise**

`desktop/sidecar/src/memory/os_reclaim.cpp`:
```cpp
#include "os_reclaim.h"
#include <mach/mach.h>
#include <mach/task.h>
#include <sys/mman.h>
#include <chrono>
#include <thread>

namespace lisna::memory {

size_t process_rss_bytes() {
  mach_task_basic_info info{};
  mach_msg_type_number_t cnt = MACH_TASK_BASIC_INFO_COUNT;
  if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &cnt) != KERN_SUCCESS) return 0;
  return static_cast<size_t>(info.resident_size);
}

void advise_release_and_wait(void* addr, size_t length, size_t targetDrop, int timeoutMs) {
  if (addr && length) madvise(addr, length, MADV_DONTNEED);
  const size_t before = process_rss_bytes();
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
  while (std::chrono::steady_clock::now() < deadline) {
    const size_t now = process_rss_bytes();
    if (before > targetDrop && now <= before - targetDrop) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
}

}
```

- [ ] **Step 3: WhisperEngine::unload / LlamaEngine::unload 에서 호출**

각 엔진이 mmap base + length 를 저장해두고 unload 시 `advise_release_and_wait(base, len, len/2, 2000)` 호출. (whisper.cpp / llama.cpp 가 모델을 mmap 으로 로드하는 경우 — 둘 다 기본이 mmap. base/len 은 라이브러리 내부 멤버라 직접 노출 안 될 수 있음 → 대안: `free` 후 rss 만 폴링하여 일정 임계 이상 감소했음을 확인. 더 단순. plan 채택안: **단순 RSS 폴링** 방식.)

수정안:
```cpp
// whisper_engine.cpp::unload
void WhisperEngine::unload() {
  if (!impl_->ctx) return;
  const size_t before = lisna::memory::process_rss_bytes();
  whisper_free(impl_->ctx);
  impl_->ctx = nullptr;
  // 모델 사이즈의 절반 이상이 RSS 에서 빠지면 OS reclaim 확인 (2초 타임아웃)
  const size_t target = std::max<size_t>(before / 4, 100 * 1024 * 1024); // 최소 100MB drop
  lisna::memory::advise_release_and_wait(nullptr, 0, target, 2000);
}
```

(LlamaEngine 도 동일 패턴.)

- [ ] **Step 4: 실패 테스트 → 통과**

`test_os_reclaim.cpp`:
```cpp
#include <gtest/gtest.h>
#include "memory/os_reclaim.h"
#include <vector>

TEST(OsReclaim, RssIsPositive) {
  EXPECT_GT(lisna::memory::process_rss_bytes(), 0u);
}

TEST(OsReclaim, AdviseDoesNotCrashOnNull) {
  lisna::memory::advise_release_and_wait(nullptr, 0, 1, 50);
  SUCCEED();
}
```

Run: `ctest --output-on-failure`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add desktop/sidecar/src/memory desktop/sidecar/tests/test_os_reclaim.cpp desktop/sidecar/src/stt/whisper_engine.cpp desktop/sidecar/src/llm/llama_engine.cpp
git commit -m "feat(sidecar): OS-confirmed RSS-drop polling on unload"
```

---

### Task 3.5: 시간 분할 오케스트레이터 (TS 메인 프로세스)

**Files:**
- Create: `desktop/src/main/sidecar/orchestrator.ts`
- Create: `desktop/src/main/sidecar/__tests__/orchestrator.test.ts`

목표: 외부에서 보면 `runSession({ audioChunks → segments[], prompt → noteMarkdown })` 한 호출이 다음을 보장:
1. 세션 시작 시 STT 모델 로드 (이미 로드돼있으면 skip)
2. 청크 도착마다 transcribe → segments 누적
3. 세션 stop 시 STT 언로드 (OS reclaim 까지 await)
4. LLM 로드
5. 누적 segments + 시스템 프롬프트로 generate (스트리밍)
6. LLM 언로드
7. 최종 노트 반환

- [ ] **Step 1: 실패 테스트 (fake 엔진 mock)**

`orchestrator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';

describe('SessionOrchestrator', () => {
  it('start → 2 chunks → stop → load LLM → generate → unload 순서', async () => {
    const events: string[] = [];
    const fakeStt = {
      loadModel: vi.fn(async () => { events.push('stt-load'); }),
      unloadModel: vi.fn(async () => { events.push('stt-unload'); }),
      transcribe: vi.fn(async () => { events.push('stt-tx'); return [{ startSec: 0, endSec: 1, text: 'こんにちは' }]; }),
    };
    const fakeLlm = {
      loadModel: vi.fn(async () => { events.push('llm-load'); }),
      unloadModel: vi.fn(async () => { events.push('llm-unload'); }),
      generate: vi.fn(async function* () { events.push('llm-gen'); yield '#'; yield ' note'; }),
    };
    const orch = new SessionOrchestrator({
      stt: fakeStt as any, llm: fakeLlm as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    await orch.start();
    await orch.onChunk(new Float32Array(16000));
    await orch.onChunk(new Float32Array(16000));
    const note = await orch.stop();
    expect(events).toEqual([
      'stt-load', 'stt-tx', 'stt-tx', 'stt-unload',
      'llm-load', 'llm-gen', 'llm-unload',
    ]);
    expect(note.markdown).toBe('# note');
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`desktop/src/main/sidecar/orchestrator.ts`:
```ts
import type { STTEngine, LLMEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { Note } from '@shared/types';

interface Opts {
  stt: STTEngine;
  llm: LLMEngine;
  sttModelPath: string;
  llmModelPath: string;
  language: Language;
  buildPrompt?(language: Language, segments: TranscriptSegment[]): string;
}

const defaultPrompt = (lang: Language, segs: TranscriptSegment[]): string => {
  const transcript = segs.map(s => `[${s.startSec.toFixed(1)}s] ${s.text}`).join('\n');
  return `You are a meeting note writer. Output Markdown.\nLanguage: ${lang}\n\nTranscript:\n${transcript}\n\nNote:\n`;
};

export class SessionOrchestrator {
  private segments: TranscriptSegment[] = [];
  constructor(private opts: Opts) {}

  async start(): Promise<void> {
    this.segments = [];
    await this.opts.stt.loadModel(this.opts.sttModelPath, this.opts.language);
  }

  async onChunk(audio: Float32Array): Promise<TranscriptSegment[]> {
    const segs = await this.opts.stt.transcribe(audio);
    this.segments.push(...segs);
    return segs;
  }

  async stop(): Promise<Note> {
    await this.opts.stt.unloadModel();      // OS reclaim 까지 await (어댑터 → 사이드카 → C++)
    await this.opts.llm.loadModel(this.opts.llmModelPath);
    const prompt = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
    let md = '';
    for await (const tok of this.opts.llm.generate(prompt, { maxTokens: 4096, temperature: 0.4 })) md += tok;
    await this.opts.llm.unloadModel();
    return {
      language: this.opts.language,
      generatedAt: new Date().toISOString(),
      markdown: md,
      transcriptSegments: this.segments,
    };
  }
}
```

- [ ] **Step 3: 테스트 통과**

Run: `cd desktop && pnpm test orchestrator`
Expected: PASS.

- [ ] **Step 4: 메인 UI 통합 — Recording.tsx 의 stop 시 노트 생성 + 표시**

`Recording.tsx` 의 stop 핸들러가 메인의 `session/stop` IPC 호출 → 결과로 `Note` 반환 → `<NoteView>` 로 라우팅.

- [ ] **Step 5: 수동 검증 (실 모델 2종)**

Run: `LISNA_DEV_STT_MODEL=... LISNA_DEV_LLM_MODEL=... pnpm dev`
JA 30s 녹음 → stop → ~10-30초 후 노트 생성 결과 출력.

`desktop/docs/manual-verification.md` 기록.

- [ ] **Step 6: 커밋**

```bash
git add desktop/src
git commit -m "feat(desktop): SessionOrchestrator with time-sliced STT→LLM"
```

---

## Phase 4 — 다국어 + first-run UX

목표: 사용자가 첫 실행에서 JA/EN/KO/ZH 중 하나를 선택 → 해당 STT + LLM 모델 백그라운드 다운로드 (STT 먼저) → 다운 중 UI 탐색 가능 → 하드웨어 floor 미달이면 v1 으로 리다이렉트. 4개 언어 모두 end-to-end 동작.

스펙 근거: §1 floor (M1+, 16GB+, macOS 14.4+ full / 13.x mic-only / 그 외 refuse), §2 per-language 모델 표, §6 first-run UX + unsupported language 안내.

### Task 4.1: 하드웨어 floor 게이트 (M1+, 16GB+, macOS 14.4+)

**Files:**
- Modify: `desktop/src/main/platform/hardware-check.ts`
- Create: `desktop/src/main/platform/__tests__/hardware-check.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, it, expect, vi } from 'vitest';
import { checkHardwareFloor, HardwareTier } from '../hardware-check';

describe('checkHardwareFloor', () => {
  it('macOS 14.4 + Apple Silicon + 16GB → full', () => {
    expect(checkHardwareFloor({ platform: 'darwin', osMajor: 23, osMinor: 4, arch: 'arm64', ramBytes: 16 * 2**30 })).toEqual({ tier: 'full' });
  });
  it('macOS 13.x + Apple Silicon + 16GB → mic-only', () => {
    expect(checkHardwareFloor({ platform: 'darwin', osMajor: 22, osMinor: 6, arch: 'arm64', ramBytes: 16 * 2**30 })).toEqual({ tier: 'mic-only', reasons: ['os-below-14.4'] });
  });
  it('Intel Mac → refused', () => {
    expect(checkHardwareFloor({ platform: 'darwin', osMajor: 23, osMinor: 4, arch: 'x64', ramBytes: 16 * 2**30 }))
      .toMatchObject({ tier: 'refused' });
  });
  it('8GB RAM → refused', () => {
    expect(checkHardwareFloor({ platform: 'darwin', osMajor: 23, osMinor: 4, arch: 'arm64', ramBytes: 8 * 2**30 }))
      .toMatchObject({ tier: 'refused', reasons: expect.arrayContaining(['ram-below-16gb']) });
  });
  it('Windows → refused (v2.0 Mac-only)', () => {
    expect(checkHardwareFloor({ platform: 'win32', osMajor: 0, osMinor: 0, arch: 'arm64', ramBytes: 16 * 2**30 }))
      .toMatchObject({ tier: 'refused', reasons: expect.arrayContaining(['platform-not-mac']) });
  });
});
```

- [ ] **Step 2: 구현**

```ts
import os from 'node:os';

export type HardwareTier = 'full' | 'mic-only' | 'refused';
export type FloorReason =
  | 'platform-not-mac' | 'arch-not-arm64' | 'os-below-14.4' | 'ram-below-16gb';

export interface HardwareProbe {
  platform: NodeJS.Platform;
  osMajor: number;   // Darwin kernel major
  osMinor: number;
  arch: string;
  ramBytes: number;
}

export function probeHost(): HardwareProbe {
  const [maj, min] = os.release().split('.').map(Number);
  return {
    platform: process.platform,
    osMajor: maj ?? 0,
    osMinor: min ?? 0,
    arch: process.arch,
    ramBytes: os.totalmem(),
  };
}

export function checkHardwareFloor(h: HardwareProbe): { tier: HardwareTier; reasons?: FloorReason[] } {
  const reasons: FloorReason[] = [];
  if (h.platform !== 'darwin') reasons.push('platform-not-mac');
  if (h.arch !== 'arm64') reasons.push('arch-not-arm64');
  if (h.ramBytes < 16 * 2 ** 30) reasons.push('ram-below-16gb');
  const isOs14_4 = h.osMajor > 23 || (h.osMajor === 23 && h.osMinor >= 4);
  if (reasons.length === 0 && !isOs14_4) {
    return { tier: 'mic-only', reasons: ['os-below-14.4'] };
  }
  if (reasons.length > 0) return { tier: 'refused', reasons };
  return { tier: 'full' };
}

export function isMacAudioLoopbackSupported(): boolean {
  return checkHardwareFloor(probeHost()).tier === 'full';
}
```

- [ ] **Step 3: 테스트 통과**

Run: `pnpm test hardware-check`
Expected: PASS (5 tests).

- [ ] **Step 4: 커밋**

```bash
git add desktop/src/main/platform/hardware-check.ts desktop/src/main/platform/__tests__
git commit -m "feat(platform): hardware floor probe (full/mic-only/refused)"
```

---

### Task 4.2: 모델 매니페스트 + 다운로드 매니저

**Files:**
- Create: `desktop/src/main/downloader/manifest.ts`
- Create: `desktop/src/main/downloader/manager.ts`
- Create: `desktop/src/main/downloader/__tests__/manager.test.ts`

- [ ] **Step 1: 매니페스트 (모델 카탈로그)**

`desktop/src/main/downloader/manifest.ts`:
```ts
import type { ModelDescriptor, Language } from '@shared/types';

// 실제 URL/SHA256 은 v2.0 freeze 시점에 huggingface 또는 자체 mirror 에서 확정.
// 본 plan 의 placeholder 는 hardcoded URL 추측 금지 — freeze 직전 확정 task 별도.
export const STT_MODELS: Record<Language, ModelDescriptor> = {
  ja: { kind: 'stt', language: 'ja', filename: 'kotoba-whisper-v2.0-q4.gguf', sizeBytes: 420_000_000, sha256: 'TBD-AT-FREEZE', source: { url: 'TBD-AT-FREEZE' } },
  en: { kind: 'stt', language: 'en', filename: 'distil-large-v3-q4.gguf', sizeBytes: 420_000_000, sha256: 'TBD-AT-FREEZE', source: { url: 'TBD-AT-FREEZE' } },
  ko: { kind: 'stt', language: 'ko', filename: 'whisper-large-v3-q4.gguf', sizeBytes: 1_500_000_000, sha256: 'TBD-AT-FREEZE', source: { url: 'TBD-AT-FREEZE' } },
  zh: { kind: 'stt', language: 'zh', filename: 'whisper-large-v3-q4.gguf', sizeBytes: 1_500_000_000, sha256: 'TBD-AT-FREEZE', source: { url: 'TBD-AT-FREEZE' } },
};

export const LLM_MODEL: ModelDescriptor = {
  kind: 'llm',
  filename: 'gemma-4-4b-q4.gguf',     // freeze 시점에 Gemma 4 4B 사용 가능 여부 따라 gemma-3-4b-q4.gguf 로 교체
  sizeBytes: 2_500_000_000,
  sha256: 'TBD-AT-FREEZE',
  source: { url: 'TBD-AT-FREEZE' },
};
```

> **TBD 처리:** 위 `TBD-AT-FREEZE` 는 plan 의 No-Placeholder 룰 예외다. 이유: 스펙 §3 이 명시적으로 "Gemma 4 4B *if released and GGUF-available by v2.0 freeze*; otherwise Gemma 3 4B" 라고 freeze 시점 결정으로 deferred. URL/sha256 도 동일 — Hugging Face 의 정확한 revision 을 freeze 시점에 확인해서 박는 것이 CLAUDE.md URL 검증 룰과 부합. **이 placeholder 를 그대로 코드에 남기지 말고, v2.0 freeze 직전 별도 commit ("chore(models): pin model URLs + sha256 for v2.0 freeze") 으로 채워 넣는다.** 매니페스트 sha256 이 `TBD-AT-FREEZE` 이면 ManifestValidator 가 다운로드를 거부하도록 Step 2 에서 검증 로직 포함.

- [ ] **Step 2: 다운로드 매니저 — 큐, resume, sha256 검증**

`desktop/src/main/downloader/manager.ts`:
```ts
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ModelDescriptor } from '@shared/types';

export interface DownloadProgress {
  filename: string; bytesDone: number; bytesTotal: number; phase: 'queued' | 'downloading' | 'verifying' | 'done' | 'paused' | 'error';
  message?: string;
}

export class DownloadManager {
  private queue: ModelDescriptor[] = [];
  private currentAbort?: AbortController;
  private paused = false;
  private listeners: ((p: DownloadProgress) => void)[] = [];

  enqueue(desc: ModelDescriptor) { this.queue.push(desc); this.tick(); }
  onProgress(cb: (p: DownloadProgress) => void) { this.listeners.push(cb); }
  pause() { this.paused = true; this.currentAbort?.abort(); }
  resume() { this.paused = false; this.tick(); }

  private emit(p: DownloadProgress) { for (const l of this.listeners) l(p); }

  private async tick() {
    if (this.paused || this.queue.length === 0) return;
    const desc = this.queue[0];
    if (desc.sha256 === 'TBD-AT-FREEZE') {
      this.emit({ filename: desc.filename, bytesDone: 0, bytesTotal: desc.sizeBytes, phase: 'error', message: 'model not pinned (freeze pending)' });
      this.queue.shift();
      return this.tick();
    }
    try {
      await this.download(desc);
      this.queue.shift();
      this.tick();
    } catch (e) {
      this.emit({ filename: desc.filename, bytesDone: 0, bytesTotal: desc.sizeBytes, phase: 'error', message: String(e) });
    }
  }

  private async download(desc: ModelDescriptor) {
    const dest = `${process.env.LISNA_MODELS_DIR}/${desc.filename}`;
    const existing = existsSync(dest) ? statSync(dest).size : 0;
    if (existing === desc.sizeBytes && await this.verify(dest, desc.sha256)) {
      this.emit({ filename: desc.filename, bytesDone: existing, bytesTotal: desc.sizeBytes, phase: 'done' });
      return;
    }
    this.currentAbort = new AbortController();
    const res = await fetch(desc.source.url, {
      headers: existing ? { Range: `bytes=${existing}-` } : {},
      signal: this.currentAbort.signal,
    });
    if (!res.body) throw new Error('no body');
    const out = createWriteStream(dest, { flags: existing ? 'a' : 'w' });
    let done = existing;
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      out.write(chunk);
      done += chunk.length;
      this.emit({ filename: desc.filename, bytesDone: done, bytesTotal: desc.sizeBytes, phase: 'downloading' });
    }
    out.end();
    this.emit({ filename: desc.filename, bytesDone: done, bytesTotal: desc.sizeBytes, phase: 'verifying' });
    if (!await this.verify(dest, desc.sha256)) throw new Error('sha256 mismatch');
    this.emit({ filename: desc.filename, bytesDone: done, bytesTotal: desc.sizeBytes, phase: 'done' });
  }

  private async verify(path: string, expected: string): Promise<boolean> {
    const hash = createHash('sha256');
    const fs = await import('node:fs');
    for await (const chunk of fs.createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === expected;
  }
}
```

- [ ] **Step 3: 테스트 — 로컬 file:// URL + 작은 픽스처로 verify 까지**

`manager.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DownloadManager } from '../manager';

describe('DownloadManager', () => {
  it('sha256 mismatch 면 error phase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lisna-'));
    process.env.LISNA_MODELS_DIR = dir;
    const srcPath = join(dir, 'src.gguf');
    writeFileSync(srcPath, 'hello world');
    const m = new DownloadManager();
    let last: any;
    m.onProgress(p => { last = p; });
    m.enqueue({
      kind: 'llm', filename: 'x.gguf', sizeBytes: 'hello world'.length,
      sha256: createHash('sha256').update('NOT THIS').digest('hex'),
      source: { url: 'file://' + srcPath },
    });
    await new Promise(r => setTimeout(r, 200));
    expect(last.phase).toBe('error');
  });
});
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test manager`
Expected: PASS.

(`fetch` 가 `file://` 를 지원하지 않을 수 있으므로, `file://` 처리는 매니저 내부에서 `fs.createReadStream` 분기 처리 — 위 구현에서 그 점을 추가하거나, 테스트를 `http.createServer` 미니 서버로 변경. 구현 task 진입 시 결정.)

- [ ] **Step 5: 커밋**

```bash
git add desktop/src/main/downloader
git commit -m "feat(downloader): queued download manager with sha256 verify"
```

---

### Task 4.3: RAM 압력 watcher → 다운로드 pause/resume

**Files:**
- Create: `desktop/src/main/downloader/ram-pressure.ts`
- Create: `desktop/src/main/downloader/__tests__/ram-pressure.test.ts`

- [ ] **Step 1: 실패 테스트 (mocked freemem)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { RamPressureWatcher } from '../ram-pressure';

describe('RamPressureWatcher', () => {
  it('freemem < threshold → pause 호출', () => {
    const events: string[] = [];
    const w = new RamPressureWatcher({
      probe: { totalmem: () => 16 * 2**30, freemem: () => 1.5 * 2**30 },
      thresholdFreeBytes: 2 * 2**30,
      onPause: () => events.push('pause'),
      onResume: () => events.push('resume'),
    });
    w.tick();
    expect(events).toEqual(['pause']);
    (w as any).probe.freemem = () => 4 * 2**30;
    w.tick();
    expect(events).toEqual(['pause', 'resume']);
  });
});
```

- [ ] **Step 2: 구현**

```ts
export class RamPressureWatcher {
  private paused = false;
  constructor(private opts: {
    probe: { totalmem(): number; freemem(): number };
    thresholdFreeBytes: number;
    onPause(): void; onResume(): void;
    intervalMs?: number;
  }) {}
  start() { this.t = setInterval(() => this.tick(), this.opts.intervalMs ?? 1000); }
  stop() { if (this.t) clearInterval(this.t); }
  private t?: NodeJS.Timeout;
  tick() {
    const free = this.opts.probe.freemem();
    if (!this.paused && free < this.opts.thresholdFreeBytes) {
      this.paused = true; this.opts.onPause();
    } else if (this.paused && free > this.opts.thresholdFreeBytes * 1.5) {
      this.paused = false; this.opts.onResume();
    }
  }
}
```

- [ ] **Step 3: 테스트 통과 + DownloadManager 와 결선**

main/index.ts 에서 `const watcher = new RamPressureWatcher({ probe: os, thresholdFreeBytes: 2 * 2**30, onPause: () => dm.pause(), onResume: () => dm.resume() });` 설치.

- [ ] **Step 4: 커밋**

```bash
git add desktop/src/main/downloader/ram-pressure.ts desktop/src/main/downloader/__tests__
git commit -m "feat(downloader): pause/resume on host RAM pressure"
```

---

### Task 4.4: First-run UI — 언어 선택 → 다운로드 → 진입

**Files:**
- Modify: `desktop/src/renderer/routes/FirstRunSetup.tsx`
- Create: `desktop/src/renderer/components/LanguagePicker.tsx`
- Create: `desktop/src/renderer/components/DownloadProgress.tsx`
- Create: `desktop/src/renderer/components/BelowFloorRedirect.tsx`
- Modify: `desktop/src/main/ipc.ts` (download 진행 채널)
- Create: `desktop/src/renderer/i18n/{ja,en,ko,zh}.json`

- [ ] **Step 1: 메인에서 first-run 상태 + 다운로드 enqueue IPC**

```ts
ipcMain.handle('setup/floorCheck', () => checkHardwareFloor(probeHost()));
ipcMain.handle('setup/selectLanguage', (_e, lang: Language) => {
  // 매니페스트 enqueue: STT 우선, LLM 후속
  dm.enqueue(STT_MODELS[lang]);
  dm.enqueue(LLM_MODEL);
  store.set('userLanguage', lang);
  return { ok: true };
});
dm.onProgress(p => mainWindow?.webContents.send('setup/downloadProgress', p));
```

- [ ] **Step 2: LanguagePicker UI**

```tsx
const LANGS: { code: Language; label: string }[] = [
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'en', label: '🇺🇸 English' },
  { code: 'ko', label: '🇰🇷 한국어' },
  { code: 'zh', label: '🇨🇳 中文' },
];

export function LanguagePicker({ onPick }: { onPick: (l: Language) => void }) {
  return <div>
    <h2>Choose your primary language</h2>
    <p>One model per language. Switch later in settings (re-download required).</p>
    {LANGS.map(l => <button key={l.code} onClick={() => onPick(l.code)}>{l.label}</button>)}
  </div>;
}
```

- [ ] **Step 3: DownloadProgress UI**

```tsx
export function DownloadProgress({ progress }: { progress: DownloadProgress[] }) {
  return <ul>{progress.map(p =>
    <li key={p.filename}>
      {p.filename} — {p.phase} ({(p.bytesDone / 1e9).toFixed(2)} / {(p.bytesTotal / 1e9).toFixed(2)} GB)
    </li>)}</ul>;
}
```

- [ ] **Step 4: BelowFloorRedirect UI**

```tsx
export function BelowFloorRedirect({ reasons }: { reasons: string[] }) {
  return <section>
    <h2>This device doesn't meet Lisna v2's hardware floor</h2>
    <ul>{reasons.map(r => <li key={r}>{r}</li>)}</ul>
    <p>Try Lisna v1 (Chrome extension) at <a href="https://lisna.jp">lisna.jp</a>.</p>
  </section>;
}
```

- [ ] **Step 5: FirstRunSetup 라우트가 floorCheck → tier 따라 분기**

- `full` 또는 `mic-only` → LanguagePicker → 다운로드 진행 UI
- `refused` → BelowFloorRedirect

- [ ] **Step 6: i18n JSON 4종 시드 — v1 의 동등 strings 포팅**

`desktop/src/renderer/i18n/ja.json`, `en.json`, `ko.json`, `zh.json` — Setup/Recording 화면의 핵심 카피만. v1 `extension/src/locales/*.json` 에서 대응 키 복사 + 데스크탑 맥락에 맞게 한 줄 정도 수정.

`desktop/src/renderer/i18n/index.ts`:
```ts
import ja from './ja.json'; import en from './en.json'; import ko from './ko.json'; import zh from './zh.json';
const tables = { ja, en, ko, zh };
export function t(lang: Language, key: string): string {
  return (tables[lang] as Record<string, string>)[key] ?? key;
}
```

- [ ] **Step 7: 수동 검증 — 4개 언어 각각 first-run 흐름 한 번씩**

(다운로드 실제 검증은 freeze 후 모델 URL 박힌 다음에. 본 task 진행 시에는 file:// fixture URL 로 fake 검증.)

- [ ] **Step 8: 커밋**

```bash
git add desktop/src/renderer/routes/FirstRunSetup.tsx desktop/src/renderer/components/LanguagePicker.tsx desktop/src/renderer/components/DownloadProgress.tsx desktop/src/renderer/components/BelowFloorRedirect.tsx desktop/src/renderer/i18n desktop/src/main/ipc.ts
git commit -m "feat(setup): first-run language picker + tiered download UX"
```

---

### Task 4.5: 4개 언어 end-to-end smoke (JA / EN / KO / ZH)

**Files:**
- Create: `desktop/tests/e2e/four-languages.spec.ts`
- Modify: `desktop/tests/fixtures/audio/` — en-30s.wav, ko-30s.wav, zh-30s.wav 추가
- Modify: `desktop/tests/fixtures/transcripts/` — 대응 expected txt

- [ ] **Step 1: 4개 언어 fixture 음성 + transcript 확보**

각 30s 모노 16kHz 짧은 발화. 직접 녹음 또는 Common Voice / LibriSpeech 에서 짧은 단일 화자 클립 추출.

- [ ] **Step 2: 통합 테스트 — 매트릭스**

```ts
import { describe, it, expect } from 'vitest';
import { runSttFixture } from './helpers';

const cases: Array<{ lang: Language; modelEnv: string; needle: string }> = [
  { lang: 'ja', modelEnv: 'LISNA_TEST_STT_MODEL_JA', needle: 'こんにちは' },
  { lang: 'en', modelEnv: 'LISNA_TEST_STT_MODEL_EN', needle: 'hello' },
  { lang: 'ko', modelEnv: 'LISNA_TEST_STT_MODEL_KO', needle: '안녕' },
  { lang: 'zh', modelEnv: 'LISNA_TEST_STT_MODEL_ZH', needle: '你好' },
];

for (const c of cases) {
  const skip = !process.env[c.modelEnv] ? it.skip : it;
  skip(`${c.lang} 모델로 fixture 전사 결과에 ${c.needle} 포함`, async () => {
    const text = await runSttFixture(c.lang, process.env[c.modelEnv]!);
    expect(text).toContain(c.needle);
  }, 120_000);
}
```

`runSttFixture` 는 사이드카 spawn → load → fixture audio Float32 변환 → transcribe → join 텍스트 반환 헬퍼.

- [ ] **Step 3: 4개 케이스 모두 PASS 확인 (각 모델 env var 설정)**

- [ ] **Step 4: 커밋**

```bash
git add desktop/tests
git commit -m "test(e2e): four-language STT fixture smoke (JA/EN/KO/ZH)"
```

---

## Phase 5 — 메모리 예산 소크 테스트

목표: 스펙 §4 의 시간 분할 가정을 *측정* 으로 검증. 4시간 연속 load-STT → transcribe → unload → load-LLM → generate → unload 사이클을 돌리면서 RSS 가 안정적으로 ≤ 2.5GB + sidecar baseline 으로 유지되는지, KO/ZH 트랜지션 (1.5→2.5GB) 에서도 4GB 동시 점유가 발생하지 않는지 확인. Phase 6 packaging 시작 전 통과 필수.

스펙 근거: §4 (KO/ZH 트랜지션 명시), §9 Risk 4 (4시간 소크 의무).

### Task 5.1: 소크 하네스 + 메모리 프로브

**Files:**
- Create: `desktop/tests/soak/memory-probe.ts`
- Create: `desktop/tests/soak/soak-harness.ts`
- Create: `desktop/tests/soak/run-soak.ts`

- [ ] **Step 1: 메모리 프로브 — 사이드카 RSS + 호스트 free RAM 샘플링**

`memory-probe.ts`:
```ts
import { execSync } from 'node:child_process';
import os from 'node:os';

export interface MemorySample {
  ts: number; // epoch ms
  sidecarRssBytes: number;
  hostFreeBytes: number;
  hostTotalBytes: number;
  phase: 'idle' | 'stt' | 'transition' | 'llm';
}

export function sampleMemory(sidecarPid: number, phase: MemorySample['phase']): MemorySample {
  const rss = Number(execSync(`ps -o rss= -p ${sidecarPid}`).toString().trim()) * 1024;
  return {
    ts: Date.now(),
    sidecarRssBytes: rss,
    hostFreeBytes: os.freemem(),
    hostTotalBytes: os.totalmem(),
    phase,
  };
}
```

- [ ] **Step 2: 하네스 (1 사이클 = 1 STT 로드 + transcribe 10회 + STT 언로드 + LLM 로드 + generate + LLM 언로드)**

`soak-harness.ts`:
```ts
import { SidecarSupervisor } from '../../src/main/sidecar/supervisor';
import { WhisperCppSTT } from '../../src/main/engines/whisper-cpp-stt';
import { LlamaCppLLM } from '../../src/main/engines/llama-cpp-llm';
import { sampleMemory, MemorySample } from './memory-probe';
import { readFileSync, writeFileSync } from 'node:fs';

export async function runSoak(opts: { sttPath: string; llmPath: string; lang: 'ja'|'en'|'ko'|'zh'; cycles: number; outPath: string }) {
  const sv = new SidecarSupervisor({ onCrash: m => { throw new Error('sidecar crash: ' + m); } });
  const client = sv.start();
  await new Promise(r => setTimeout(r, 500));
  const pid = (sv as any).proc.pid as number;
  const stt = new WhisperCppSTT(client);
  const llm = new LlamaCppLLM(client);
  const samples: MemorySample[] = [];
  const fixtureF32 = loadFixture16k('tests/fixtures/audio/' + opts.lang + '-30s.wav');

  for (let i = 0; i < opts.cycles; i++) {
    samples.push(sampleMemory(pid, 'idle'));
    await stt.loadModel(opts.sttPath, opts.lang);
    samples.push(sampleMemory(pid, 'stt'));
    for (let j = 0; j < 10; j++) await stt.transcribe(fixtureF32);
    samples.push(sampleMemory(pid, 'stt'));
    await stt.unloadModel();
    samples.push(sampleMemory(pid, 'transition'));
    await llm.loadModel(opts.llmPath);
    samples.push(sampleMemory(pid, 'llm'));
    let _ = '';
    for await (const tok of llm.generate('Summarize: hello', { maxTokens: 64 })) _ += tok;
    samples.push(sampleMemory(pid, 'llm'));
    await llm.unloadModel();
    samples.push(sampleMemory(pid, 'idle'));
    writeFileSync(opts.outPath, JSON.stringify(samples)); // 매 사이클마다 저장 (크래시 대비)
  }
  await sv.shutdown();
  return samples;
}
```

(`loadFixture16k` 는 wav 헤더 skip + Int16→Float32 변환 헬퍼. Task 2.6 에서 작성한 인라인 코드를 별도 헬퍼로 추출.)

- [ ] **Step 3: 실행 스크립트**

`run-soak.ts`:
```ts
import { runSoak } from './soak-harness';

const lang = (process.env.SOAK_LANG ?? 'ja') as any;
const cycles = Number(process.env.SOAK_CYCLES ?? 240); // 240 사이클 × ~1분 = ~4시간
runSoak({
  sttPath: process.env[`LISNA_TEST_STT_MODEL_${lang.toUpperCase()}`]!,
  llmPath: process.env.LISNA_TEST_LLM_MODEL!,
  lang, cycles,
  outPath: `tests/soak/results/${lang}-${Date.now()}.json`,
}).then(s => console.log('soak done, samples:', s.length));
```

- [ ] **Step 4: 커밋**

```bash
git add desktop/tests/soak
git commit -m "test(soak): harness + memory probe for time-sliced cycles"
```

---

### Task 5.2: 통과 기준 검증기 + KO/ZH 트랜지션 게이트

**Files:**
- Create: `desktop/tests/soak/verify.ts`
- Create: `desktop/tests/soak/__tests__/verify.test.ts`

스펙 §4 의 통과 기준:
- 1 사이클 후 idle RSS 가 사이드카 baseline 의 +50MB 이내로 복귀 (누수 검출).
- `transition` 샘플에서 RSS 가 (STT 모델 사이즈 + LLM 모델 사이즈) 보다 작아야 함 (= 동시 점유 없음 검증). KO/ZH 의 경우 1.5+2.5 = 4GB 미만이어야 함, 단 더 엄격하게 `(LLM size + 500MB headroom)` 이내.
- 호스트 free RAM 이 어떤 샘플에서도 1GB 아래로 떨어지지 않음.

- [ ] **Step 1: 검증기 구현 + 단위 테스트**

```ts
import { MemorySample } from './memory-probe';

export interface Verdict {
  ok: boolean;
  violations: string[];
}

export function verifySoak(samples: MemorySample[], opts: {
  sttSizeBytes: number; llmSizeBytes: number; baselineRssBytes: number;
}): Verdict {
  const v: string[] = [];
  const peakTransition = Math.max(...samples.filter(s => s.phase === 'transition').map(s => s.sidecarRssBytes), 0);
  const limit = opts.llmSizeBytes + 500 * 2**20;
  if (peakTransition > limit) v.push(`transition peak RSS ${peakTransition} > ${limit}`);

  const minHostFree = Math.min(...samples.map(s => s.hostFreeBytes));
  if (minHostFree < 1 * 2**30) v.push(`host free RAM dropped to ${minHostFree}`);

  // 누수 검출: 마지막 idle 샘플이 첫 idle 샘플 baseline + 50MB 보다 크면
  const idles = samples.filter(s => s.phase === 'idle');
  if (idles.length >= 2 && idles.at(-1)!.sidecarRssBytes > idles[0]!.sidecarRssBytes + 50 * 2**20)
    v.push(`possible leak: idle RSS grew ${idles[0]!.sidecarRssBytes} → ${idles.at(-1)!.sidecarRssBytes}`);

  return { ok: v.length === 0, violations: v };
}
```

`verify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { verifySoak } from '../verify';

describe('verifySoak', () => {
  it('KO/ZH 트랜지션에서 4GB 동시점유 감지', () => {
    const samples = [
      { ts: 0, phase: 'idle', sidecarRssBytes: 50e6, hostFreeBytes: 8e9, hostTotalBytes: 16e9 },
      { ts: 1, phase: 'transition', sidecarRssBytes: 3.9e9, hostFreeBytes: 4e9, hostTotalBytes: 16e9 }, // STT+LLM 동시
      { ts: 2, phase: 'idle', sidecarRssBytes: 60e6, hostFreeBytes: 8e9, hostTotalBytes: 16e9 },
    ] as any;
    const v = verifySoak(samples, { sttSizeBytes: 1.5e9, llmSizeBytes: 2.5e9, baselineRssBytes: 50e6 });
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toMatch(/transition peak/);
  });
});
```

- [ ] **Step 2: 테스트 통과**

Run: `pnpm test verify`
Expected: PASS.

- [ ] **Step 3: 4시간 실제 소크 — JA 와 KO 두 매트릭스에서 각각 1회 (실 머신, 야간 실행)**

```bash
SOAK_LANG=ja SOAK_CYCLES=240 \
LISNA_TEST_STT_MODEL_JA=... LISNA_TEST_LLM_MODEL=... \
  pnpm tsx tests/soak/run-soak.ts

SOAK_LANG=ko SOAK_CYCLES=240 \
LISNA_TEST_STT_MODEL_KO=... LISNA_TEST_LLM_MODEL=... \
  pnpm tsx tests/soak/run-soak.ts
```

각 결과 JSON 을 `verifySoak` 로 검증. 위반 없으면 통과.

결과 (위반/통과 + 피크 RSS / min host free) 를 `desktop/docs/soak-results.md` 에 표로 기록.

- [ ] **Step 4: CI 게이트 — packaging job 전에 가장 최근 소크 결과 verify**

`desktop/ci/gates.ts` 에 `LISNA_REQUIRE_SOAK=true` 일 때 가장 최근 소크 결과 verify 호출 추가. 실제 CI 매트릭스에서는 manual gate (사람 손) — 소크는 4시간이라 PR-time 게이트로 부적합.

- [ ] **Step 5: 커밋**

```bash
git add desktop/tests/soak desktop/docs/soak-results.md desktop/ci/gates.ts
git commit -m "test(soak): JA+KO 4h cycles pass memory budget verifier"
```

---

## Phase 6 — 패키징 / 사이닝 / 노터라이즈 / 자동 업데이트

목표: M1 16GB / macOS 14.4+ 사용자가 DMG 다운로드 → 마운트 → 드래그 인스톨 → 첫 실행 → 모델 다운로드 → JA 녹음/노트 생성 → 자동 업데이트 채널 등록까지 완주. CWS 가 아니라 자체 호스팅 DMG (또는 lisna.jp 의 download 페이지).

스펙 근거: §7 (signing, notarization, entitlements, electron-updater).

### Task 6.1: electron-builder 설정 + DMG 빌드

**Files:**
- Create: `desktop/electron-builder.yml`
- Modify: `desktop/package.json`
- Create: `desktop/build/entitlements.mac.plist`
- Create: `desktop/resources/sidecar` (Phase 2 빌드 결과를 복사하는 빌드 hook)

- [ ] **Step 1: 사이드카 빌드 산출물을 resources/ 에 배치하는 hook**

`scripts/build.sh` 가 이미 `resources/sidecar` 로 복사. 추가로 entitlements 와 함께 사이드카 바이너리를 별도 사이닝하려면 `electron-builder.afterPack` hook 필요.

`desktop/build/afterPack.cjs`:
```cjs
const { execSync } = require('child_process');
const { join } = require('path');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const sidecar = join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources', 'sidecar');
  // 코드 사이닝은 afterSign 에서. 여기서는 위치 검증만.
  execSync(`test -f "${sidecar}"`);
};
```

- [ ] **Step 2: entitlements**

`desktop/build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
</dict>
</plist>
```

(`allow-unsigned-executable-memory` 는 llama.cpp 의 JIT/mmap weight 를 위해 필수 — 스펙 §7.)

- [ ] **Step 3: electron-builder.yml**

```yaml
appId: jp.lisna.desktop
productName: Lisna
artifactName: ${productName}-${version}-${arch}.${ext}
directories:
  output: dist
files:
  - out/**
  - resources/sidecar
extraResources:
  - from: resources/sidecar
    to: sidecar
  - from: out/preload
    to: preload
asar: true
mac:
  target:
    - target: dmg
      arch: [arm64]
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  identity: ${APPLE_TEAM_ID}
afterPack: build/afterPack.cjs
afterSign: build/afterSign.cjs
publish:
  provider: generic
  url: https://lisna.jp/updates/desktop/  # electron-updater 채널
```

- [ ] **Step 4: 노터라이즈 hook (`afterSign.cjs`)**

```cjs
const { notarize } = require('@electron/notarize');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

`pnpm add -D @electron/notarize`

- [ ] **Step 5: 로컬 빌드 1회 (사이닝 ID 가 keychain 에 있을 때)**

Run:
```bash
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... \
  pnpm --filter @lisna/desktop package
```
Expected: `dist/Lisna-0.0.1-arm64.dmg` 생성. 노터라이즈 staple 까지 완료 (`xcrun stapler validate` 통과).

**스펙 §7 의 ~3 일 버퍼 예약** — 첫 노터라이즈에서 entitlement 이슈 / signing chain 오류로 시간 소모 가능.

- [ ] **Step 6: 커밋**

```bash
git add desktop/electron-builder.yml desktop/build desktop/package.json
git commit -m "feat(packaging): electron-builder + notarize wiring (mac arm64)"
```

---

### Task 6.2: 사이드카 + 모델 경로 — packaged vs dev 분기

**Files:**
- Modify: `desktop/src/main/sidecar/supervisor.ts`
- Modify: `desktop/src/main/platform/paths.ts`

- [ ] **Step 1: paths.ts**

```ts
import { app } from 'electron';
import { join } from 'node:path';

export function sidecarBinPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sidecar')
    : join(app.getAppPath(), 'resources', 'sidecar');
}
export function modelsDir(): string {
  return join(app.getPath('userData'), 'models');
}
```

- [ ] **Step 2: supervisor 및 first-run 다운로드가 `modelsDir()` 사용**

기존 `LISNA_MODELS_DIR` env 의존을 제거하고 paths.modelsDir() 로 통일.

- [ ] **Step 3: dev / packaged 양쪽 빌드에서 모델 다운로드 후 동작 확인**

수동: dev 한 번 + packaged DMG 마운트 후 한 번. `userData/models/` 에 GGUF 파일 들어가는지, 사이드카가 그 경로로 로드하는지.

- [ ] **Step 4: 커밋**

```bash
git add desktop/src/main
git commit -m "feat(packaging): packaged-vs-dev sidecar+models path resolution"
```

---

### Task 6.3: electron-updater + 업데이트 채널

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/electron-builder.yml` (publish 블록 이미 추가됨)
- Create: `desktop/src/main/updater.ts`

- [ ] **Step 1: 의존성 + 코드**

```bash
cd desktop && pnpm add electron-updater
```

`desktop/src/main/updater.ts`:
```ts
import { autoUpdater } from 'electron-updater';
import { app, dialog } from 'electron';

export function installAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox({
      type: 'info',
      title: 'Lisna update ready',
      message: 'Restart now to apply update?',
      buttons: ['Restart', 'Later'],
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
}
```

index.ts 의 `whenReady` 안에서 `installAutoUpdater()` 호출.

- [ ] **Step 2: 자체 업데이트 서버 (lisna.jp) 의 `/updates/desktop/` 정적 호스팅 준비**

- `latest-mac.yml` (electron-builder publish 의 산출물) 을 S3 / Cloudflare R2 / Vercel static 에 업로드.
- 이 plan 의 범위: 첫 릴리스 직후 manual 업로드. 자동화 (GH Actions release flow) 는 v2.0.1 이후 별도 spec.

- [ ] **Step 3: 수동 검증 — v0.0.1 빌드 + 가짜 v0.0.2 publish 후 v0.0.1 앱 실행 → update 다운로드 prompt 확인**

- [ ] **Step 4: 커밋**

```bash
git add desktop/src/main/updater.ts desktop/src/main/index.ts desktop/package.json
git commit -m "feat(packaging): electron-updater wired to lisna.jp generic channel"
```

---

### Task 6.4: 매트릭스 검증 — macOS 14.4 floor + Electron 39 runtime floor sync

**Files:**
- Create: `desktop/docs/release-matrix.md`

스펙 §7 의 명시적 룰: "Electron 39 의 macOS-runtime floor 가 14.4 이상이면 §1 의 OS floor 와 어긋남 — 둘 중 하나 정정."

- [ ] **Step 1: Electron 39 (또는 freeze 시점 사용 minor) 의 supported macOS 명시 확인**

Electron 릴리스 노트 + `process.getSystemVersion()` 호환성 확인. 결과를 `release-matrix.md` 에 표로 기록.

- [ ] **Step 2: 검증 매트릭스 — 다음 머신/환경 각각에서 install + 첫 실행 + JA 녹음 1회**

| 환경 | 예상 결과 |
|---|---|
| M1 16GB / macOS 14.4 | full tier, JA 녹음 OK |
| M1 16GB / macOS 13.6 | mic-only, JA 녹음 OK, 시스템 오디오 메뉴 disabled |
| M2 16GB / macOS 15.x | full, JA 녹음 OK |
| Intel Mac | install refused |
| M1 8GB | install refused |

(실제 매트릭스 머신 수급이 부족하면 가능한 만큼 검증 + 미검증 환경은 release-matrix.md 에 명시.)

- [ ] **Step 3: 검증 결과 문서화 + 커밋**

```bash
git add desktop/docs/release-matrix.md
git commit -m "docs(release): mac matrix + Electron 39 runtime floor sync"
```

---

### Task 6.5: 최종 알파 릴리스 패키지 + 다운로드 페이지 연결

**Files:**
- Modify: `web/` (v1 마케팅 사이트의 lisna.jp/download 페이지에 v2 알파 링크 추가 — 별 패키지 작업이지만 본 plan 의 마지막 단계)

- [ ] **Step 1: v0.0.1-alpha 빌드 + 노터라이즈 staple + 호스팅 업로드**

```bash
APPLE_*=... pnpm --filter @lisna/desktop package
xcrun stapler validate dist/Lisna-0.0.1-arm64.dmg
# DMG + latest-mac.yml 을 호스팅 (Cloudflare R2 / S3 / Vercel static)
```

- [ ] **Step 2: lisna.jp 다운로드 페이지에 "v2 알파 (Mac)" 섹션 추가**

`web/` 의 적절한 페이지에 다운로드 링크 + 시스템 요구사항 표 + "v1 Chrome 확장은 계속 이용 가능" 문구.

- [ ] **Step 3: 첫 사용자 5명 대상 알파 배포 + 피드백 채널 (별도 워크스트림 — owner 지정 필요)**

본 plan 의 코드 작업은 여기서 종료. 알파 사용자 모집/피드백/일본 컴플라이언스 메시지 검증은 별도 워크스트림.

- [ ] **Step 4: 커밋 + 태그**

```bash
git add web/...
git commit -m "feat(web): v2 alpha download CTA + system requirements"
git tag v2.0.0-alpha.1
```

---

## Self-Review (작성자 self-check)

**1. Spec coverage**

| 스펙 섹션 | 커버 task |
|---|---|
| §1 Scope (Mac, M1+, 16GB+, macOS 14.4) | 4.1 floor probe, 6.4 matrix |
| §2 STT (10s 청크, 모델 4종, whisper.cpp) | 1.3 chunker, 2.3 whisper.cpp 통합, 4.5 4-lang smoke |
| §3 LLM (Gemma 4B, llama.cpp, 128K ctx) | 3.1 llama.cpp 통합, 3.2 엔진, 4.2 manifest |
| §4 메모리 (시간 분할, OS reclaim) | 3.4 OS reclaim, 3.5 오케스트레이터, 5.x 소크 |
| §5 아키텍처 (3-process, IPC, 인터페이스) | 0.4 인터페이스, 2.x 사이드카 IPC, 3.3 LLM 어댑터 |
| §6 클라우드 fallback 없음 + first-run UX | 4.2 매니페스트, 4.4 first-run UI |
| §7 Build/distribution | 6.1 builder, 6.3 updater, 6.4 matrix |
| §8 Out of scope | n/a (의도적) |
| §9 Risks 4 (4h soak) | Phase 5 전체 |
| §10 Decisions | 전 phase 의 구현 선택이 §10 표에 정합 |

**커버되지 않은 spec 항목 / 의도적 deferral:**
- §9 Risk 7 "50-meeting JA eval-set procurement" — 본 plan 의 범위 밖. v2.1 diarisation bakeoff 의존성. plan 종료 후 owner 지정 + 별도 워크스트림 필요.
- §3 의 "Gemma 4 4B if released" — Task 4.2 의 freeze 시점 매니페스트 핀에서 결정. plan 안에 명시.
- Note prompt engineering — 스펙 §8 명시적 out-of-scope. Task 3.5 의 `defaultPrompt` 는 stub 수준. 실제 production 프롬프트는 별도 spec.

**2. Placeholder scan**
- Task 2.6 의 모델 다운로드 URL 은 의도적 `placeholder` 표기 + 검증 요구 (CLAUDE.md URL 룰 준수).
- Task 4.2 의 매니페스트 `TBD-AT-FREEZE` 는 명시적 freeze-time placeholder + 코드상 거부 가드 (`sha256 === 'TBD-AT-FREEZE'` → error phase).
- "TODO / implement later / fill in details" 류 placeholder 없음.
- Step 단위로 검증 — 모든 step 이 구체 action.

**3. Type consistency**
- `STTEngine.transcribe(audio: Float32Array): Promise<TranscriptSegment[]>` 가 Task 0.4 정의 → 2.6 어댑터 → 3.5 오케스트레이터 통일.
- `LLMEngine.generate(prompt, opts): AsyncIterable<string>` 가 Task 0.4 → 3.3 어댑터 → 3.5 오케스트레이터 통일.
- `Language = 'ja'|'en'|'ko'|'zh'` 4종이 0.4, 4.1, 4.2, 4.4, 4.5 전부에서 동일.
- `SidecarRequest`/`Response` 의 `type` discriminator 가 사이드카 C++ dispatch 와 TS 클라이언트 양쪽에서 일치 (`load`, `unload`, `transcribe`, `generate`, `ping` / `ok`, `segments`, `token`, `done`, `error`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-12-v2-on-device-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Good fit for this plan because phases are sequential (한 phase 의 산출물이 다음 phase 의 입력) — 매 task 단위 review checkpoint 가 회수 큼.

**2. Inline Execution** — current session 에서 batch 진행, checkpoint 단위 리뷰.

어느 방식으로 진행할까요?

---

## 부록 A — 평가셋 / 모델 핀 등 plan-외 결정 항목

본 plan 의 execution 과 병렬로 결정/발주해야 하는 워크스트림:

1. **50-meeting JA eval-set (v2.1 diarisation 의존성)** — *owner = founder (옵션 A, 2026-05-12 결정).* 본 plan 의 어느 phase 에도 들어가지 않음. v2.0 코드 일정 슬립 수용. 부록 B 참고.
2. **모델 URL / sha256 핀 (Task 4.2 의 TBD-AT-FREEZE)** — v2.0 freeze 직전 별도 commit. Hugging Face revision + 자체 mirror 결정 포함. 라이선스(Apache 2.0 / Gemma terms) 검토 결과도 함께.
3. **Gemma 4 4B vs Gemma 3 4B 최종 결정** — 위와 동일 시점. 결정 root cause: `huggingface.co` 검색에서 `gemma-4-4b-it-q4_k_m.gguf` 또는 동등이 존재하면 Gemma 4, 아니면 Gemma 3.
4. **알파 사용자 모집 + 피드백 채널** — Task 6.5 의 알파 빌드 직후. 일본 JP 우선 (concept lock 정합).
5. **자동 릴리스 파이프라인 (electron-builder publish → S3/R2)** — 현 plan 은 manual upload. v2.0.1 이후 별도 spec.

---

## 부록 B — 평가셋 owner 결정 (스펙 §9 Risk 7 응답)

스펙 §9 의 명시: *"Owner of this workstream needs to be named before v2.0 feature freeze, otherwise v2.1 diarisation bakeoff slips."*

**결정 (2026-05-12, founder):** **옵션 A — founder 본인이 직접 발주 + 라벨링 책임.** v2.0 코드 일정의 슬립을 받아들이고, JP-native concept lock 정합성을 1인 검수로 확보. v2.0 코드는 본 plan 으로 계속 진행하되, 일정 압박이 올 때 "non-critical 스코프 컷" 이 디폴트 응답 — founder 시간을 "더 짜내기" 가 아니라.

**현재 상황:** 1인 founder 운영 + 본 prod 코드 작업이 메인 트랙. eval-set procurement (50시간 일본어 회의 오디오 + JP-native 라벨링) 는 *코딩이 아닌 데이터/오퍼레이션 워크스트림* — 엔지니어링 시간으로 흡수 시 v2.0 코드 슬립.

**고려된 선택지 (참고용으로 보존):**

| 옵션 | 비용 | 슬립 리스크 | 비고 |
|---|---|---|---|
| A. 자체 발주 (Founder 본인) | $0 직접비, 자기 시간 ~3-4주 | **v2.0 코드 슬립 거의 확정** | concept lock 정합성은 1인 검수가 최선이긴 함 |
| B. 데이터 라벨링 업체 (Lionbridge / Appen / Sama 등) | $5K-$15K 추정 (시급 + 라이선싱) | 낮음 — 외주 병렬 진행 | JP-native annotator 가용성 확인 필요 |
| C. 일본 대학원 LinguisticsLab / NLP 연구실 인턴 / 협업 | ~$3K-$8K 또는 공동 연구 + 데이터 공유 | 중간 — 협업 셋업 시간 | 학술 협력 + 향후 모델 협업으로 확장 가능 |
| D. v2.1 diarisation 자체를 슬립 인정 (v2.2 로 미루기) | $0 | n/a (이미 슬립) | v2.0 출시 직후 본격 검토 — concept lock 영향 제한적 |

**plan 작성 시점 추천:** **B 또는 C** 가 합리적. founder 시간 보호 + v2.1 bakeoff 일정 보존. 그러나 *최종 결정은 founder (사용자) 의 호출* — 본 plan 안에서 결정 박지 않음. 결정 시점 = v2.0 freeze 전 (스펙 §9 명시).

**결정 안 하면 일어나는 일:** v2.0 코드는 본 plan 으로 정상 진행. v2.0 출시 후 diarisation bakeoff 가 시작 못 함 → v2.1 의 핵심 기능 (다중 화자) 이 v2.2 로 미뤄짐 → PRD 시나리오 2/4 (Zoom/Teams/Meet, 회의실) 가 더 길게 deferred. concept lock ("모든 음성을, 디바이스 안에서, 구조화된 텍스트로") 은 단일 화자 모드만으로도 성립하므로 *치명적이지는 않음* — 다만 일본 enterprise 회의 시장의 wedge (스펙 §9 Risk 6) 가 좁아질 수 있음.

---





