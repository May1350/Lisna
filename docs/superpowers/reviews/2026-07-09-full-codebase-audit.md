# Lisna Desktop — 전체 코드베이스 정밀 감사 (2026-07-09)

**대상:** `desktop/src/**` + `desktop/sidecar/src/**` @ `feat/llm-connector-notes` f41b9ad (v0.1.40, PR #158)
**방법:** 10개 관점 병렬 파인더 (main-lifecycle / renderer-state / note-pipeline / stt-audio / sidecar-cpp / security-privacy / error-resilience / quality-structure / connector-external / ipc-contract / perf-resources) → 중복 제거 → **발견별 적대적 검증** (HIGH급은 2명 독립 검증, 전원 CONFIRMED만 채택). 총 61 에이전트.
**결과:** raw 54 → 중복 제거 51 → **확정 버그 28** (HIGH 6 / MEDIUM 18 / LOW 4) · **오탐 5 기각** · **가치 있는 개선점 15** (기각 3).
**기지 항목 제외:** SDD 장부의 DEFER Minor들, Dependabot 취약점, keytar deprecated(safeStorage 마이그레이션 후보)는 기존 추적 중 — 이 리포트에 중복 수록하지 않음.

---

## 확정 버그 — HIGH (6)

### H1. [connector] 클라우드 노트 검증 실패가 익명 `catch {}`로 삼켜짐 — max_tokens 잘림 원인 진단 불가
`desktop/src/main/connector/claude-notes.ts:155` · conf: high
긴 자막(700k 한도 근처)의 노트 JSON이 max_tokens=16000을 초과해 중간에서 잘리면(stop_reason='max_tokens', 현재 미관측) JSON.parse가 던지고 익명으로 잡혀 사유가 소실된다. CHUNK_FAILED가 확립한 `:<사유>` 진단 컨벤션 회귀.
**Fix:** 잡은 에러를 CONNECTOR_BAD_RESPONSE에 `:<reason>` 접미로 스레딩 + CloudMessageResponse에 stop_reason 추가.

### H2. [connector] 재시도가 바이트 동일 요청 재전송 — 잘림이면 재시도도 동일하게 실패 (과금 2배)
`desktop/src/main/connector/claude-notes.ts:125` · conf: medium
attempt 1이 max_tokens 잘림이면 attempt 2도 동일 프롬프트/캡으로 동일하게 잘림 — 유저 돈만 2배 소모.
**Fix:** stop_reason 검사 → 'max_tokens'면 재시도 대신 즉시 구분된 에러(또는 캡 상향 재시도). spec의 "repair instruction" 의도 복원.

### H3. [connector] ConnectorView 뒤로가기가 항상 녹음 화면으로 — family-picker 업셀에서 진입 시 라이브 세션 고아화
`desktop/src/renderer/App.tsx:377` · conf: high
녹음 정지 → 피커의 업셀로 연결 → 戻る → 피커로 돌아오지 않고 유휴 녹음 화면. 정지된 세션의 파이널라이즈 선택지가 사라짐 (자막은 History로 복구 가능 — 데이터 손실 아님, UX 흐름 버그).
**Fix:** 진입 출처(returnTo)를 기억해 복귀.

### H4. [stt] 반복-붕괴 필터가 침묵으로 분리된 정당한 3회+ 반복 발화를 삭제
`desktop/src/main/engines/segment-filters.ts:95` · conf: high
"테스트… 테스트… 테스트" 같은 실제 반복 발화가 디코더-루프 반복과 구분 없이 붕괴됨.
**Fix:** 시간 근접성(직전 세그먼트와 수 초 이내) 조건 추가 — 디코더 루프 케이던스와 실제 발화 간 침묵을 구분.

### H5. [engines] 모델 load/unload에 타임아웃 부재 — TIMEOUTS 예산·에러코드가 선언만 되고 미사용
`desktop/src/main/engines/llama-cpp-llm.ts:13` · conf: high
8GB 타깃에서 스톨된 mmap/손상 GGUF/FS 행이면 finalize가 영구 행 (idle-stop도 genInFlight 때문에 못 죽임).
**Fix:** 선언된 TIMEOUTS.*_LOAD_MS/UNLOAD_MS로 client.send를 래핑, 만료 시 대응 TIMEOUT_CODES throw.

### H6. [note-pipeline] GBNF가 Zod `.max()` 문자열 상한을 전파 안 함 — 초과 출력이 통짜 CHUNK_FAILED/재시도 낭비
`desktop/src/shared/note-schema/zod-to-gbnf.ts:120` · conf: high
문법상 유효하지만 `.max()` 초과한 장문 필드(밀도 높은 JA 인터뷰 답변)가 Stage 4에서 too_big → 청크 전체 재시도.
**Fix:** ZodString .max(N)을 GBNF 수량자로 전파(배열 상한과 동일 처리), 또는 포스트디코드에서 상한 절단.

## 확정 버그 — MEDIUM (18)

| # | 영역 | 요지 (위치) |
|---|---|---|
| M1 | main | `session/start` 레이스: 사이드카 재기동 대기(≤5s) 중 두 invocation이 SESSION_ACTIVE 가드 통과 → WavWriter fd 누수 (`ipc.ts:953`, 렌더러 리로드로 재현 가능) |
| M2 | main | `models/download` 핸들러 in-flight 가드 부재 — 동일 .part 파일/locations.json 경합 (`model-downloader.ts:127`) |
| M3 | main | 덤프 20개 프루닝이 뷰어에 열려 있는 덤프도 삭제 가능 (`session-debug-dump.ts:81`) |
| M4 | renderer | 백그라운드 노트 완료 시 Recording의 히스토리 목록이 갱신 안 됨 (`Recording.tsx:158`) |
| M5 | renderer | **SystemAudioUnavailableNotice가 JA 앱 안에서 한국어 하드코딩** (`SystemAudioUnavailableNotice.tsx:12`) |
| M6 | pipeline | meeting dedup: 앵커(숫자/카타카나/라틴) 없는 원자는 완전 동일 반복도 병합 안 됨 (`meeting/dedup.ts:89`) |
| M7 | pipeline | MeetingNote.participants가 어떤 경로로도 채워질 수 없음 — 스키마/렌더러만 존재 (`meeting/assemble.ts:137`) |
| M8 | pipeline | Stage-2.5 drop 목록에 lecture key_terms[].definition 누락 — 빈 정의 하나가 청크 전체 실패 (`post-decode/pipeline.ts:78`) |
| M9 | stt | 글로서리 initial_prompt가 세션 언어 무관 주입 — JA 용어가 EN/KO 전사를 편향 (`ipc.ts:287`) |
| M10 | errors | AUDIO_WRITE_FAILED/WAV_MISSING/EMPTY_RECORDING/STT_MODEL_MISSING/FINALIZE_IN_FLIGHT가 에러맵에 없음 → 원시 코드 노출 (`error-message-map.ts:22`) |
| M11 | connector | 키 검증 catch-all이 레이트리밋/5xx를 "키 무효"로 오분류 (`connector/ipc.ts:20`) — 유효한 키를 가진 유저가 잘못된 안내 수신 |
| M12 | connector | M11과 동근원: defaultValidateKey가 claude-errors의 검증된 분류기 대신 조악한 2-분기 자체 구현 (`connector/ipc.ts:14`) → classifyCloudError 재사용으로 동시 해결 |
| M13 | connector | classifyCloudError 폴백이 529/500 서버 혼잡을 CONNECTOR_BAD_RESPONSE("결과를 읽을 수 없음")로 혼동 (`claude-errors.ts:34`) — 서버혼잡 전용 코드+JA 카피 필요 |
| M14 | connector | 5분 타임아웃이 max_tokens=16000의 SDK 자체 최악 예산(~10분)을 하회 — 느리지만 성공(과금)할 생성을 클라이언트가 중단 (`claude-notes.ts:40`) |
| M15 | connector | History에서 Claude로 재생성한 (유료) 노트가 디스크에 저장 안 됨 — 뷰 이탈 = 재과금 (`dump-finalize-context.ts:85`) |
| M16 | perf | 클라우드 대기 전체(≤10분)가 idle-stop을 막아 유휴 사이드카가 상주 (`ipc.ts:213`) |
| M17 | ipc | 클라우드 finalize의 pre-STT CONNECTOR_NO_KEY 경로가 "Stop은 항상 current를 해제" 불변식을 깸 (`session-finalize.ts:403`) |
| M18 | errors | connectorStatus() 키체인 실패 시 무처리 — 연결됐는데 '미연결'로 고착 (`claude-auth.ts:17`) |

## 확정 버그 — LOW (4)

- L1 [renderer] App.tsx:151 connectorStatus() mount fetch에 .catch 없음 → unhandled rejection
- L2 [cpp] llama_token_to_piece 음수 반환 미검사 — 토큰 무성 드롭 (Sarashina 등 토크나이저 교체 시 위험, `llama_engine.cpp:316`)
- L3 [ipc] buildDumpTranscriptContext가 language를 무검증 캐스팅 (형제 함수는 검증함, `dump-finalize-context.ts:93`)
- L4 [ui] 모델 다운로드 진행바가 2번째 슬롯 시작 시 뒤로 점프 (`ModelDownloadStep.tsx:121`)

## 가치 있는 개선점 (15 — 검증 통과)

**죽은 코드 삭제 (하우스 룰 9 — 6건):**
1. `NoteRenderProgress` 컴포넌트 전체 미사용 (formatElapsed/ProgressState만 소비됨) — 삭제+이동
2. meeting/interview/brainstorm의 `chunkUserTemplate` 미호출 — 삭제
3. `SessionOrchestrator.sttInitialPrompt` 계산만 되고 미소비 — 삭제 (`orchestrator.ts:569`, `ipc.ts:913`)
4. `consolidateMeetingNote` + `meetingMergeStrategy` — 추출-기반 파이프라인 전환 잔재
5. `hydratePostDecode`/`assignBrainstormIdeaIds` — runPostDecodePipeline과 의미 분기된 구현 잔존
6. `silence-gate.ts` 전체 미사용 (orchestrator가 동일 수식 중복 보유)

**보안/구조 (핵심 4건):**
7. **BrowserWindow: sandbox:false + CSP 부재 + navigation/new-window 가드 부재** (`main/index.ts:151`) — Electron 권장 기본 이탈, 사유 주석도 없음
8. 클라우드 텔레메트리(model/durationMs/attempts) 계산 후 폐기 — 유료 API 진단 불가 (`session-finalize.ts:361`)
9. **Structured Outputs (`zodOutputFormat`, 설치된 SDK 0.91에 GA) 미사용** — 수제 펜스 스트리핑+JSON.parse 대체 가능, H1/H2 원인 계열 제거
10. cloud-prompt가 청크-프레이밍 문구("チャンクを受け取ります")를 그대로 재사용 — 전체 자막 1회 호출과 모순되는 프롬프트

**기타 (5건):** 커넥터 채널명 이중 정의 단일화 · fillProvenanceRecursive 문서-불변식 이미 거짓 (quotable_lines) · 캡처 sampleRate 불일치 무검증 · suggestGlossaryTerms 문서가 폐지된 confirm-gate 서술 · transcript 선택 시 타겟 피커 표시됨

## 기각된 오탐 (5 — 검증이 걸러냄)

ConnectorView 자막 영구손실 주장(복구 경로 존재) · whisper 빈 배열=침묵 구분 불가(상위에서 처리) · llama 디코드 잘림 프로토콜 비가시(이미 이벤트 있음) · dump-title 순회 가드 누락(실제로는 안전) · cloud meeting 프롬프트 청크 문구(→개선점 10으로 재분류)

---

## 권장 수정 순서

- **P0 — PR #158 머지 전 커넥터 팩 (H1·H2·H3 + M11-M15·M17·M18·L1):** 전부 신규 커넥터 코드라 지금 고치면 리뷰/스모크 1사이클로 흡수. 특히 M15(유료 재생성 미저장)·H2(과금 2배)는 돈 문제.
- **P1 — 안정성 팩 (H4·H5·H6 + M1-M3·M10):** 별도 fix 브랜치.
- **P2 — 나머지 MEDIUM/LOW + 개선점:** 죽은코드 삭제(기계적) → 보안 하드닝(sandbox/CSP) → Structured Outputs 전환.
