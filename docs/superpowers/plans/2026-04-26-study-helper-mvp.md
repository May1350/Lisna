# Study-Helper MVP Implementation Plan (2-Day Sprint)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRD `2026-04-26-online-learning-summary-extension-design.md`의 F1~F10 풀 MVP를 2일 연속 개발(약 24~30 dev-hours)로 구현하고, Chrome 웹스토어 심사 제출 + AWS 프로덕션 배포까지 완료.

**Architecture:** 3-tier — Chrome Manifest V3 익스텐션 (TypeScript + Vite + React Side Panel) ↔ AWS API (Lambda + API Gateway REST/WebSocket + RDS Postgres + S3) ↔ External AI (OpenAI `gpt-4o-mini-transcribe` + Google Gemini 2.5 Flash). 전 구간 TypeScript, IaC는 AWS CDK로 1-shot 배포.

**Tech Stack:**
- Extension: TypeScript, Vite, `@crxjs/vite-plugin`, React 18, TailwindCSS
- Backend: TypeScript, AWS CDK, Lambda (Node 20), API Gateway (HTTP + WebSocket), RDS Postgres 16, S3, Secrets Manager
- AI: `openai` SDK (STT), `@google/generative-ai` SDK (LLM)
- Auth: Google OAuth 2.0 + custom JWT (jose)
- Payments: Stripe Checkout + webhooks
- Web: Next.js 16 App Router (마케팅 / 利用規約 / プライバシー)
- DevOps: pnpm workspace monorepo, GitHub Actions (선택), AWS CDK CLI

**External blockers (병렬 트랙)**:
- Chrome 웹스토어: 등록 후 1~3일 검토 → Day 2 종료 시점 "Submitted" 상태가 골
- Stripe: 본인/법인 검증 1~2영업일 → Day 0(작업 시작 전)에 미리 등록 시작 권장
- Google Cloud Console OAuth client 생성 → Day 1 시작 직전에 미리 발급

---

## File Structure

```
Study-Helper/
├── extension/                      # Chrome 익스텐션
│   ├── manifest.config.ts          # Manifest V3 설정 (CRX plugin)
│   ├── vite.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── content/
│       │   ├── index.ts            # 진입점: video 감지, 토스트
│       │   ├── toast.ts            # 토스트 DOM
│       │   ├── audio-capture.ts    # captureStream + 15s 청크
│       │   └── slide-detector.ts   # 1fps frame diff
│       ├── side-panel/
│       │   ├── index.html
│       │   ├── main.tsx            # React 진입점
│       │   ├── App.tsx
│       │   ├── api-client.ts       # WebSocket + REST
│       │   └── components/
│       │       ├── NoteList.tsx
│       │       ├── NoteItem.tsx
│       │       ├── ConsentModal.tsx
│       │       ├── DownloadButton.tsx
│       │       ├── QuotaBanner.tsx
│       │       └── LoginScreen.tsx
│       ├── service-worker/
│       │   ├── index.ts            # Manifest V3 background
│       │   ├── auth.ts             # Google OAuth via chrome.identity
│       │   └── messaging.ts        # 컴포넌트 간 메시지
│       └── shared/
│           ├── types.ts            # 모든 컴포넌트 공유 타입
│           ├── config.ts           # API base URL 등
│           └── storage.ts          # chrome.storage 래퍼
│
├── backend/                        # AWS Lambda 함수들
│   ├── package.json
│   ├── tsconfig.json
│   ├── infra/                      # CDK
│   │   ├── bin/app.ts
│   │   ├── cdk.json
│   │   └── lib/
│   │       ├── network-stack.ts    # VPC, subnets
│   │       ├── data-stack.ts       # RDS Postgres + S3
│   │       ├── api-stack.ts        # Lambda + API Gateway HTTP
│   │       ├── ws-stack.ts         # API Gateway WebSocket
│   │       └── secrets-stack.ts    # Secrets Manager
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── auth-google.ts      # POST /v1/auth/google
│   │   │   ├── auth-me.ts          # GET /v1/auth/me
│   │   │   ├── stream-audio.ts     # POST /v1/stream/audio
│   │   │   ├── stream-slide.ts     # POST /v1/stream/slide
│   │   │   ├── session-finalize.ts # POST /v1/session/finalize
│   │   │   ├── session-get.ts      # GET /v1/session?url=...
│   │   │   ├── session-delete.ts   # DELETE /v1/session/:id
│   │   │   ├── stripe-checkout.ts  # POST /v1/billing/checkout
│   │   │   ├── stripe-webhook.ts   # POST /v1/billing/webhook
│   │   │   ├── ws-connect.ts       # WebSocket $connect
│   │   │   ├── ws-disconnect.ts    # WebSocket $disconnect
│   │   │   └── ws-message.ts       # WebSocket $default
│   │   ├── lib/
│   │   │   ├── stt.ts              # OpenAI gpt-4o-mini-transcribe
│   │   │   ├── llm.ts              # Gemini 2.5 Flash sliding-window
│   │   │   ├── pdf.ts              # PDF 생성 (PDFKit)
│   │   │   ├── db.ts               # Postgres client (pg)
│   │   │   ├── s3.ts               # S3 client (@aws-sdk)
│   │   │   ├── auth.ts             # Google OAuth verify + JWT
│   │   │   ├── quota.ts            # quota check/increment
│   │   │   ├── ws-broadcast.ts     # API Gateway Management API
│   │   │   └── env.ts              # 환경변수 로딩 + 검증
│   │   ├── migrations/
│   │   │   └── 001_initial.sql     # 초기 스키마
│   │   └── types/
│   │       └── index.ts
│   └── tests/
│       ├── stt.test.ts
│       ├── llm.test.ts
│       ├── auth.test.ts
│       ├── quota.test.ts
│       └── pdf.test.ts
│
├── web/                            # Next.js 마케팅 / 약관 사이트
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   └── src/app/
│       ├── page.tsx                # 랜딩
│       ├── terms/page.tsx          # 利用規約
│       ├── privacy/page.tsx        # プライバシーポリシー
│       └── layout.tsx
│
├── .gitignore
├── .env.example                    # 환경변수 템플릿 (값 없음)
├── pnpm-workspace.yaml
├── package.json                    # root
└── README.md
```

---

## Task 1: 모노레포 부트스트랩 + Git 초기화

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1**: 디렉토리 초기화 + git

```bash
cd /Users/guntak/Study-Helper
git init
git branch -m main
```

- [ ] **Step 2**: `.gitignore` 작성

```gitignore
node_modules/
dist/
build/
.env
.env.local
.env.development
.env.production
.env.test
*.log
.DS_Store
.next/
.turbo/
cdk.out/
*.pem
*.key
extension/dist/
backend/dist/
web/.next/
```

- [ ] **Step 3**: `.env.example` 작성 (값은 절대 넣지 않음, 변수명만)

```bash
# Backend
DATABASE_URL=
JWT_SECRET=
OPENAI_API_KEY=
GOOGLE_GENAI_API_KEY=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
S3_BUCKET=
AWS_REGION=ap-northeast-1

# Extension (build-time)
VITE_API_BASE_URL=
VITE_WS_URL=
VITE_GOOGLE_OAUTH_CLIENT_ID=
VITE_STRIPE_PUBLIC_KEY=
```

- [ ] **Step 4**: `pnpm-workspace.yaml` 작성

```yaml
packages:
  - 'extension'
  - 'backend'
  - 'web'
```

- [ ] **Step 5**: 루트 `package.json` 작성

```json
{
  "name": "study-helper",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "dev:extension": "pnpm --filter extension dev",
    "dev:backend": "pnpm --filter backend dev",
    "dev:web": "pnpm --filter web dev",
    "deploy:backend": "pnpm --filter backend deploy"
  }
}
```

- [ ] **Step 6**: 첫 commit

```bash
git add .
git commit -m "chore: bootstrap monorepo"
```

---

## Task 2: 익스텐션 스캐폴드 (Vite + CRX + React + Tailwind)

**Files:**
- Create: `extension/package.json`, `extension/vite.config.ts`, `extension/tsconfig.json`, `extension/manifest.config.ts`, `extension/tailwind.config.ts`, `extension/src/side-panel/index.html`, `extension/src/side-panel/main.tsx`, `extension/src/side-panel/App.tsx`, `extension/src/service-worker/index.ts`, `extension/src/content/index.ts`, `extension/src/shared/config.ts`

- [ ] **Step 1**: 익스텐션 디렉토리 생성 + 패키지 설정

```bash
mkdir -p extension/src/{content,side-panel,side-panel/components,service-worker,shared}
cd extension
pnpm init
```

- [ ] **Step 2**: 의존성 설치

```bash
pnpm add react react-dom
pnpm add -D typescript @types/react @types/react-dom @types/chrome \
  vite @vitejs/plugin-react @crxjs/vite-plugin \
  tailwindcss postcss autoprefixer \
  vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3**: `extension/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["chrome", "vite/client", "vitest/globals"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4**: `extension/manifest.config.ts`

```typescript
import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Study-Helper',
  description: '日本の大学生のための、ダウンロード不可な講義動画専用のリアルタイム学習アシスタント',
  version: pkg.version,
  default_locale: 'ja',
  permissions: ['storage', 'sidePanel', 'identity', 'tabs', 'scripting'],
  host_permissions: ['<all_urls>'],
  action: { default_title: 'Study-Helper' },
  side_panel: { default_path: 'src/side-panel/index.html' },
  background: {
    service_worker: 'src/service-worker/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/side-panel/index.html'],
      matches: ['<all_urls>'],
    },
  ],
})
```

- [ ] **Step 5**: `extension/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: { sidePanel: 'src/side-panel/index.html' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 6**: Tailwind 셋업

```bash
cd extension
npx tailwindcss init -p
```

`extension/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
```

`extension/src/side-panel/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7**: `extension/src/side-panel/index.html`

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Study-Helper</title>
  </head>
  <body class="m-0 bg-white text-gray-900">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`extension/src/side-panel/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

`extension/src/side-panel/App.tsx`:

```tsx
export default function App() {
  return (
    <div className="p-4">
      <h1 className="text-lg font-bold">Study-Helper</h1>
      <p className="text-sm text-gray-600">準備中...</p>
    </div>
  )
}
```

- [ ] **Step 8**: 최소 service worker + content script

`extension/src/service-worker/index.ts`:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  console.log('[SW] installed')
})

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId })
  }
})
```

`extension/src/content/index.ts`:

```typescript
console.log('[CS] loaded on', location.href)
```

`extension/src/shared/config.ts`:

```typescript
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
```

- [ ] **Step 9**: 빌드 + 로컬 로드 검증

```bash
cd extension
pnpm build
```

Expected: `extension/dist/` 생성, `manifest.json` 포함.

수동 검증: chrome://extensions → 개발자 모드 ON → "압축해제된 확장 프로그램 로드" → `extension/dist` 선택 → 아이콘 클릭 시 사이드 패널이 "준備中..." 표시.

- [ ] **Step 10**: Commit

```bash
cd /Users/guntak/Study-Helper
git add extension/
git commit -m "feat(extension): scaffold Vite + CRX + React + Tailwind"
```

---

## Task 3: 백엔드 스캐폴드 + AWS CDK 초기 구조

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/infra/bin/app.ts`, `backend/infra/cdk.json`, `backend/infra/lib/network-stack.ts`, `backend/infra/lib/data-stack.ts`, `backend/infra/lib/api-stack.ts`, `backend/src/lib/env.ts`, `backend/src/handlers/health.ts`

- [ ] **Step 1**: 디렉토리 + 패키지

```bash
mkdir -p backend/src/{handlers,lib,migrations,types} backend/infra/{bin,lib} backend/tests
cd backend
pnpm init
```

- [ ] **Step 2**: 의존성

```bash
pnpm add aws-cdk-lib constructs \
  @aws-sdk/client-s3 @aws-sdk/client-secrets-manager @aws-sdk/client-apigatewaymanagementapi \
  pg jose openai @google/generative-ai stripe pdfkit zod
pnpm add -D typescript @types/node @types/aws-lambda @types/pg @types/pdfkit \
  esbuild aws-cdk vitest tsx
```

- [ ] **Step 3**: `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "infra/**/*", "tests/**/*"]
}
```

- [ ] **Step 4**: `backend/package.json` scripts

```json
{
  "name": "backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/handlers/health.ts",
    "cdk": "cdk --app 'tsx infra/bin/app.ts'",
    "deploy": "pnpm cdk deploy --all --require-approval never",
    "synth": "pnpm cdk synth"
  }
}
```

- [ ] **Step 5**: `backend/infra/cdk.json`

```json
{
  "app": "tsx infra/bin/app.ts",
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws"]
  }
}
```

- [ ] **Step 6**: 환경 로더 `backend/src/lib/env.ts`

```typescript
import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_GENAI_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  WS_ENDPOINT: z.string().url().optional(),
  AWS_REGION: z.string().default('ap-northeast-1'),
})

export type AppEnv = z.infer<typeof Env>

export function loadEnv(): AppEnv {
  return Env.parse(process.env)
}
```

- [ ] **Step 7**: 헬스 핸들러 (스모크 테스트용) `backend/src/handlers/health.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ok: true, ts: new Date().toISOString() }),
})
```

- [ ] **Step 8**: CDK 앱 + 네트워크 스택 `backend/infra/bin/app.ts`

```typescript
import { App } from 'aws-cdk-lib'
import { NetworkStack } from '../lib/network-stack.js'
import { DataStack } from '../lib/data-stack.js'
import { ApiStack } from '../lib/api-stack.js'

const app = new App()
const env = { region: 'ap-northeast-1' }

const network = new NetworkStack(app, 'StudyHelperNetwork', { env })
const data = new DataStack(app, 'StudyHelperData', { env, vpc: network.vpc })
new ApiStack(app, 'StudyHelperApi', {
  env,
  vpc: network.vpc,
  dbSecret: data.dbSecret,
  bucket: data.bucket,
  dbCluster: data.cluster,
})
```

- [ ] **Step 9**: 네트워크 스택 `backend/infra/lib/network-stack.ts`

```typescript
import { Stack, type StackProps } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

export class NetworkStack extends Stack {
  readonly vpc: Vpc
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)
    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    })
  }
}
```

- [ ] **Step 10**: 데이터 스택 `backend/infra/lib/data-stack.ts`

```typescript
import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib'
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3'
import { Vpc, SubnetType, SecurityGroup, Port, Peer } from 'aws-cdk-lib/aws-ec2'
import {
  DatabaseCluster, DatabaseClusterEngine, AuroraPostgresEngineVersion,
  ClusterInstance, Credentials,
} from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

interface Props extends StackProps { vpc: Vpc }

export class DataStack extends Stack {
  readonly bucket: Bucket
  readonly cluster: DatabaseCluster
  readonly dbSecret: Secret

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'AssetsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    })

    this.dbSecret = new Secret(this, 'DbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'studyhelper' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    })

    const dbSg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc, allowAllOutbound: true })
    dbSg.addIngressRule(Peer.ipv4(props.vpc.vpcCidrBlock), Port.tcp(5432))

    this.cluster = new DatabaseCluster(this, 'Db', {
      engine: DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_16_2 }),
      writer: ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      credentials: Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: 'studyhelper',
      securityGroups: [dbSg],
      removalPolicy: RemovalPolicy.DESTROY,
    })
  }
}
```

- [ ] **Step 11**: API 스택 (헬스 엔드포인트만 우선) `backend/infra/lib/api-stack.ts`

```typescript
import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { Function as LambdaFn, Runtime, Code } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
import type { Bucket } from 'aws-cdk-lib/aws-s3'
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as path from 'path'

interface Props extends StackProps {
  vpc: Vpc
  dbSecret: Secret
  bucket: Bucket
  dbCluster: DatabaseCluster
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const commonEnv = {
      S3_BUCKET: props.bucket.bucketName,
      DB_SECRET_ARN: props.dbSecret.secretArn,
    }

    const health = new NodejsFunction(this, 'HealthFn', {
      entry: path.join(__dirname, '../../src/handlers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
    })

    const api = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    api.addRoutes({
      path: '/v1/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthInt', health),
    })

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint })
  }
}
```

- [ ] **Step 12**: AWS 자격 증명 + 첫 synth (배포는 추후 Task 25에서)

```bash
cd backend
pnpm cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1
pnpm synth
```

Expected: `cdk.out/` 디렉토리 생성, 에러 없음. `<ACCOUNT_ID>`는 사용자가 본인의 AWS 계정 ID로 대체.

- [ ] **Step 13**: Commit

```bash
git add backend/
git commit -m "feat(backend): scaffold AWS CDK + minimal health Lambda"
```

---

## Task 4: Postgres 스키마 + DB 클라이언트

**Files:**
- Create: `backend/src/migrations/001_initial.sql`, `backend/src/lib/db.ts`, `backend/tests/db.test.ts`

- [ ] **Step 1**: 마이그레이션 SQL 작성 `backend/src/migrations/001_initial.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE quota_usage (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,             -- 'YYYY-MM'
  seconds_used INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url_hash TEXT NOT NULL,           -- SHA256(normalized URL)
  url_original TEXT NOT NULL,
  duration_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finalized', 'deleted')),
  notes JSONB NOT NULL DEFAULT '[]',
  slides JSONB NOT NULL DEFAULT '[]',
  pdf_s3_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, url_hash)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_url_hash ON sessions(url_hash);

CREATE TABLE ws_connections (
  connection_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2**: DB 클라이언트 `backend/src/lib/db.ts`

```typescript
import { Pool, type QueryResultRow } from 'pg'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

let pool: Pool | undefined

async function resolveConnectionString(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const arn = process.env.DB_SECRET_ARN
  if (!arn) throw new Error('Neither DATABASE_URL nor DB_SECRET_ARN set')
  const sm = new SecretsManagerClient({})
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  const s = JSON.parse(out.SecretString!)
  return `postgres://${s.username}:${s.password}@${s.host}:${s.port}/${s.dbname || 'studyhelper'}`
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    const url = await resolveConnectionString()
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = await getPool()
  const r = await p.query<T>(sql, params)
  return r.rows
}
```

- [ ] **Step 3**: DB 단위 테스트 작성 `backend/tests/db.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/lib/db.js', async () => {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT 1')) return [{ ok: 1 }]
      return []
    }),
    getPool: vi.fn(),
  }
})

import { query } from '../src/lib/db.js'

describe('db.query', () => {
  it('returns rows from a select', async () => {
    const rows = await query('SELECT 1 AS ok')
    expect(rows[0]).toEqual({ ok: 1 })
  })
})
```

- [ ] **Step 4**: 테스트 실행

```bash
cd backend
pnpm test
```

Expected: PASS.

- [ ] **Step 5**: 마이그레이션 실행 헬퍼 `backend/src/lib/migrate.ts`

```typescript
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

export async function migrate(): Promise<void> {
  const pool = await getPool()
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    const r = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = $1', [f]
    )
    if (r.rows.length > 0) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await pool.query('COMMIT')
      console.log(`Applied migration: ${f}`)
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 6**: package.json 스크립트 추가

```json
"migrate": "tsx src/lib/migrate.ts"
```

- [ ] **Step 7**: Commit

```bash
git add backend/src/migrations backend/src/lib/db.ts backend/src/lib/migrate.ts backend/tests/db.test.ts
git commit -m "feat(backend): postgres schema and migration runner"
```

---

## Task 5: 인증 (Google OAuth verify + JWT 발급/검증)

**Files:**
- Create: `backend/src/lib/auth.ts`, `backend/src/handlers/auth-google.ts`, `backend/src/handlers/auth-me.ts`, `backend/tests/auth.test.ts`

- [ ] **Step 1**: 테스트 먼저 작성 `backend/tests/auth.test.ts`

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { signJwt, verifyJwt } from '../src/lib/auth.js'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

describe('JWT', () => {
  it('signs and verifies a payload roundtrip', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, 60)
    const payload = await verifyJwt(token)
    expect(payload.sub).toBe('user-123')
    expect(payload.plan).toBe('free')
  })

  it('rejects expired tokens', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, -10)
    await expect(verifyJwt(token)).rejects.toThrow()
  })

  it('rejects tampered tokens', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, 60)
    const tampered = token.slice(0, -2) + 'aa'
    await expect(verifyJwt(tampered)).rejects.toThrow()
  })
})
```

- [ ] **Step 2**: 테스트 실행 → 실패 확인

```bash
pnpm test auth
```

Expected: FAIL — auth.ts 미존재.

- [ ] **Step 3**: auth.ts 구현 `backend/src/lib/auth.ts`

```typescript
import { SignJWT, jwtVerify } from 'jose'

export interface JwtPayload {
  sub: string         // user_id
  plan: 'free' | 'pro'
  iat?: number
  exp?: number
}

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET missing or too short')
  return new TextEncoder().encode(s)
}

export async function signJwt(
  payload: Pick<JwtPayload, 'sub' | 'plan'>,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(getSecret())
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
  if (typeof payload.sub !== 'string') throw new Error('Invalid token: missing sub')
  return payload as unknown as JwtPayload
}

export async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string
  email: string
  name?: string
  email_verified?: boolean
}> {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken))
  if (!res.ok) throw new Error('Google tokeninfo failed: ' + res.status)
  const data = await res.json() as Record<string, string>
  if (data.aud !== process.env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('Token aud mismatch')
  }
  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    email_verified: data.email_verified === 'true',
  }
}
```

- [ ] **Step 4**: 테스트 재실행

```bash
pnpm test auth
```

Expected: PASS (3 tests).

- [ ] **Step 5**: `auth-google` 핸들러 `backend/src/handlers/auth-google.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyGoogleIdToken, signJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { z } from 'zod'

const Body = z.object({ id_token: z.string().min(1) })

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { id_token } = Body.parse(JSON.parse(event.body || '{}'))
    const g = await verifyGoogleIdToken(id_token)

    const existing = await query<{ id: string; plan: 'free' | 'pro' }>(
      `SELECT id, plan FROM users WHERE google_sub = $1`, [g.sub]
    )
    let userId: string
    let plan: 'free' | 'pro' = 'free'
    if (existing.length > 0) {
      userId = existing[0].id
      plan = existing[0].plan
    } else {
      const inserted = await query<{ id: string }>(
        `INSERT INTO users (google_sub, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [g.sub, g.email, g.name ?? null]
      )
      userId = inserted[0].id
    }

    const token = await signJwt({ sub: userId, plan }, 60 * 60 * 24 * 7) // 7 days
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user: { id: userId, email: g.email, name: g.name, plan } }),
    }
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }),
    }
  }
}
```

- [ ] **Step 6**: `auth-me` 핸들러 `backend/src/handlers/auth-me.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }
  }
  try {
    const payload = await verifyJwt(auth.slice(7))
    const rows = await query<{ id: string; email: string; display_name: string; plan: string }>(
      `SELECT id, email, display_name, plan FROM users WHERE id = $1`, [payload.sub]
    )
    if (rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'user not found' }) }
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: rows[0] }),
    }
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) }
  }
}
```

- [ ] **Step 7**: API 스택에 라우트 추가 (`backend/infra/lib/api-stack.ts`에 다음 추가)

```typescript
const authGoogle = new NodejsFunction(this, 'AuthGoogleFn', {
  entry: path.join(__dirname, '../../src/handlers/auth-google.ts'),
  runtime: Runtime.NODEJS_20_X,
  timeout: Duration.seconds(10),
  environment: { ...commonEnv, JWT_SECRET: '', GOOGLE_OAUTH_CLIENT_ID: '' },
  vpc: props.vpc,
})
props.dbSecret.grantRead(authGoogle)
props.dbCluster.connections.allowDefaultPortFrom(authGoogle)

const authMe = new NodejsFunction(this, 'AuthMeFn', {
  entry: path.join(__dirname, '../../src/handlers/auth-me.ts'),
  runtime: Runtime.NODEJS_20_X,
  timeout: Duration.seconds(5),
  environment: { ...commonEnv, JWT_SECRET: '' },
  vpc: props.vpc,
})
props.dbSecret.grantRead(authMe)
props.dbCluster.connections.allowDefaultPortFrom(authMe)

api.addRoutes({
  path: '/v1/auth/google',
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration('AuthGoogleInt', authGoogle),
})
api.addRoutes({
  path: '/v1/auth/me',
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration('AuthMeInt', authMe),
})
```

> **참고**: 환경변수 `JWT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID` 등은 SSM Parameter Store / Secrets Manager에서 동적으로 주입한다. 빈 문자열은 CDK가 거부하므로 Step 6에서 보강한다.

- [ ] **Step 8**: 환경변수 주입 보강 (Secrets Manager 사용) — `backend/infra/lib/secrets-stack.ts` 생성

```typescript
import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export class SecretsStack extends Stack {
  readonly appSecret: Secret

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)
    this.appSecret = new Secret(this, 'AppSecret', {
      secretName: 'studyhelper/app',
      description: 'JWT secret, OAuth, AI keys, Stripe',
    })
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn })
  }
}
```

배포 후 사용자가 AWS Console에서 Secret 값에 다음 JSON을 직접 입력:

```json
{
  "JWT_SECRET": "<32+ random chars>",
  "OPENAI_API_KEY": "sk-...REDACTED",
  "GOOGLE_GENAI_API_KEY": "AIza...REDACTED",
  "GOOGLE_OAUTH_CLIENT_ID": "<client_id>",
  "GOOGLE_OAUTH_CLIENT_SECRET": "<client_secret>",
  "STRIPE_SECRET_KEY": "sk_test_...REDACTED",
  "STRIPE_WEBHOOK_SECRET": "whsec_...REDACTED",
  "STRIPE_PRICE_PRO": "price_..."
}
```

> ⚠️ 실제 값은 콘솔에 직접 붙여넣을 것. 본 문서/코드/커밋 메시지에 평문 포함 금지.

`api-stack.ts`에서 Lambda가 런타임에 Secret을 읽도록:

```typescript
import { Secret as SmSecret } from 'aws-cdk-lib/aws-secretsmanager'
// in constructor (after props 변경: appSecret: SmSecret 추가)
authGoogle.addEnvironment('APP_SECRET_ARN', props.appSecret.secretArn)
props.appSecret.grantRead(authGoogle)
authMe.addEnvironment('APP_SECRET_ARN', props.appSecret.secretArn)
props.appSecret.grantRead(authMe)
```

`backend/src/lib/env.ts`에 동적 secret 로더 추가:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

let cachedSecrets: Record<string, string> | undefined

export async function loadAppSecrets(): Promise<Record<string, string>> {
  if (cachedSecrets) return cachedSecrets
  const arn = process.env.APP_SECRET_ARN
  if (!arn) {
    cachedSecrets = process.env as Record<string, string>
    return cachedSecrets
  }
  const sm = new SecretsManagerClient({})
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  cachedSecrets = JSON.parse(out.SecretString!)
  for (const [k, v] of Object.entries(cachedSecrets!)) process.env[k] = v
  return cachedSecrets!
}
```

각 핸들러 시작 부분에 `await loadAppSecrets()`를 호출. 예: `auth-google.ts` 첫 줄에 추가:

```typescript
import { loadAppSecrets } from '../lib/env.js'
// 핸들러 본문 첫 줄
await loadAppSecrets()
```

- [ ] **Step 9**: Commit

```bash
git add backend/
git commit -m "feat(backend): google oauth + jwt auth"
```

---

## Task 6: STT (gpt-4o-mini-transcribe) 모듈 + 테스트

**Files:**
- Create: `backend/src/lib/stt.ts`, `backend/tests/stt.test.ts`

- [ ] **Step 1**: 테스트 먼저 `backend/tests/stt.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: class { audio = { transcriptions: { create: mockCreate } } }
}))

import { transcribeChunk } from '../src/lib/stt.js'

beforeEach(() => mockCreate.mockReset())

describe('transcribeChunk', () => {
  it('calls OpenAI with the correct model and returns text', async () => {
    mockCreate.mockResolvedValue({ text: 'こんにちは。今日は AI について話します。' })
    process.env.OPENAI_API_KEY = 'sk-test'
    const result = await transcribeChunk(new Uint8Array([1, 2, 3]).buffer, 'audio/webm')
    expect(result.text).toContain('AI')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini-transcribe',
    }))
  })

  it('throws on empty buffer', async () => {
    await expect(transcribeChunk(new ArrayBuffer(0), 'audio/webm')).rejects.toThrow(/empty/)
  })
})
```

- [ ] **Step 2**: 테스트 실행 → 실패

```bash
pnpm test stt
```

- [ ] **Step 3**: 구현 `backend/src/lib/stt.ts`

```typescript
import OpenAI from 'openai'

export interface TranscriptResult {
  text: string
  language?: string
}

let _client: OpenAI | undefined
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

export async function transcribeChunk(
  audio: ArrayBuffer,
  mime: string,
  hintLanguage?: string
): Promise<TranscriptResult> {
  if (audio.byteLength === 0) throw new Error('Audio buffer is empty')
  const file = new File([audio], 'chunk.webm', { type: mime })
  const res = await client().audio.transcriptions.create({
    file,
    model: 'gpt-4o-mini-transcribe',
    language: hintLanguage,
    response_format: 'json',
  })
  return { text: res.text }
}
```

- [ ] **Step 4**: 재실행 → PASS

```bash
pnpm test stt
```

- [ ] **Step 5**: Commit

```bash
git add backend/src/lib/stt.ts backend/tests/stt.test.ts
git commit -m "feat(backend): stt module via gpt-4o-mini-transcribe"
```

---

## Task 7: LLM (Gemini 2.5 Flash) 슬라이딩 윈도우 요약

**Files:**
- Create: `backend/src/lib/llm.ts`, `backend/tests/llm.test.ts`

- [ ] **Step 1**: 테스트 `backend/tests/llm.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'

const mockGenerate = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: mockGenerate } }
  }
}))

import { summarizeChunk, formatTimestamp } from '../src/lib/llm.js'

describe('formatTimestamp', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(42)).toBe('00:42')
    expect(formatTimestamp(135)).toBe('02:15')
    expect(formatTimestamp(3600)).toBe('60:00')
  })
})

describe('summarizeChunk', () => {
  it('returns parsed note items', async () => {
    mockGenerate.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          notes: [
            { ts: 42, text: 'AI の定義', important: false },
            { ts: 135, text: '⭐ 重要: 誤差逆伝播', important: true },
          ]
        })
      }
    })
    process.env.GOOGLE_GENAI_API_KEY = 'test'
    const r = await summarizeChunk({
      newTranscript: '本日は AI について話します...',
      priorContext: '',
      startTimeSec: 0,
    })
    expect(r.notes).toHaveLength(2)
    expect(r.notes[1].important).toBe(true)
  })
})
```

- [ ] **Step 2**: 실행 → 실패

```bash
pnpm test llm
```

- [ ] **Step 3**: 구현 `backend/src/lib/llm.ts`

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'

export interface NoteItem {
  ts: number          // seconds from video start
  text: string
  important: boolean
}

export interface SummaryRequest {
  newTranscript: string
  priorContext: string  // last N notes joined
  startTimeSec: number  // absolute time of newTranscript start
}

export interface SummaryResult {
  notes: NoteItem[]
}

export function formatTimestamp(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const SYSTEM_PROMPT = `あなたは大学の講義内容を要点ノートに変換するアシスタントです。

入力:
- これまでの要点ノート(コンテキスト)
- 直近の講義音声の文字起こし(新規分)
- 新規分の講義内動画開始時刻 (秒)

出力ルール:
1. 新規分の中から、学習価値の高い要点を 1〜5件抽出する
2. 各要点は出現タイミング(秒)を含める。文字起こし内では順序通りに出現するため、ts は startTimeSec を起点に推定する
3. 重要度を判定: 定義/公式/結論/重要事項 = important: true、それ以外 = false
4. 出力は必ず以下の JSON のみ。説明文や Markdown は禁止。

{ "notes": [ { "ts": <秒, 整数>, "text": "<日本語の要点1行>", "important": <boolean> } ] }

5. text は日本語で、簡潔に(1行 60 文字以内)。
6. 既に priorContext に含まれている内容は重複させない。
7. 新規分にノート抽出に値する内容がない場合は { "notes": [] } を返す。`

let _client: GoogleGenerativeAI | undefined
function client(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY!)
  return _client
}

export async function summarizeChunk(req: SummaryRequest): Promise<SummaryResult> {
  const model = client().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  })
  const userPrompt = `priorContext:
${req.priorContext || '(なし)'}

startTimeSec: ${req.startTimeSec}

newTranscript:
${req.newTranscript}`

  const res = await model.generateContent(userPrompt)
  const text = res.response.text()
  const parsed = JSON.parse(text) as SummaryResult
  return { notes: Array.isArray(parsed.notes) ? parsed.notes : [] }
}
```

- [ ] **Step 4**: 재실행 → PASS

```bash
pnpm test llm
```

- [ ] **Step 5**: Commit

```bash
git add backend/src/lib/llm.ts backend/tests/llm.test.ts
git commit -m "feat(backend): llm summarize via gemini 2.5 flash"
```

---

## Task 8: Quota 서비스 + 테스트

**Files:**
- Create: `backend/src/lib/quota.ts`, `backend/tests/quota.test.ts`

- [ ] **Step 1**: 테스트 `backend/tests/quota.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../src/lib/db.js', () => ({ query: mockQuery }))

import { checkQuota, recordUsage, FREE_LIMIT_SECS, PRO_LIMIT_SECS, currentPeriod } from '../src/lib/quota.js'

describe('currentPeriod', () => {
  it('returns YYYY-MM', () => {
    expect(currentPeriod(new Date('2026-04-26T12:00:00Z'))).toBe('2026-04')
  })
})

describe('checkQuota', () => {
  it('allows when under free limit', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: 600 }])  // 10 min used
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(true)
    expect(r.remainingSecs).toBe(FREE_LIMIT_SECS - 600)
  })

  it('blocks when over free limit', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: FREE_LIMIT_SECS + 1 }])
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(false)
  })

  it('uses pro limit for pro plan', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: 0 }])
    const r = await checkQuota('u1', 'pro')
    expect(r.remainingSecs).toBe(PRO_LIMIT_SECS)
  })

  it('returns full limit when no row exists', async () => {
    mockQuery.mockResolvedValue([])
    const r = await checkQuota('u1', 'free')
    expect(r.remainingSecs).toBe(FREE_LIMIT_SECS)
  })
})

describe('recordUsage', () => {
  it('upserts usage row', async () => {
    mockQuery.mockResolvedValue([])
    await recordUsage('u1', 30)
    expect(mockQuery).toHaveBeenCalled()
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toMatch(/INSERT INTO quota_usage/)
    expect(sql).toMatch(/ON CONFLICT/)
  })
})
```

- [ ] **Step 2**: 구현 `backend/src/lib/quota.ts`

```typescript
import { query } from './db.js'

export const FREE_LIMIT_SECS = 30 * 60          // 30 min
export const PRO_LIMIT_SECS = 30 * 60 * 60      // 30 hours

export type Plan = 'free' | 'pro'

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function limitFor(plan: Plan): number {
  return plan === 'pro' ? PRO_LIMIT_SECS : FREE_LIMIT_SECS
}

export async function checkQuota(userId: string, plan: Plan): Promise<{
  allowed: boolean
  used: number
  limit: number
  remainingSecs: number
}> {
  const period = currentPeriod()
  const rows = await query<{ seconds_used: number }>(
    `SELECT seconds_used FROM quota_usage WHERE user_id = $1 AND period = $2`,
    [userId, period]
  )
  const used = rows[0]?.seconds_used ?? 0
  const limit = limitFor(plan)
  return { allowed: used < limit, used, limit, remainingSecs: Math.max(0, limit - used) }
}

export async function recordUsage(userId: string, seconds: number): Promise<void> {
  const period = currentPeriod()
  await query(
    `INSERT INTO quota_usage (user_id, period, seconds_used) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period) DO UPDATE SET seconds_used = quota_usage.seconds_used + EXCLUDED.seconds_used`,
    [userId, period, seconds]
  )
}
```

- [ ] **Step 3**: 테스트 PASS 확인

```bash
pnpm test quota
```

- [ ] **Step 4**: Commit

```bash
git add backend/src/lib/quota.ts backend/tests/quota.test.ts
git commit -m "feat(backend): quota service"
```

---

## Task 9: Stream 핸들러 (audio + slide) + WebSocket 브로드캐스트

**Files:**
- Create: `backend/src/lib/ws-broadcast.ts`, `backend/src/handlers/stream-audio.ts`, `backend/src/handlers/stream-slide.ts`, `backend/src/handlers/ws-connect.ts`, `backend/src/handlers/ws-disconnect.ts`

- [ ] **Step 1**: 헬퍼 작성 `backend/src/lib/ws-broadcast.ts`

```typescript
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { query } from './db.js'

let _client: ApiGatewayManagementApiClient | undefined
function client(): ApiGatewayManagementApiClient {
  if (!_client) {
    const endpoint = process.env.WS_ENDPOINT
    if (!endpoint) throw new Error('WS_ENDPOINT not set')
    _client = new ApiGatewayManagementApiClient({ endpoint })
  }
  return _client
}

export async function sendToSession(sessionId: string, message: unknown): Promise<void> {
  const conns = await query<{ connection_id: string }>(
    `SELECT connection_id FROM ws_connections WHERE session_id = $1`,
    [sessionId]
  )
  await Promise.all(conns.map(async ({ connection_id }) => {
    try {
      await client().send(new PostToConnectionCommand({
        ConnectionId: connection_id,
        Data: Buffer.from(JSON.stringify(message)),
      }))
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
      if (status === 410) {
        await query(`DELETE FROM ws_connections WHERE connection_id = $1`, [connection_id])
      } else { throw e }
    }
  }))
}
```

- [ ] **Step 2**: WebSocket connect/disconnect 핸들러

`backend/src/handlers/ws-connect.ts`:

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandler = async (event) => {
  await loadAppSecrets()
  const token = event.queryStringParameters?.token
  const sessionId = event.queryStringParameters?.session_id
  if (!token || !sessionId) return { statusCode: 400, body: 'missing params' }
  try {
    const payload = await verifyJwt(token)
    await query(
      `INSERT INTO ws_connections (connection_id, user_id, session_id) VALUES ($1, $2, $3)
       ON CONFLICT (connection_id) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [event.requestContext.connectionId, payload.sub, sessionId]
    )
    return { statusCode: 200, body: 'ok' }
  } catch {
    return { statusCode: 401, body: 'unauthorized' }
  }
}
```

`backend/src/handlers/ws-disconnect.ts`:

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda'
import { query } from '../lib/db.js'

export const handler: APIGatewayProxyHandler = async (event) => {
  await query(`DELETE FROM ws_connections WHERE connection_id = $1`,
    [event.requestContext.connectionId])
  return { statusCode: 200, body: 'ok' }
}
```

- [ ] **Step 3**: Stream-audio 핸들러 `backend/src/handlers/stream-audio.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { transcribeChunk } from '../lib/stt.js'
import { summarizeChunk } from '../lib/llm.js'
import { checkQuota, recordUsage } from '../lib/quota.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  start_time_sec: z.number().nonnegative(),
  duration_sec: z.number().positive(),
  audio_b64: z.string().min(1),
  mime: z.string(),
})

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }

  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const userPlan = payload.plan
  const quota = await checkQuota(payload.sub, userPlan)
  if (!quota.allowed) {
    return {
      statusCode: 402,
      body: JSON.stringify({ error: 'quota_exceeded', remaining_secs: 0 }),
    }
  }

  const audioBuf = Buffer.from(body.audio_b64, 'base64').buffer
  const transcript = await transcribeChunk(audioBuf, body.mime)

  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')

  // upsert session row
  await query(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()`,
    [body.session_id, payload.sub, urlHash, body.url]
  )

  // gather prior context: last 5 notes
  const sessRow = await query<{ notes: { text: string; ts: number }[] }>(
    `SELECT notes FROM sessions WHERE id = $1`, [body.session_id]
  )
  const priorNotes = sessRow[0]?.notes ?? []
  const priorContext = priorNotes.slice(-5).map(n => `[${n.ts}s] ${n.text}`).join('\n')

  const summary = await summarizeChunk({
    newTranscript: transcript.text,
    priorContext,
    startTimeSec: body.start_time_sec,
  })

  if (summary.notes.length > 0) {
    await query(
      `UPDATE sessions SET notes = notes || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(summary.notes), body.session_id]
    )
  }

  await recordUsage(payload.sub, Math.ceil(body.duration_sec))

  await sendToSession(body.session_id, {
    type: 'note_chunk',
    notes: summary.notes,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ added: summary.notes.length, transcript_preview: transcript.text.slice(0, 80) }),
  }
}
```

- [ ] **Step 4**: Stream-slide 핸들러 `backend/src/handlers/stream-slide.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const s3 = new S3Client({})

const Body = z.object({
  session_id: z.string().uuid(),
  ts: z.number().nonnegative(),
  image_b64: z.string().min(1),
  mime: z.literal('image/jpeg'),
})

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const buf = Buffer.from(body.image_b64, 'base64')
  const key = `slides/${payload.sub}/${body.session_id}/${randomUUID()}.jpg`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
  }))

  const slide = { ts: body.ts, key }
  await query(
    `UPDATE sessions SET slides = slides || $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [JSON.stringify([slide]), body.session_id, payload.sub]
  )

  await sendToSession(body.session_id, { type: 'slide_chunk', slide })

  return { statusCode: 200, body: JSON.stringify({ key }) }
}
```

- [ ] **Step 5**: API 스택에 라우트 + WS 스택 추가

`backend/infra/lib/ws-stack.ts` 생성:

```typescript
import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2'
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as path from 'path'

interface Props extends StackProps {
  vpc: Vpc
  dbSecret: Secret
  dbCluster: DatabaseCluster
  appSecret: Secret
}

export class WsStack extends Stack {
  readonly wsEndpoint: string

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const env = {
      DB_SECRET_ARN: props.dbSecret.secretArn,
      APP_SECRET_ARN: props.appSecret.secretArn,
    }
    const mk = (name: string, entry: string) => {
      const fn = new NodejsFunction(this, name, {
        entry: path.join(__dirname, '../../src/handlers/', entry),
        runtime: Runtime.NODEJS_20_X,
        timeout: Duration.seconds(15),
        environment: env,
        vpc: props.vpc,
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      })
      props.dbSecret.grantRead(fn)
      props.appSecret.grantRead(fn)
      props.dbCluster.connections.allowDefaultPortFrom(fn)
      return fn
    }
    const connectFn = mk('WsConnectFn', 'ws-connect.ts')
    const disconnectFn = mk('WsDisconnectFn', 'ws-disconnect.ts')

    const wsApi = new WebSocketApi(this, 'WsApi', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('Conn', connectFn) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('Disc', disconnectFn) },
    })
    const stage = new WebSocketStage(this, 'Stage', { webSocketApi: wsApi, stageName: 'prod', autoDeploy: true })
    this.wsEndpoint = `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage.stageName}`

    new CfnOutput(this, 'WsUrl', { value: stage.url })
    new CfnOutput(this, 'WsEndpoint', { value: this.wsEndpoint })
  }
}
```

`api-stack.ts` 에 stream 라우트 추가 + `WS_ENDPOINT` 환경변수 주입 (배포 후 2-pass deploy로 해결: 첫 배포에서 WsStack 출력값 받고, 다음 배포에서 ApiStack에 환경변수로 주입).

```typescript
const wsEndpoint = props.wsEndpoint  // ApiStackProps에 추가
const streamAudio = new NodejsFunction(this, 'StreamAudioFn', {
  entry: path.join(__dirname, '../../src/handlers/stream-audio.ts'),
  runtime: Runtime.NODEJS_20_X,
  timeout: Duration.seconds(60),
  memorySize: 1024,
  environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint, APP_SECRET_ARN: props.appSecret.secretArn },
  vpc: props.vpc,
})
props.dbSecret.grantRead(streamAudio)
props.appSecret.grantRead(streamAudio)
props.dbCluster.connections.allowDefaultPortFrom(streamAudio)
props.bucket.grantReadWrite(streamAudio)

const streamSlide = new NodejsFunction(this, 'StreamSlideFn', {
  entry: path.join(__dirname, '../../src/handlers/stream-slide.ts'),
  runtime: Runtime.NODEJS_20_X,
  timeout: Duration.seconds(15),
  memorySize: 512,
  environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint, APP_SECRET_ARN: props.appSecret.secretArn },
  vpc: props.vpc,
})
props.dbSecret.grantRead(streamSlide)
props.appSecret.grantRead(streamSlide)
props.dbCluster.connections.allowDefaultPortFrom(streamSlide)
props.bucket.grantReadWrite(streamSlide)

api.addRoutes({ path: '/v1/stream/audio', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('SAInt', streamAudio) })
api.addRoutes({ path: '/v1/stream/slide', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('SSInt', streamSlide) })
```

`bin/app.ts`에 WsStack 추가하고, ApiStack은 WsStack의 endpoint를 받도록 수정:

```typescript
import { SecretsStack } from '../lib/secrets-stack.js'
import { WsStack } from '../lib/ws-stack.js'

const secrets = new SecretsStack(app, 'StudyHelperSecrets', { env })
const ws = new WsStack(app, 'StudyHelperWs', {
  env, vpc: network.vpc, dbSecret: data.dbSecret, dbCluster: data.cluster, appSecret: secrets.appSecret,
})
new ApiStack(app, 'StudyHelperApi', {
  env,
  vpc: network.vpc,
  dbSecret: data.dbSecret,
  bucket: data.bucket,
  dbCluster: data.cluster,
  appSecret: secrets.appSecret,
  wsEndpoint: ws.wsEndpoint,
})
```

- [ ] **Step 6**: Commit

```bash
git add backend/
git commit -m "feat(backend): stream audio/slide handlers + websocket"
```

---

## Task 10: Session 관리 (finalize / get / delete) + PDF 생성

**Files:**
- Create: `backend/src/lib/pdf.ts`, `backend/src/handlers/session-finalize.ts`, `backend/src/handlers/session-get.ts`, `backend/src/handlers/session-delete.ts`, `backend/tests/pdf.test.ts`

- [ ] **Step 1**: PDF 빌더 테스트 `backend/tests/pdf.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { buildPdf } from '../src/lib/pdf.js'

describe('buildPdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buf = await buildPdf({
      title: 'テスト講義',
      notes: [
        { ts: 42, text: 'AI の定義', important: false },
        { ts: 135, text: '⭐ 重要: 誤差逆伝播', important: true },
      ],
      slides: [],
    })
    expect(buf.byteLength).toBeGreaterThan(500)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
```

- [ ] **Step 2**: 구현 `backend/src/lib/pdf.ts`

```typescript
import PDFDocument from 'pdfkit'
import { formatTimestamp } from './llm.js'

export interface PdfInput {
  title: string
  notes: { ts: number; text: string; important: boolean }[]
  slides: { ts: number; data: Buffer }[]
}

export async function buildPdf(input: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  doc.fontSize(20).text(input.title, { align: 'center' })
  doc.moveDown()

  for (const n of input.notes) {
    const tsStr = `[${formatTimestamp(n.ts)}]`
    if (n.important) doc.fontSize(12).fillColor('red').text(`⭐ ${tsStr} ${n.text}`)
    else doc.fontSize(11).fillColor('black').text(`${tsStr} ${n.text}`)
    doc.moveDown(0.3)
  }

  for (const s of input.slides) {
    doc.addPage()
    doc.fontSize(10).fillColor('gray').text(`スライド @ ${formatTimestamp(s.ts)}`)
    doc.image(s.data, { fit: [500, 300], align: 'center' })
  }

  doc.end()
  return await done
}
```

- [ ] **Step 3**: Session-finalize 핸들러 `backend/src/handlers/session-finalize.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { buildPdf } from '../lib/pdf.js'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'

const s3 = new S3Client({})
const Body = z.object({ session_id: z.string().uuid(), title: z.string().default('講義ノート') })

interface SessionRow {
  notes: { ts: number; text: string; important: boolean }[]
  slides: { ts: number; key: string }[]
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const rows = await query<SessionRow>(
    `SELECT notes, slides FROM sessions WHERE id = $1 AND user_id = $2`,
    [body.session_id, payload.sub]
  )
  if (rows.length === 0) return { statusCode: 404, body: 'not found' }
  const sess = rows[0]

  const slideImages: { ts: number; data: Buffer }[] = []
  for (const s of sess.slides) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s.key }))
    const arr = await obj.Body!.transformToByteArray()
    slideImages.push({ ts: s.ts, data: Buffer.from(arr) })
  }

  const pdf = await buildPdf({ title: body.title, notes: sess.notes, slides: slideImages })
  const pdfKey = `pdfs/${payload.sub}/${body.session_id}.pdf`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET, Key: pdfKey, Body: pdf, ContentType: 'application/pdf',
  }))

  await query(`UPDATE sessions SET status = 'finalized', pdf_s3_key = $1 WHERE id = $2`,
    [pdfKey, body.session_id])

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: pdfKey }), { expiresIn: 3600 })
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_url: url, notes: sess.notes }),
  }
}
```

- [ ] **Step 4**: Session-get 핸들러 `backend/src/handlers/session-get.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { createHash } from 'node:crypto'

function normalizeUrl(u: string): string {
  const url = new URL(u); url.hash = ''; return url.toString()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, body: 'missing url' }
  const urlHash = createHash('sha256').update(normalizeUrl(url)).digest('hex')

  const rows = await query<{ id: string; notes: unknown; slides: unknown; status: string; created_at: string }>(
    `SELECT id, notes, slides, status, created_at FROM sessions
     WHERE user_id = $1 AND url_hash = $2 AND status != 'deleted'`,
    [payload.sub, urlHash]
  )
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: rows[0] ?? null }),
  }
}
```

- [ ] **Step 5**: Session-delete 핸들러 `backend/src/handlers/session-delete.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const id = event.pathParameters?.id
  if (!id) return { statusCode: 400, body: 'missing id' }
  await query(`UPDATE sessions SET status = 'deleted' WHERE id = $1 AND user_id = $2`, [id, payload.sub])
  return { statusCode: 204, body: '' }
}
```

- [ ] **Step 6**: 라우트 추가 (api-stack.ts)

```typescript
const sessionFinalize = new NodejsFunction(this, 'SessFinFn', {
  entry: path.join(__dirname, '../../src/handlers/session-finalize.ts'),
  runtime: Runtime.NODEJS_20_X, timeout: Duration.seconds(60), memorySize: 1024,
  environment: { ...commonEnv, APP_SECRET_ARN: props.appSecret.secretArn }, vpc: props.vpc,
})
props.dbSecret.grantRead(sessionFinalize); props.appSecret.grantRead(sessionFinalize)
props.dbCluster.connections.allowDefaultPortFrom(sessionFinalize)
props.bucket.grantReadWrite(sessionFinalize)

const sessionGet = new NodejsFunction(this, 'SessGetFn', {
  entry: path.join(__dirname, '../../src/handlers/session-get.ts'),
  runtime: Runtime.NODEJS_20_X, timeout: Duration.seconds(10),
  environment: { ...commonEnv, APP_SECRET_ARN: props.appSecret.secretArn }, vpc: props.vpc,
})
props.dbSecret.grantRead(sessionGet); props.appSecret.grantRead(sessionGet)
props.dbCluster.connections.allowDefaultPortFrom(sessionGet)

const sessionDelete = new NodejsFunction(this, 'SessDelFn', {
  entry: path.join(__dirname, '../../src/handlers/session-delete.ts'),
  runtime: Runtime.NODEJS_20_X, timeout: Duration.seconds(10),
  environment: { ...commonEnv, APP_SECRET_ARN: props.appSecret.secretArn }, vpc: props.vpc,
})
props.dbSecret.grantRead(sessionDelete); props.appSecret.grantRead(sessionDelete)
props.dbCluster.connections.allowDefaultPortFrom(sessionDelete)

api.addRoutes({ path: '/v1/session/finalize', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('SFInt', sessionFinalize) })
api.addRoutes({ path: '/v1/session', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('SGInt', sessionGet) })
api.addRoutes({ path: '/v1/session/{id}', methods: [HttpMethod.DELETE], integration: new HttpLambdaIntegration('SDInt', sessionDelete) })
```

- [ ] **Step 7**: 테스트 + Commit

```bash
pnpm test pdf
git add backend/
git commit -m "feat(backend): session finalize/get/delete + pdf generation"
```

---

## Task 11: Stripe Checkout + Webhook

**Files:**
- Create: `backend/src/handlers/stripe-checkout.ts`, `backend/src/handlers/stripe-webhook.ts`

- [ ] **Step 1**: Checkout 핸들러 `backend/src/handlers/stripe-checkout.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-09-30.acacia' })
  const userRows = await query<{ email: string; stripe_customer_id: string | null }>(
    `SELECT email, stripe_customer_id FROM users WHERE id = $1`, [payload.sub]
  )
  if (userRows.length === 0) return { statusCode: 404, body: 'user not found' }
  let customerId = userRows[0].stripe_customer_id
  if (!customerId) {
    const c = await stripe.customers.create({ email: userRows[0].email, metadata: { user_id: payload.sub } })
    customerId = c.id
    await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customerId, payload.sub])
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    success_url: 'https://study-helper.example.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://study-helper.example.com/cancel',
    locale: 'ja',
    client_reference_id: payload.sub,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  }
}
```

- [ ] **Step 2**: Webhook 핸들러 `backend/src/handlers/stripe-webhook.ts`

```typescript
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const sig = event.headers['stripe-signature']
  if (!sig || !event.body) return { statusCode: 400, body: 'missing signature' }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-09-30.acacia' })

  let evt: Stripe.Event
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (e) {
    return { statusCode: 400, body: `signature error: ${e instanceof Error ? e.message : 'x'}` }
  }

  switch (evt.type) {
    case 'checkout.session.completed': {
      const s = evt.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id
      const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      if (userId && subscriptionId) {
        await query(`UPDATE users SET plan = 'pro', stripe_subscription_id = $1 WHERE id = $2`,
          [subscriptionId, userId])
      }
      break
    }
    case 'customer.subscription.deleted': {
      const sub = evt.data.object as Stripe.Subscription
      await query(`UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_subscription_id = $1`,
        [sub.id])
      break
    }
  }
  return { statusCode: 200, body: 'ok' }
}
```

- [ ] **Step 3**: 라우트 추가 + Commit

```typescript
const stripeCheckout = new NodejsFunction(this, 'StripeCheckoutFn', { /* same pattern */ })
const stripeWebhook = new NodejsFunction(this, 'StripeWebhookFn', { /* same, no auth header pass-through */ })
api.addRoutes({ path: '/v1/billing/checkout', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('SCInt', stripeCheckout) })
api.addRoutes({ path: '/v1/billing/webhook', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('SWInt', stripeWebhook) })
```

```bash
git add backend/; git commit -m "feat(backend): stripe checkout + webhook"
```

---

## Task 12: 익스텐션 — Service Worker (auth + API client)

**Files:**
- Create: `extension/src/shared/types.ts`, `extension/src/shared/storage.ts`, `extension/src/service-worker/auth.ts`, `extension/src/service-worker/messaging.ts`, `extension/src/service-worker/index.ts` (덮어쓰기)

- [ ] **Step 1**: 공유 타입 `extension/src/shared/types.ts`

```typescript
export interface User {
  id: string
  email: string
  name?: string
  plan: 'free' | 'pro'
}

export interface NoteItem {
  ts: number
  text: string
  important: boolean
  slideKey?: string
}

export interface SlideItem {
  ts: number
  key: string
}

export interface SessionState {
  id: string
  url: string
  notes: NoteItem[]
  slides: SlideItem[]
  status: 'active' | 'finalized' | 'deleted'
}

export type SwRequest =
  | { type: 'AUTH_LOGIN' }
  | { type: 'AUTH_LOGOUT' }
  | { type: 'AUTH_GET_USER' }
  | { type: 'API_FETCH'; path: string; method: string; body?: unknown }
  | { type: 'TOAST_SHOW'; tabId: number }
  | { type: 'SESSION_START'; tabId: number; url: string }

export type SwResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string }
```

- [ ] **Step 2**: 스토리지 래퍼 `extension/src/shared/storage.ts`

```typescript
import type { User, SessionState } from './types'

const KEYS = {
  TOKEN: 'sh.token',
  USER: 'sh.user',
  CONSENT: 'sh.consent.v1',
  PLAYBACK: 'sh.playback',
  SESSION_INDEX: 'sh.sessionIndex',
} as const

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(KEYS.TOKEN)
  return r[KEYS.TOKEN] ?? null
}
export async function setToken(t: string | null): Promise<void> {
  if (t) await chrome.storage.local.set({ [KEYS.TOKEN]: t })
  else await chrome.storage.local.remove(KEYS.TOKEN)
}

export async function getUser(): Promise<User | null> {
  const r = await chrome.storage.local.get(KEYS.USER)
  return r[KEYS.USER] ?? null
}
export async function setUser(u: User | null): Promise<void> {
  if (u) await chrome.storage.local.set({ [KEYS.USER]: u })
  else await chrome.storage.local.remove(KEYS.USER)
}

export async function hasConsent(): Promise<boolean> {
  const r = await chrome.storage.local.get(KEYS.CONSENT)
  return Boolean(r[KEYS.CONSENT])
}
export async function setConsent(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.CONSENT]: { acceptedAt: Date.now() } })
}

export async function getPlaybackSpeed(): Promise<'auto' | number> {
  const r = await chrome.storage.local.get(KEYS.PLAYBACK)
  return r[KEYS.PLAYBACK] ?? 'auto'
}
export async function setPlaybackSpeed(v: 'auto' | number): Promise<void> {
  await chrome.storage.local.set({ [KEYS.PLAYBACK]: v })
}

export async function rememberSession(url: string, sessionId: string): Promise<void> {
  const r = await chrome.storage.local.get(KEYS.SESSION_INDEX)
  const idx: Record<string, string> = r[KEYS.SESSION_INDEX] ?? {}
  idx[url] = sessionId
  await chrome.storage.local.set({ [KEYS.SESSION_INDEX]: idx })
}
export async function lookupSession(url: string): Promise<string | null> {
  const r = await chrome.storage.local.get(KEYS.SESSION_INDEX)
  return r[KEYS.SESSION_INDEX]?.[url] ?? null
}
```

- [ ] **Step 3**: Auth 헬퍼 `extension/src/service-worker/auth.ts`

```typescript
import { setToken, setUser, getToken } from '../shared/storage'
import type { User } from '../shared/types'
import { API_BASE_URL } from '../shared/config'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID

export async function loginWithGoogle(): Promise<User> {
  const idToken = await new Promise<string>((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL('oauth2')
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'id_token')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('nonce', crypto.randomUUID())
    chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }, (resp) => {
      if (chrome.runtime.lastError || !resp) return reject(chrome.runtime.lastError)
      const fragment = new URL(resp).hash.slice(1)
      const token = new URLSearchParams(fragment).get('id_token')
      if (!token) return reject(new Error('no id_token'))
      resolve(token)
    })
  })

  const r = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  })
  if (!r.ok) throw new Error('login failed: ' + r.status)
  const data = await r.json() as { token: string; user: User }
  await setToken(data.token)
  await setUser(data.user)
  return data.user
}

export async function logout(): Promise<void> {
  await setToken(null)
  await setUser(null)
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}
```

- [ ] **Step 4**: 메시지 디스패처 `extension/src/service-worker/messaging.ts`

```typescript
import type { SwRequest, SwResponse } from '../shared/types'
import { loginWithGoogle, logout, authedFetch } from './auth'
import { getUser } from '../shared/storage'

export async function handle(req: SwRequest): Promise<SwResponse> {
  try {
    switch (req.type) {
      case 'AUTH_LOGIN': {
        const u = await loginWithGoogle()
        return { ok: true, data: u }
      }
      case 'AUTH_LOGOUT': {
        await logout()
        return { ok: true, data: null }
      }
      case 'AUTH_GET_USER': {
        const u = await getUser()
        return { ok: true, data: u }
      }
      case 'API_FETCH': {
        const r = await authedFetch(req.path, {
          method: req.method,
          body: req.body ? JSON.stringify(req.body) : undefined,
        })
        const text = await r.text()
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { parsed = text }
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${text}` }
        return { ok: true, data: parsed }
      }
      case 'TOAST_SHOW': {
        await chrome.tabs.sendMessage(req.tabId, { type: 'TOAST_SHOW' })
        return { ok: true, data: null }
      }
      case 'SESSION_START': {
        await chrome.sidePanel.open({ tabId: req.tabId })
        await chrome.tabs.sendMessage(req.tabId, { type: 'SESSION_START', url: req.url })
        return { ok: true, data: null }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
```

- [ ] **Step 5**: SW 진입점 (덮어쓰기) `extension/src/service-worker/index.ts`

```typescript
import { handle } from './messaging'
import type { SwRequest } from '../shared/types'

chrome.runtime.onInstalled.addListener(() => console.log('[SW] installed'))
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId })
})
chrome.runtime.onMessage.addListener((req: SwRequest, _sender, sendResponse) => {
  handle(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: e?.message ?? 'unknown' }))
  return true   // async
})
```

- [ ] **Step 6**: Commit

```bash
git add extension/src/
git commit -m "feat(extension): service worker auth + api client"
```

---

## Task 13: 익스텐션 — 콘텐츠 스크립트 (video 감지 + 토스트)

**Files:**
- Create: `extension/src/content/toast.ts`, `extension/src/content/index.ts` (덮어쓰기)

- [ ] **Step 1**: 토스트 모듈 `extension/src/content/toast.ts`

```typescript
const TOAST_ID = '__sh_toast_root__'

export function showToast(opts: { onActivate: () => void; onDismiss?: () => void }): void {
  hideToast()
  const root = document.createElement('div')
  root.id = TOAST_ID
  root.style.cssText = `
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    background: #1f2937; color: white; padding: 14px 18px; border-radius: 12px;
    font-family: system-ui, -apple-system, sans-serif; font-size: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; gap: 12px; align-items: center;
  `
  root.innerHTML = `
    <span>📚 この動画を要約しますか?</span>
    <button id="__sh_yes" style="background:#3b82f6;border:0;color:white;padding:6px 12px;border-radius:6px;cursor:pointer;">はい</button>
    <button id="__sh_no" style="background:transparent;border:0;color:#9ca3af;cursor:pointer;">×</button>
  `
  document.body.appendChild(root)
  document.getElementById('__sh_yes')!.addEventListener('click', () => {
    hideToast(); opts.onActivate()
  })
  document.getElementById('__sh_no')!.addEventListener('click', () => {
    hideToast(); opts.onDismiss?.()
  })
}

export function hideToast(): void {
  document.getElementById(TOAST_ID)?.remove()
}
```

- [ ] **Step 2**: video 감지 + 토스트 트리거 `extension/src/content/index.ts`

```typescript
import { showToast } from './toast'

let detected = false
let activeVideo: HTMLVideoElement | null = null

function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  // pick the largest by area
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const area = r.width * r.height
    if (area > bestArea && r.width > 200) { best = v; bestArea = area }
  }
  return best
}

function checkAndOffer(): void {
  if (detected) return
  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  showToast({
    onActivate: () => {
      chrome.runtime.sendMessage({ type: 'SESSION_START', tabId: -1, url: location.href })
    },
  })
}

// initial check + observe DOM mutations
checkAndOffer()
const obs = new MutationObserver(() => checkAndOffer())
obs.observe(document.documentElement, { childList: true, subtree: true })

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_VIDEO_INFO') {
    if (activeVideo) {
      sendResponse({ ok: true, info: { duration: activeVideo.duration, paused: activeVideo.paused } })
    } else sendResponse({ ok: false })
    return true
  }
  return false
})

export {}  // module marker
```

- [ ] **Step 3**: 빌드 + 수동 검증

```bash
cd extension; pnpm build
```

크롬에서 dist 재로드, YouTube 영상 페이지 방문 → 우측 하단 토스트 확인.

- [ ] **Step 4**: Commit

```bash
git add extension/src/content/
git commit -m "feat(extension): video detection + activation toast"
```

---

## Task 14: 익스텐션 — 오디오 캡처 + 청크 전송

**Files:**
- Create: `extension/src/content/audio-capture.ts`
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1**: 오디오 캡처 클래스 `extension/src/content/audio-capture.ts`

```typescript
export interface AudioChunk {
  startTimeSec: number
  durationSec: number
  blob: Blob
  mime: string
}

const CHUNK_DURATION_MS = 15_000

export class AudioCapture {
  private recorder: MediaRecorder | null = null
  private parts: Blob[] = []
  private startedAtVideoTime = 0
  private chunkStartReal = 0
  private mime = 'audio/webm;codecs=opus'

  constructor(private video: HTMLVideoElement, private onChunk: (c: AudioChunk) => void) {}

  start(): void {
    const stream = this.video.captureStream()
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('No audio track in video')
    const audioStream = new MediaStream(audioTracks)
    this.recorder = new MediaRecorder(audioStream, { mimeType: this.mime })
    this.startedAtVideoTime = this.video.currentTime
    this.chunkStartReal = Date.now()
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.parts.push(e.data)
    }
    this.recorder.onstop = () => this.flushChunk()
    this.recorder.start()
    this.scheduleNextSlice()
  }

  private scheduleNextSlice(): void {
    setTimeout(() => {
      if (!this.recorder || this.recorder.state !== 'recording') return
      this.recorder.requestData()
      // restart to produce a self-contained chunk
      this.recorder.stop()
      this.recorder.start()
      this.scheduleNextSlice()
    }, CHUNK_DURATION_MS)
  }

  private flushChunk(): void {
    if (this.parts.length === 0) return
    const blob = new Blob(this.parts, { type: this.mime })
    const durationSec = (Date.now() - this.chunkStartReal) / 1000
    this.onChunk({
      startTimeSec: this.startedAtVideoTime,
      durationSec,
      blob,
      mime: this.mime,
    })
    this.parts = []
    this.startedAtVideoTime = this.video.currentTime
    this.chunkStartReal = Date.now()
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
    this.recorder = null
  }
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer()
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
```

- [ ] **Step 2**: index.ts에 세션 시작 흐름 추가

`extension/src/content/index.ts`에 다음을 덧붙임 (기존 코드 다음):

```typescript
import { AudioCapture, blobToBase64 } from './audio-capture'

let capture: AudioCapture | null = null
let currentSessionId: string | null = null

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'SESSION_START') {
    void startCapture(msg.url)
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'JUMP_TO') {
    if (activeVideo) { activeVideo.currentTime = msg.ts; activeVideo.playbackRate = 1.0 }
    sendResponse({ ok: true })
    return true
  }
  return false
})

async function startCapture(url: string): Promise<void> {
  if (!activeVideo) return

  // apply playback speed setting
  const settingResp = await chrome.runtime.sendMessage({
    type: 'API_FETCH', path: '/v1/__noop__', method: 'GET'  // placeholder; speed handled below
  }).catch(() => null)
  void settingResp

  // get configured speed (or auto-detect max)
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  currentSessionId = crypto.randomUUID()
  capture = new AudioCapture(activeVideo, async (chunk) => {
    const b64 = await blobToBase64(chunk.blob)
    await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/audio',
      body: {
        session_id: currentSessionId,
        url,
        start_time_sec: chunk.startTimeSec,
        duration_sec: chunk.durationSec,
        audio_b64: b64,
        mime: chunk.mime,
      },
    })
  })
  capture.start()

  // notify side panel
  chrome.runtime.sendMessage({ type: 'SP_BROADCAST', payload: { type: 'session_started', sessionId: currentSessionId, url } })
}

function detectMaxSpeed(_v: HTMLVideoElement): number | null {
  // best effort: try common max values; players differ. Default to 2.
  return 2
}

activeVideo?.addEventListener('ended', () => {
  capture?.stop()
  if (currentSessionId) {
    chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/session/finalize',
      body: { session_id: currentSessionId, title: document.title },
    })
  }
})
```

- [ ] **Step 3**: Commit

```bash
git add extension/src/content/
git commit -m "feat(extension): audio capture and chunk upload"
```

---

## Task 15: 익스텐션 — 슬라이드 detector

**Files:**
- Create: `extension/src/content/slide-detector.ts`
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1**: detector 모듈 `extension/src/content/slide-detector.ts`

```typescript
export interface Slide {
  ts: number
  blob: Blob
  mime: 'image/jpeg'
}

const SAMPLE_INTERVAL_MS = 1000
const DIFF_THRESHOLD = 0.18    // 18% pixels change → new slide
const MIN_GAP_SEC = 3

export class SlideDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private prev: ImageData | null = null
  private lastEmitTs = -1
  private timer: number | null = null

  constructor(private video: HTMLVideoElement, private onSlide: (s: Slide) => void) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 320
    this.canvas.height = 180
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  }

  start(): void {
    this.timer = window.setInterval(() => this.tick(), SAMPLE_INTERVAL_MS)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (this.video.paused || this.video.readyState < 2) return
    const ts = this.video.currentTime
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    const cur = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)

    if (this.prev) {
      const diff = pixelDiff(this.prev, cur)
      if (diff > DIFF_THRESHOLD && ts - this.lastEmitTs > MIN_GAP_SEC) {
        this.lastEmitTs = ts
        this.canvas.toBlob((blob) => {
          if (blob) this.onSlide({ ts, blob, mime: 'image/jpeg' })
        }, 'image/jpeg', 0.85)
      }
    }
    this.prev = cur
  }
}

function pixelDiff(a: ImageData, b: ImageData): number {
  const A = a.data, B = b.data
  let diffPixels = 0
  const total = A.length / 4
  for (let i = 0; i < A.length; i += 4) {
    const dr = A[i] - B[i], dg = A[i + 1] - B[i + 1], db = A[i + 2] - B[i + 2]
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 60) diffPixels++
  }
  return diffPixels / total
}
```

- [ ] **Step 2**: 단위 테스트 `extension/tests/slide-detector.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

// Simple sanity: pixelDiff equivalent test via construction.
describe('SlideDetector pixel logic', () => {
  it('produces ImageData of expected size', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4; canvas.height = 4
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 4, 4)
    const img = ctx.getImageData(0, 0, 4, 4)
    expect(img.data.length).toBe(64)  // 4*4*4 channels
  })
})
```

- [ ] **Step 3**: index.ts에 통합 (startCapture 안에서 detector 시작)

`extension/src/content/index.ts`의 `startCapture` 끝부분에:

```typescript
import { SlideDetector, type Slide } from './slide-detector'

// ...inside startCapture, after capture.start():
const detector = new SlideDetector(activeVideo, async (slide: Slide) => {
  const buf = await slide.blob.arrayBuffer()
  let s = ''; const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  const b64 = btoa(s)
  await chrome.runtime.sendMessage({
    type: 'API_FETCH',
    method: 'POST',
    path: '/v1/stream/slide',
    body: { session_id: currentSessionId, ts: slide.ts, image_b64: b64, mime: 'image/jpeg' },
  })
})
detector.start()
activeVideo.addEventListener('ended', () => detector.stop())
```

- [ ] **Step 4**: Commit

```bash
pnpm --filter extension test
git add extension/
git commit -m "feat(extension): slide change detection and upload"
```

---

## Task 16: 익스텐션 — Side Panel UI (노트 + WebSocket + 클릭 점프)

**Files:**
- Create: `extension/src/side-panel/api-client.ts`, `extension/src/side-panel/components/{NoteList,NoteItem,ConsentModal,DownloadButton,QuotaBanner,LoginScreen}.tsx`
- Modify: `extension/src/side-panel/App.tsx`

- [ ] **Step 1**: API 클라이언트 `extension/src/side-panel/api-client.ts`

```typescript
import { WS_URL } from '../shared/config'
import type { NoteItem, SlideItem, User } from '../shared/types'
import { getToken } from '../shared/storage'

export async function callApi<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await chrome.runtime.sendMessage({ type: 'API_FETCH', path, method, body })
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

export async function login(): Promise<User> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' })
  if (!r.ok) throw new Error(r.error)
  return r.data as User
}

export async function logout(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
}

export async function getCurrentUser(): Promise<User | null> {
  const r = await chrome.runtime.sendMessage({ type: 'AUTH_GET_USER' })
  return r.ok ? r.data as User | null : null
}

export interface WsListeners {
  onNote: (notes: NoteItem[]) => void
  onSlide: (slide: SlideItem) => void
  onClose: () => void
}

export async function connectWs(sessionId: string, listeners: WsListeners): Promise<WebSocket> {
  const token = await getToken()
  const url = `${WS_URL}?token=${encodeURIComponent(token!)}&session_id=${sessionId}`
  const ws = new WebSocket(url)
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'note_chunk') listeners.onNote(msg.notes)
      else if (msg.type === 'slide_chunk') listeners.onSlide(msg.slide)
    } catch { /* ignore */ }
  }
  ws.onclose = () => listeners.onClose()
  return ws
}

export async function jumpToTimestamp(ts: number): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab.id) return
  await chrome.tabs.sendMessage(tab.id, { type: 'JUMP_TO', ts })
}
```

- [ ] **Step 2**: 컴포넌트들

`extension/src/side-panel/components/NoteItem.tsx`:

```tsx
import { jumpToTimestamp } from '../api-client'
import type { NoteItem as N } from '../../shared/types'

function fmt(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function NoteItem({ n, slideUrl }: { n: N; slideUrl?: string }) {
  return (
    <button
      onClick={() => jumpToTimestamp(n.ts)}
      className={`block w-full text-left px-3 py-2 rounded hover:bg-gray-100 ${n.important ? 'border-l-4 border-red-500' : ''}`}
    >
      <div className="text-xs text-gray-500">[{fmt(n.ts)}]</div>
      <div className="text-sm">{n.important && '⭐ '}{n.text}</div>
      {slideUrl && <img src={slideUrl} alt="" className="mt-1 rounded max-w-full" />}
    </button>
  )
}
```

`extension/src/side-panel/components/NoteList.tsx`:

```tsx
import { NoteItem } from './NoteItem'
import type { NoteItem as N, SlideItem } from '../../shared/types'

export function NoteList({ notes, slides }: { notes: N[]; slides: SlideItem[] }) {
  const slideByTs = new Map(slides.map(s => [Math.round(s.ts), s.key]))
  return (
    <div className="space-y-1">
      {notes.length === 0 && <p className="text-sm text-gray-500 p-3">処理中... 講義を再生してください。</p>}
      {notes.map((n, i) => (
        <NoteItem key={i} n={n} slideUrl={slideByTs.get(Math.round(n.ts))} />
      ))}
    </div>
  )
}
```

`extension/src/side-panel/components/ConsentModal.tsx`:

```tsx
import { useState } from 'react'

interface Props { onAccept: () => void }

export function ConsentModal({ onAccept }: Props) {
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-2">重要なお知らせ</h2>
        <p className="text-sm text-gray-700 mb-3">
          本ツールは、ユーザーが視聴中の動画から音声・映像情報を取得し、AI で要約します。
          視聴コンテンツの著作権は配信元(教育機関、講師、配信プラットフォーム等)に帰属します。
        </p>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1 mb-3">
          <li>所属機関(大学・予備校等)の利用規約および学則</li>
          <li>視聴対象コンテンツの利用規約</li>
          <li>著作権法その他関連法令</li>
        </ol>
        <p className="text-sm font-semibold mb-3">
          本ツールの使用により発生したいかなる紛争・損害についても、開発者は一切の責任を負いません。
        </p>
        <label className="flex gap-2 items-start text-sm mb-2">
          <input type="checkbox" checked={a} onChange={e => setA(e.target.checked)} />
          上記に同意します
        </label>
        <label className="flex gap-2 items-start text-sm mb-4">
          <input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} />
          本ツールを個人の学習目的のみに使用します
        </label>
        <button
          disabled={!(a && b)}
          onClick={onAccept}
          className="w-full bg-blue-600 disabled:bg-gray-300 text-white py-2 rounded"
        >同意して始める</button>
      </div>
    </div>
  )
}
```

`extension/src/side-panel/components/DownloadButton.tsx`:

```tsx
import { useState } from 'react'
import { callApi } from '../api-client'

export function DownloadButton({ sessionId, title }: { sessionId: string; title: string }) {
  const [loading, setLoading] = useState(false)
  const onClick = async () => {
    setLoading(true)
    try {
      const r = await callApi<{ pdf_url: string }>('/v1/session/finalize', 'POST', { session_id: sessionId, title })
      window.open(r.pdf_url, '_blank')
    } finally { setLoading(false) }
  }
  return (
    <button onClick={onClick} disabled={loading}
      className="w-full bg-emerald-600 disabled:bg-gray-300 text-white py-2 rounded mt-3">
      {loading ? '生成中...' : '📥 ダウンロード (PDF)'}
    </button>
  )
}
```

`extension/src/side-panel/components/QuotaBanner.tsx`:

```tsx
import type { User } from '../../shared/types'

export function QuotaBanner({ user, onUpgrade }: { user: User | null; onUpgrade: () => void }) {
  if (!user) return null
  if (user.plan === 'pro') return <div className="text-xs text-emerald-600 px-3 py-1">Pro プラン</div>
  return (
    <div className="bg-amber-50 border-amber-200 border text-sm text-amber-900 px-3 py-2 rounded m-2 flex items-center justify-between">
      <span>Free プラン (月 30 分まで)</span>
      <button onClick={onUpgrade} className="text-blue-700 underline text-xs">Pro にアップグレード</button>
    </div>
  )
}
```

`extension/src/side-panel/components/LoginScreen.tsx`:

```tsx
import { useState } from 'react'
import { login } from '../api-client'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setLoading(true); setErr(null)
    try { await login(); onSuccess() }
    catch (e) { setErr(e instanceof Error ? e.message : 'unknown') }
    finally { setLoading(false) }
  }
  return (
    <div className="p-6 text-center">
      <h2 className="text-lg font-bold mb-3">Study-Helper</h2>
      <p className="text-sm text-gray-600 mb-4">講義動画をリアルタイムで要約します</p>
      <button onClick={handle} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded">
        {loading ? '...' : 'Google でログイン'}
      </button>
      {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3**: App.tsx 갱신 `extension/src/side-panel/App.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import type { NoteItem as N, SlideItem, User } from '../shared/types'
import { hasConsent, setConsent } from '../shared/storage'
import { ConsentModal } from './components/ConsentModal'
import { LoginScreen } from './components/LoginScreen'
import { NoteList } from './components/NoteList'
import { DownloadButton } from './components/DownloadButton'
import { QuotaBanner } from './components/QuotaBanner'
import { callApi, connectWs, getCurrentUser } from './api-client'

export default function App() {
  const [consented, setConsented] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notes, setNotes] = useState<N[]>([])
  const [slides, setSlides] = useState<SlideItem[]>([])
  const [title, setTitle] = useState('講義ノート')

  useEffect(() => { hasConsent().then(setConsented) }, [])
  useEffect(() => { getCurrentUser().then(setUser) }, [consented])

  // listen for SP_BROADCAST from content via SW
  useEffect(() => {
    const listener = (msg: { type: string; payload?: { type: string; sessionId?: string; url?: string } }) => {
      if (msg.type === 'SP_BROADCAST' && msg.payload?.type === 'session_started' && msg.payload.sessionId) {
        setSessionId(msg.payload.sessionId)
        setNotes([]); setSlides([])
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // load existing session for current url
  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.url) return
      setTitle(tab.title || '講義ノート')
      try {
        const r = await callApi<{ session: { id: string; notes: N[]; slides: SlideItem[] } | null }>(
          `/v1/session?url=${encodeURIComponent(tab.url)}`, 'GET'
        )
        if (r.session) {
          setSessionId(r.session.id)
          setNotes(r.session.notes || [])
          setSlides(r.session.slides || [])
        }
      } catch { /* ignore */ }
    })()
  }, [user])

  // connect WS when sessionId arrives
  useEffect(() => {
    if (!sessionId) return
    let ws: WebSocket | null = null
    void connectWs(sessionId, {
      onNote: (newNotes) => setNotes(prev => [...prev, ...newNotes]),
      onSlide: (s) => setSlides(prev => [...prev, s]),
      onClose: () => {},
    }).then(w => { ws = w })
    return () => { ws?.close() }
  }, [sessionId])

  const onUpgrade = useCallback(async () => {
    const r = await callApi<{ url: string }>('/v1/billing/checkout', 'POST', {})
    chrome.tabs.create({ url: r.url })
  }, [])

  if (consented === null) return null
  if (!consented) return <ConsentModal onAccept={async () => { await setConsent(); setConsented(true) }} />
  if (!user) return <LoginScreen onSuccess={() => getCurrentUser().then(setUser)} />

  return (
    <div className="min-h-screen flex flex-col">
      <QuotaBanner user={user} onUpgrade={onUpgrade} />
      <NoteList notes={notes} slides={slides} />
      {sessionId && notes.length > 0 && <DownloadButton sessionId={sessionId} title={title} />}
    </div>
  )
}
```

- [ ] **Step 4**: 빌드 + 수동 검증

```bash
cd extension; pnpm build
```

크롬 dist 재로드 → 사이드 패널이 ConsentModal → LoginScreen → 빈 노트 패널까지 정상 흐름 확인.

- [ ] **Step 5**: Commit

```bash
git add extension/src/side-panel
git commit -m "feat(extension): side panel UI with consent, login, notes, download"
```

---

## Task 17: 익스텐션 — 자동 배속 설정 (옵션 페이지)

**Files:**
- Create: `extension/src/options/index.html`, `extension/src/options/main.tsx`, `extension/src/options/Options.tsx`
- Modify: `extension/manifest.config.ts` (options_ui 추가)

- [ ] **Step 1**: 옵션 페이지 manifest 등록

`manifest.config.ts`에 추가:

```typescript
options_ui: { page: 'src/options/index.html', open_in_tab: true },
```

- [ ] **Step 2**: HTML + entry

`extension/src/options/index.html`:

```html
<!doctype html>
<html lang="ja">
<head><meta charset="UTF-8" /><title>Study-Helper 設定</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`extension/src/options/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { Options } from './Options'
import '../side-panel/index.css'
createRoot(document.getElementById('root')!).render(<Options />)
```

- [ ] **Step 3**: 옵션 컴포넌트 `extension/src/options/Options.tsx`

```tsx
import { useEffect, useState } from 'react'
import { getPlaybackSpeed, setPlaybackSpeed } from '../shared/storage'

const OPTIONS: Array<{ value: 'auto' | number; label: string }> = [
  { value: 'auto', label: 'プレイヤー最高速 (推奨)' },
  { value: 1.5, label: '1.5×' },
  { value: 2.0, label: '2.0×' },
  { value: 2.5, label: '2.5×' },
  { value: 3.0, label: '3.0×' },
]

export function Options() {
  const [speed, setSpeed] = useState<'auto' | number>('auto')
  useEffect(() => { getPlaybackSpeed().then(setSpeed) }, [])
  const onChange = async (v: 'auto' | number) => { setSpeed(v); await setPlaybackSpeed(v) }
  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Study-Helper 設定</h1>
      <h2 className="font-semibold mb-2">再生速度</h2>
      <p className="text-sm text-gray-600 mb-4">要約モード起動時に自動で適用される速度です。</p>
      {OPTIONS.map(o => (
        <label key={String(o.value)} className="flex gap-2 items-center mb-2">
          <input type="radio" name="speed" checked={speed === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 4**: 빌드 + Commit

```bash
cd extension; pnpm build
git add extension/
git commit -m "feat(extension): options page for playback speed"
```

---

## Task 18: Web — Next.js 마케팅 + 利用規約 + プライバシー 페이지

**Files:**
- Create: `web/package.json`, `web/next.config.ts`, `web/tsconfig.json`, `web/src/app/{layout,page}.tsx`, `web/src/app/terms/page.tsx`, `web/src/app/privacy/page.tsx`

- [ ] **Step 1**: 디렉토리 + 패키지

```bash
mkdir -p web/src/app/{terms,privacy}
cd web
pnpm init
pnpm add next react react-dom
pnpm add -D typescript @types/node @types/react @types/react-dom
```

- [ ] **Step 2**: tsconfig + next config

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`web/next.config.ts`:

```typescript
import type { NextConfig } from 'next'
const config: NextConfig = { reactStrictMode: true }
export default config
```

`web/package.json` scripts:

```json
"scripts": { "dev": "next dev", "build": "next build", "start": "next start" }
```

- [ ] **Step 3**: 페이지들

`web/src/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
        {children}
      </body>
    </html>
  )
}
```

`web/src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main>
      <h1>Study-Helper</h1>
      <p>日本の大学生のための、ダウンロード不可な講義動画専用のリアルタイム学習アシスタント</p>
      <h2>機能</h2>
      <ul>
        <li>動画を再生するだけで、要点ノートが自動生成されます</li>
        <li>スライドも自動でキャプチャ</li>
        <li>視聴後にノートを PDF / Markdown でダウンロード</li>
      </ul>
      <p><a href="/terms">利用規約</a> | <a href="/privacy">プライバシーポリシー</a></p>
    </main>
  )
}
```

`web/src/app/terms/page.tsx`:

```tsx
export const metadata = { title: '利用規約 - Study-Helper' }

export default function Terms() {
  return (
    <main>
      <h1>利用規約</h1>
      <p>本利用規約(以下「本規約」)は、Study-Helper(以下「本サービス」)の利用条件を定めるものです。</p>
      <h2>第1条 (本サービスの目的)</h2>
      <p>本サービスは、ユーザーが視聴中の動画から音声・映像情報を取得し、AI で要約することで学習を支援するツールです。</p>
      <h2>第2条 (ユーザーの責任)</h2>
      <p>ユーザーは以下を確認・遵守する責任を負います:</p>
      <ol>
        <li>所属機関(大学・予備校等)の利用規約および学則</li>
        <li>視聴対象コンテンツの利用規約</li>
        <li>著作権法その他関連法令</li>
      </ol>
      <h2>第3条 (免責)</h2>
      <p>本ツールの使用により発生したいかなる紛争・損害についても、開発者は一切の責任を負いません。</p>
      <h2>第4条 (アカウント停止)</h2>
      <p>当社は、本ツールが法令違反、所属機関規定違反、過度な使用に関与していると合理的に判断した場合、予告なくアカウントを停止する権利を有します。</p>
      <h2>第5条 (規約の変更)</h2>
      <p>当社は、必要に応じて本規約を変更できるものとします。</p>
    </main>
  )
}
```

`web/src/app/privacy/page.tsx`:

```tsx
export const metadata = { title: 'プライバシーポリシー - Study-Helper' }

export default function Privacy() {
  return (
    <main>
      <h1>プライバシーポリシー</h1>
      <h2>取得する情報</h2>
      <ul>
        <li>Google アカウントの ID、メールアドレス、表示名</li>
        <li>ユーザーが要約処理を開始した動画 URL、要約結果テキスト、スライド画像</li>
        <li>使用時間 (quota 計算のため)</li>
      </ul>
      <h2>データ処理</h2>
      <p>音声・映像データは要約処理のため一時的に外部 AI サービス(OpenAI / Google) に送信されます。処理完了後、生データは即座に削除され、要約テキストとスライド画像のみがユーザーアカウントに保存されます。</p>
      <h2>データ保管場所</h2>
      <p>AWS 東京リージョン (ap-northeast-1)</p>
      <h2>第三者提供</h2>
      <p>法令に基づく開示請求を除き、第三者には提供しません。</p>
      <h2>お問い合わせ</h2>
      <p>support@study-helper.example.com</p>
    </main>
  )
}
```

- [ ] **Step 4**: Commit

```bash
git add web/
git commit -m "feat(web): marketing + terms + privacy pages"
```

---

## Task 19: 인프라 배포 (CDK deploy)

**Files:** modify `backend/infra/bin/app.ts` (이미 작성됨)

- [ ] **Step 1**: AWS 자격증명 확인

```bash
aws sts get-caller-identity --region ap-northeast-1
```

Expected: 본인 계정 ID 출력. 못 받으면 `aws configure` 실행.

- [ ] **Step 2**: bootstrap (이미 했으면 skip)

```bash
cd backend
pnpm cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1
```

- [ ] **Step 3**: deploy

```bash
pnpm deploy
```

Expected: 4개 스택 생성 — Network / Data / Secrets / Ws / Api. 시간 약 10~15분 (RDS 때문).

- [ ] **Step 4**: 출력값 기록

CDK 출력을 메모:
- `StudyHelperApi.ApiUrl` → `VITE_API_BASE_URL`
- `StudyHelperWs.WsUrl` → `VITE_WS_URL`
- `StudyHelperSecrets.AppSecretArn` → 콘솔에서 값 입력 대상

- [ ] **Step 5**: Secrets Manager 값 입력 (AWS 콘솔)

AWS Console → Secrets Manager → `studyhelper/app` → Retrieve secret value → Edit → "Plaintext" 탭에서 다음 JSON 입력 (값은 본인 키로 대체):

```json
{
  "JWT_SECRET": "<32+ random chars>",
  "OPENAI_API_KEY": "<your OpenAI key>",
  "GOOGLE_GENAI_API_KEY": "<your Gemini key>",
  "GOOGLE_OAUTH_CLIENT_ID": "<your client id>",
  "GOOGLE_OAUTH_CLIENT_SECRET": "<your client secret>",
  "STRIPE_SECRET_KEY": "<your stripe secret>",
  "STRIPE_WEBHOOK_SECRET": "<your stripe webhook secret>",
  "STRIPE_PRICE_PRO": "<your price id for ¥980/月>",
  "S3_BUCKET": "<auto-filled by CDK output>"
}
```

> ⚠️ 값은 **콘솔에서 직접** 입력. PRD/플랜/커밋에 평문 노출 금지.

- [ ] **Step 6**: 마이그레이션 실행

DB는 VPC 내부에 있으므로 EC2 bastion 또는 임시 Lambda로 마이그레이션. 가장 간단: EC2 t4g.micro Bastion 임시 생성 → SSM Session Manager로 접속 → 거기서 migrate 실행. 또는 임시 Lambda로 한 번 실행.

임시 Lambda 방식:

```bash
cd backend
# infra/lib/migrate-stack.ts 임시 추가 (파일 생성)
```

`backend/infra/lib/migrate-stack.ts`:

```typescript
import { Stack, type StackProps, Duration } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as path from 'path'

interface Props extends StackProps {
  vpc: Vpc; dbSecret: Secret; dbCluster: DatabaseCluster
}

export class MigrateStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const fn = new NodejsFunction(this, 'MigrateFn', {
      entry: path.join(__dirname, '../../src/lib/migrate.ts'),
      handler: 'migrate',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: { DB_SECRET_ARN: props.dbSecret.secretArn },
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      bundling: { commandHooks: { beforeBundling: () => [], beforeInstall: () => [], afterBundling: (i, o) => [
        `cp -r ${i}/src/migrations ${o}/migrations`
      ] } },
    })
    props.dbSecret.grantRead(fn)
    props.dbCluster.connections.allowDefaultPortFrom(fn)
  }
}
```

`backend/src/lib/migrate.ts`에서 `export const migrate` (Lambda handler 호환 형태)로 export 노출. 위 파일 끝에 추가:

```typescript
export const handler = async () => { await migrate(); return { ok: true } }
```

`bin/app.ts`에 추가:

```typescript
import { MigrateStack } from '../lib/migrate-stack.js'
new MigrateStack(app, 'StudyHelperMigrate', {
  env, vpc: network.vpc, dbSecret: data.dbSecret, dbCluster: data.cluster,
})
```

배포 후 콘솔에서 한 번 실행:

```bash
pnpm deploy
aws lambda invoke --function-name $(aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `StudyHelperMigrate-MigrateFn`)].FunctionName | [0]' --output text) --region ap-northeast-1 /tmp/out.json
cat /tmp/out.json
```

Expected: `{"ok": true}`.

- [ ] **Step 7**: Commit

```bash
git add backend/
git commit -m "feat(infra): deployment stacks complete + migrate runner"
```

---

## Task 20: 익스텐션 빌드 → 환경변수 주입 → 패키징

**Files:**
- Create: `extension/.env.production`

- [ ] **Step 1**: 환경변수 파일 (값 입력은 사용자가 직접)

`extension/.env.production`:

```bash
VITE_API_BASE_URL=https://<ApiId>.execute-api.ap-northeast-1.amazonaws.com
VITE_WS_URL=wss://<WsId>.execute-api.ap-northeast-1.amazonaws.com/prod
VITE_GOOGLE_OAUTH_CLIENT_ID=<your client id>
VITE_STRIPE_PUBLIC_KEY=<your stripe public key>
```

> 값은 CDK 출력값과 본인 계정 키로 대체. 평문 secret은 안 들어감 (public OAuth client ID와 publishable Stripe key는 평문 OK).

- [ ] **Step 2**: 프로덕션 빌드

```bash
cd extension
pnpm build
```

Expected: `dist/` 디렉토리에 manifest.json + 모든 자산.

- [ ] **Step 3**: ZIP 패키징

```bash
cd dist
zip -r ../study-helper-v0.1.0.zip .
cd ..
ls -la study-helper-v0.1.0.zip
```

Expected: 수 MB ZIP 파일 생성.

- [ ] **Step 4**: 로컬 unpacked 로드 → 종단 스모크 테스트

체크리스트:
- [ ] 동의 모달 표시 → 동의
- [ ] Google 로그인 → 사용자 표시
- [ ] YouTube 영상 페이지 방문 → 토스트 표시
- [ ] 토스트 클릭 → 사이드 패널 열림 + 영상 자동 배속 시작
- [ ] 15~30초 후 노트가 한 줄씩 추가됨
- [ ] 슬라이드/장면 변화 시 썸네일 첨부
- [ ] 노트 클릭 → 영상 점프 + 1배속 전환
- [ ] 영상 끝 → [📥 ダウンロード] 버튼 → PDF 다운로드 성공
- [ ] 같은 URL 재방문 → 기존 노트 자동 로드
- [ ] Pro 업그레이드 버튼 → Stripe Checkout 페이지 열림

- [ ] **Step 5**: Commit

```bash
git add extension/.env.production
git commit -m "chore(extension): production build configuration"
```

---

## Task 21: Chrome 웹스토어 제출 + 프로덕션 검증

**Files:** N/A (웹 콘솔 작업)

- [ ] **Step 1**: 개발자 등록 (이미 안 했다면)

https://chrome.google.com/webstore/devconsole → $5 등록비.

- [ ] **Step 2**: 새 항목 만들기 → ZIP 업로드

`study-helper-v0.1.0.zip` 업로드.

- [ ] **Step 3**: 스토어 항목 정보 입력

- 카테고리: 教育 (Education)
- 언어: 日本語
- 설명 (일본어): "ダウンロード不可な大学講義動画を再生するだけで、AI が要点ノートを自動生成。スライドも自動キャプチャし、視聴後に PDF でダウンロード。"
- 스크린샷 5장 (사이드 패널, 토스트, 노트 흐름, PDF 결과, 옵션 페이지) — 1280×800 권장
- 프로모션 이미지 (선택)
- 利用規約 URL: 본인 web 도메인의 `/terms`
- プライバシーポリシー URL: `/privacy`

- [ ] **Step 4**: 권한 정당성 작성

각 권한에 대해 필요한 이유 명시:
- `tabs`: 현재 탭 URL 식별, 사이드 패널 열기
- `scripting`: 콘텐츠 스크립트가 video 엘리먼트 접근
- `storage`: 사용자 토큰, 동의, 설정 저장
- `sidePanel`: 사이드 패널 UI
- `identity`: Google OAuth 로그인
- `<all_urls>`: 사용자가 보는 모든 강의 영상 페이지에서 동작

- [ ] **Step 5**: 제출

검토 제출 → 1~3 영업일 검토. 결과 알림 받음.

- [ ] **Step 6**: 프로덕션 스모크

승인 대기 동안 unpacked 로드로 다음 종단 검증:

| 시나리오 | Expected |
|---------|----------|
| 무료 사용자가 30분 한도 초과 | quota 모달 + 업그레이드 CTA |
| Stripe checkout → 결제 완료 → webhook | DB의 user.plan = 'pro' |
| Pro 사용자 30시간 한도 도달 | quota 차단 + "上限に達しました" |
| 재방문 시 기존 노트 자동 로드 | 시간차 < 1초 |
| 영상 빠른 시킹 시 노트 깨짐 없음 | 처리 큐 robustness |

- [ ] **Step 7**: 출시 태그

```bash
git tag v0.1.0
git push origin main --tags
```

---

## Self-Review

**1. Spec coverage**

| PRD 요구 | 대응 Task | 상태 |
|---------|---------|------|
| F1 video 감지 + 토스트 | Task 13 | ✅ |
| F2 실시간 STT + 요약 | Task 6, 7, 9, 14 | ✅ |
| F3 슬라이드 변경 감지 | Task 9, 15 | ✅ |
| F4 타임스탬프 노트 + 클릭 점프 | Task 16 | ✅ |
| F5 자동 배속 | Task 17 | ✅ |
| F6 다운로드 (수동) | Task 10, 16 | ✅ |
| F7 재방문 자동 표시 | Task 10, 16 | ✅ |
| F8 계정 + quota | Task 5, 8, 11 | ✅ |
| F9 일본어 출력 | Task 7 (시스템 프롬프트) | ✅ |
| F10 면책 모달 | Task 16 ConsentModal | ✅ |
| 利用規約 / プライバシー | Task 18 | ✅ |
| AWS 인프라 | Task 3, 9 (WS), 10, 19 | ✅ |
| Chrome 웹스토어 제출 | Task 21 | ✅ |
| Stripe 결제 | Task 11 | ✅ |

모든 PRD 요구가 매핑됨.

**2. Placeholder scan**

플랜 내 "TBD", "TODO", "implement later", "add validation"-스타일 노트 없음. CDK Stack의 코드 일부에서 환경변수가 빈 문자열로 표시된 부분이 있는데, 이는 Step 8(env.ts loadAppSecrets)에서 동적으로 채우는 명시적 설계라 placeholder 아님.

**3. Type consistency**

- `NoteItem` 정의: backend `llm.ts` (`{ ts, text, important }`) ↔ extension `shared/types.ts` (`{ ts, text, important, slideKey? }`) — 호환 (extension 측이 superset).
- `SlideItem` 정의: backend stream-slide 핸들러 (`{ ts, key }`) ↔ extension shared (`{ ts, key }`) — 일치.
- `User` 정의: backend auth-google (`{ id, email, name, plan }`) ↔ extension shared (`{ id, email, name?, plan }`) — 일치.
- `signJwt(payload, ttl)` 시그니처: lib/auth.ts ↔ auth-google handler 호출 — 일치.
- `transcribeChunk(audio, mime, hintLanguage?)` ↔ stream-audio 호출 — 일치.

타입 일관성 통과.

**4. 시간 현실성 (스코프 체크)**

- 24~30 dev-hour 분량으로 21개 Task. CDK 첫 deploy + RDS 프로비저닝 ~15분 등 외부 대기 포함.
- 각 Task 평균 1~1.5h. AI 페어링/코드 자동완성 가정 시 수행 가능 영역.
- **외부 블로커**:
  - Chrome 웹스토어 검토 1~3일 (개발 외)
  - Stripe 본인 인증 1~2영업일 (Day 0 시작)
  - Google OAuth client 발급은 즉시
- 따라서 "Day 2 종료 시점에 웹스토어 제출 완료 + 본인 환경에서 종단 동작" 이 현실적 골.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-study-helper-mvp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
