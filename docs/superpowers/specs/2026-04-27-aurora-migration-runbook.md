# Aurora Migration Runbook (RDS db.t3.micro → Aurora Serverless v2)

> **상태**: 미실행 (트리거 도달 시 활성화)
> **작성일**: 2026-04-27
> **참조 PRD**: `2026-04-26-online-learning-summary-extension-design.md` §4.5

---

## 0. When to Trigger

다음 중 하나라도 만족 시 마이그레이션 검토:

- [ ] 동시 사용자 50명 초과 (3일 연속)
- [ ] DB CPU 평균 60% 초과 (1주 지속)
- [ ] 가용성 SLO < 99.5% 필요해짐 (Pro 사용자 SLA 약속 등)
- [ ] 피크 트래픽 ↑ 200% (시험 기간 / 마케팅 캠페인 등)
- [ ] 12개월 Free Tier 만료 + idle 비용 절감 우선순위 ↑ (Aurora scale-to-zero가 더 저렴)

**비추천 시점**:
- Pro 사용자 첫 세션이 진행 중인 시간대
- 신규 기능 배포 직전 / 직후
- 일본 대학 시험 기간 한복판

**추천 시점**:
- 새벽 3~5시 JST (사용자 거의 없음)
- 주말 아침
- 사전 사용자 공지 (24h 전 메일) 후

---

## 1. Migration Method: Read-Replica Promotion

### 개요
1. RDS db.t3.micro를 source로 두고 Aurora를 read-replica로 생성
2. 복제 동기화 완료 대기
3. App을 잠깐 정지 (~30초)
4. Aurora를 master로 promote
5. App 환경변수를 Aurora endpoint로 변경
6. RDS는 1주 보관 후 삭제

**예상 다운타임**: 30초~2분

**예상 데이터 손실**: 0

### 왜 이 방법인가
- 다른 방법(snapshot restore, DMS)보다 다운타임이 짧음
- RDS Postgres → Aurora Postgres는 같은 엔진이라 호환 100%
- AWS Console에서 「Create read replica」 클릭으로 시작 가능

---

## 2. Pre-Migration Checklist (마이그레이션 7일 전)

- [ ] **Backup 확인**: RDS 자동 백업이 최근 24h 내에 있는가?
- [ ] **사용자 공지**: 메일/Discord/X로 마이그레이션 시간 공지
- [ ] **테스트 환경 리허설**: dev/staging 계정에서 동일 절차 1회 수행
- [ ] **롤백 계획 작성**: 만약 promotion 후 문제 시 RDS로 복귀하는 절차 (env 변수만 되돌리면 됨, 아래 §6)
- [ ] **CDK 코드 PR 준비**: `data-stack.ts`를 Aurora로 되돌리는 변경 (아래 §3)
- [ ] **모니터링 대시보드**: CloudWatch에 RDS+Aurora 양쪽 메트릭 표시
- [ ] **Stripe webhook URL 변경 불필요 확인**: API endpoint는 동일 (Aurora 변경은 Lambda 레벨에 영향 없음)

---

## 3. CDK 코드 변경 (사전 작성, 마이그레이션 시 PR merge)

`backend/infra/lib/data-stack.ts`를 다음으로 교체:

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
  readonly db: DatabaseCluster   // Note: rename or keep `db` for less churn
  readonly dbSecret: Secret

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'AssetsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,        // ⚠️ production: don't auto-delete
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

    this.db = new DatabaseCluster(this, 'Db', {
      engine: DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_16_6 }),
      writer: ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0,                // scale-to-zero
      serverlessV2MaxCapacity: 4,                // 트래픽 늘면 4 ACU까지
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      credentials: Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: 'studyhelper',
      securityGroups: [dbSg],
      removalPolicy: RemovalPolicy.SNAPSHOT,     // ⚠️ production: snapshot before destroy
      backup: { retention: Duration.days(35) },
    })
  }
}
```

⚠️ 본 코드를 그대로 deploy하면 RDS가 **삭제되고** Aurora가 새로 생성됨 — 데이터 손실. 반드시 §4 절차를 통해 read-replica로 데이터 이전 후 코드 변경 deploy.

---

## 4. Migration Execution Steps

### Day -7 ~ Day -1
- 사용자에게 마이그레이션 시간 공지 (메일 + 익스텐션 내 toast)
- staging 환경에서 동일 절차 리허설
- 롤백 계획 검토

### Day 0 (마이그레이션 당일)

#### Step 4.1 — Aurora Read-Replica 생성 (10~30분)

AWS Console:
1. **RDS** → **Databases** → 현재 RDS 인스턴스 선택
2. **Actions** → **Create Aurora read replica**
3. 다음 설정:
   - **Engine version**: PostgreSQL 16.4 (또는 그 이상)
   - **DB instance class**: Aurora Serverless v2
   - **Capacity range**: 0 ~ 4 ACU
   - **VPC**: 동일 VPC (network-stack에서 만든 것)
   - **Subnet group**: PRIVATE_WITH_EGRESS subnets
   - **Security group**: 기존 `DbSg` 재사용
   - **Database authentication**: 기존 Secrets Manager secret 연결
4. **Create read replica** 클릭

또는 AWS CLI:
```bash
aws rds create-db-cluster \
  --db-cluster-identifier studyhelper-aurora \
  --engine aurora-postgresql \
  --engine-version 16.4 \
  --replication-source-identifier <RDS_INSTANCE_ARN> \
  --vpc-security-group-ids <DbSg_ID> \
  --db-subnet-group-name <SUBNET_GROUP> \
  --master-username studyhelper \
  --master-user-password <generated> \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=4
```

#### Step 4.2 — 복제 동기화 모니터링 (5~30분)

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier studyhelper-aurora \
  --query 'DBClusters[0].Status'
```

`available` 상태 + `ReplicaLag = 0` 확인. CloudWatch에서 `AuroraReplicaLag` 메트릭이 0이 될 때까지 대기.

#### Step 4.3 — Cutover (다운타임 시작 ~30초)

```bash
# 1. App을 maintenance 모드로 전환
#    (api-stack에 임시로 503 반환하는 maintenance flag, 또는 익스텐션이 toast 표시)

# 2. 모든 in-flight 요청이 끝날 때까지 ~5초 대기

# 3. RDS read 트래픽 정지 (Aurora의 replica lag = 0 재확인)

# 4. Aurora를 standalone cluster로 promote
aws rds promote-read-replica-db-cluster \
  --db-cluster-identifier studyhelper-aurora

# 5. promote 완료 대기 (보통 ~30초)
aws rds wait db-cluster-available --db-cluster-identifier studyhelper-aurora

# 6. Aurora endpoint 확인
aws rds describe-db-clusters \
  --db-cluster-identifier studyhelper-aurora \
  --query 'DBClusters[0].Endpoint'
```

#### Step 4.4 — App 환경변수 갱신 (1~2분)

방법 A — Secrets Manager 갱신 (권장):
```bash
# 새 endpoint를 secret에 반영
aws secretsmanager put-secret-value \
  --secret-id <DB_SECRET_ARN> \
  --secret-string '{"username":"studyhelper","password":"<existing>","host":"<aurora-endpoint>","port":5432,"dbname":"studyhelper"}'
```

이후 Lambda는 `loadAppSecrets()` 다음 호출 시 새 endpoint를 자동으로 사용. 진짜 cold start까지 좀 걸리면 모든 Lambda를 한 번 invoke하거나 환경변수에 가짜 값을 추가/삭제해 강제 재시작.

방법 B — CDK 재배포 (수 분 추가 다운타임):
```bash
git checkout aurora-migration-branch
cd backend && pnpm deploy
```

#### Step 4.5 — 검증 (10~30분)

- [ ] `/v1/health` 엔드포인트 200 OK
- [ ] `/v1/auth/me` 토큰 검증 성공
- [ ] 테스트 영상 1개로 stream-audio → 노트 생성 확인
- [ ] session-finalize → PDF 다운로드 성공
- [ ] CloudWatch에 ERROR 로그 급증 없음
- [ ] DB CPU < 30% (Aurora 0.5 ACU 기준)

#### Step 4.6 — 사용자에게 정상화 공지

- 익스텐션 toast / 메일 / Discord로 "정상 운영 재개" 알림

#### Step 4.7 — RDS 인스턴스 보관 후 정리

- **첫 7일**: RDS 인스턴스를 stopped 상태로 두고 모니터링 (롤백 가능)
- **7일 후 정상이면**: RDS final snapshot 생성 후 인스턴스 삭제
- **CDK 코드**: `data-stack.ts`를 §3 Aurora 버전으로 PR merge + deploy

---

## 5. Verification Plan

### 마이그레이션 직후 (1시간)
- 모든 핸들러 헬스체크
- 첫 사용자 요청 처리 확인
- CloudWatch 로그에서 DB connection error 0건 확인

### 마이그레이션 후 24시간
- 평균 응답 시간이 마이그레이션 전 baseline 대비 ±10% 이내
- 백업 자동 생성 확인
- Cost Explorer에서 RDS 청구 0, Aurora 청구 시작 확인

### 마이그레이션 후 7일
- 사용자 보고된 이슈 트리아지
- Aurora ACU 사용 패턴 분석 (auto-pause 정상 동작?)

---

## 6. Rollback Plan

만약 §4.5 검증에서 실패가 발견되면:

#### 즉시 롤백 (Aurora promote 직후 30분 이내)

```bash
# 1. App을 maintenance 모드로
# 2. Secrets Manager의 host를 RDS endpoint로 되돌림
aws secretsmanager put-secret-value \
  --secret-id <DB_SECRET_ARN> \
  --secret-string '{"username":"studyhelper","password":"<existing>","host":"<rds-endpoint>","port":5432,"dbname":"studyhelper"}'
# 3. Lambda 재시작 (환경변수 더미 변경 후 deploy)
# 4. 검증 → 정상화 공지
# 5. Aurora cluster 삭제
```

⚠️ promote 후 들어온 새 데이터는 손실됨 — 그래서 cutover 동안 maintenance 모드가 중요.

#### Delayed 롤백 (Aurora 운영 ≥24h 이후)

이 시점엔 Aurora에 새 데이터 누적됨. 단순 endpoint 변경으론 불가능. DMS 또는 pg_dump → restore 절차 필요. 별도 runbook 작성 필요.

→ **마이그레이션 후 24h 안에 결판 짓는 게 핵심.**

---

## 7. Cost Impact

### Before (RDS db.t3.micro, Free Tier)
- DB 인스턴스: $0/월 (12개월 free) → $13/월 (이후)
- 스토리지 20GB: $0/월 (free) → $2/월 (이후)
- 백업 7일: $0/월 (free) → $1/월 (이후)
- **합계 12개월 후: ~$16/월**

### After (Aurora Serverless v2, scale-to-zero)
- ACU 사용 시간: 평균 0.5 ACU × 12h × 30일 × $0.12 = $22/월 (idle 시간 만큼은 0)
- 스토리지 20GB: $2/월
- 백업 35일: $4/월
- **합계 평균: ~$28/월**

**추가 비용 약 $12/월** — 트래픽 급증 시 자동 확장 + 가용성 향상 + PITR 35일을 그 가격에 받음.

만약 사용자 수가 많아 ACU가 평균 1+ ACU 유지되면 Aurora가 RDS db.t3.small ($30/월) 보다 비싸짐. 그 시점엔 Aurora reserved capacity 또는 RDS Multi-AZ로 재검토.

---

## 8. Sign-off

마이그레이션 완료 시:
- [ ] 본 runbook 끝에 **실제 실행 일자 + 다운타임 측정값** 기록
- [ ] PRD §4.5 업데이트 (상태: "MVP" → "Aurora 운영 중", 마이그레이션 완료 시점 기록)
- [ ] Open Decisions 섹션에서 해당 항목 제거

### 실행 기록 (마이그레이션 완료 시 채워질 영역)

- 실행 일자: TBD
- 시작 시각: TBD
- Cutover 다운타임: TBD
- 사후 이슈: TBD
- 롤백 발생 여부: TBD
- 담당자: TBD
