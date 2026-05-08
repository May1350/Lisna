# Lisna 운영 가이드

솔로 운영용 최소 단위. 어드민 페이지 대신 AWS Console + SQL 직접 사용.

## 1. 에러 모니터링 (CloudWatch Insights)

[CloudWatch Logs Insights →](https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#logsV2:logs-insights)

로그 그룹: `/aws/lambda/StudyHelperApi-ErrorReportFn-*`

### 자주 쓰는 쿼리

**최근 24시간 fatal 에러:**
```
fields @timestamp, message, context, userId, extensionVersion
| filter type = "CLIENT_ERROR" and severity = "fatal"
| sort @timestamp desc
| limit 100
```

**특정 사용자의 모든 에러:**
```
fields @timestamp, message, context, severity, url
| filter type = "CLIENT_ERROR" and userId = "<user-uuid>"
| sort @timestamp desc
```

**컨텍스트별 에러 통계 (어디가 가장 잘 깨지나):**
```
fields context
| filter type = "CLIENT_ERROR"
| stats count() as occurrences by context
| sort occurrences desc
```

**Extension 버전별 에러율 (배포 회귀 감지):**
```
fields extensionVersion
| filter type = "CLIENT_ERROR" and severity in ["fatal", "error"]
| stats count() as errors by extensionVersion
| sort errors desc
```

## 2. CloudWatch 알람

### 활성 알람

- **`lisna-fatal-client-errors`** — fatal 에러 5건/10분 이상 시 발동
- 위치: [CloudWatch Alarms →](https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#alarmsV2:)

### 이메일 알림 등록

```bash
# 1. SNS 토픽 생성
aws sns create-topic --name lisna-alarms --region ap-northeast-1

# 2. 알람에 액션 추가 (CloudWatch Console에서 위 토픽 선택)

# 3. 이메일 구독
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-1:277304862504:lisna-alarms \
  --protocol email \
  --notification-endpoint takgun.jr@gmail.com

# 4. 받은 메일에서 confirm 클릭
```

## 3. DB 직접 조회 (psql 또는 RDS Data API)

### 자주 쓰는 SQL

**최근 가입한 유저:**
```sql
SELECT id, email, plan, created_at
FROM users
ORDER BY created_at DESC
LIMIT 20;
```

**유저별 사용량 (이번 달):**
```sql
SELECT u.email, u.plan, q.minutes_used, q.period
FROM users u
LEFT JOIN quota q ON u.id = q.user_id
WHERE q.period = TO_CHAR(NOW(), 'YYYY-MM')
ORDER BY q.minutes_used DESC NULLS LAST
LIMIT 20;
```

**활성 세션 (현재 실시간 진행 중):**
```sql
SELECT s.id, u.email, s.url, s.created_at
FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE s.status = 'active' AND s.created_at > NOW() - INTERVAL '2 hours'
ORDER BY s.created_at DESC;
```

**최근 7일간 세션 수:**
```sql
SELECT DATE(created_at) AS day, COUNT(*) AS sessions
FROM sessions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;
```

**Pro 전환률 (가입 → Pro 업그레이드):**
```sql
SELECT
  COUNT(*) FILTER (WHERE plan = 'pro') AS pro_users,
  COUNT(*) AS total_users,
  ROUND(100.0 * COUNT(*) FILTER (WHERE plan = 'pro') / NULLIF(COUNT(*), 0), 1) AS pct
FROM users;
```

### 접속 방법

DB 접속은 SSH bastion 또는 VPC peering 필요. 빠르게 1회성 쿼리만 필요하면 RDS Data API:
```bash
aws rds-data execute-statement \
  --resource-arn $(aws cloudformation describe-stacks --stack-name StudyHelperData --query "Stacks[0].Outputs[?OutputKey=='DbInstanceArn'].OutputValue" --output text) \
  --secret-arn $(aws cloudformation describe-stacks --stack-name StudyHelperSecrets --query "Stacks[0].Outputs[?OutputKey=='DbSecretArn'].OutputValue" --output text) \
  --database studyhelper \
  --sql "SELECT COUNT(*) FROM users"
```

(Data API가 활성화 안 되어 있으면 RDS 인스턴스 설정에서 켜야 함)

## 4. 비용 모니터링

### 일일 체크 포인트

| 서비스 | 어디서 보나 |
|---|---|
| AWS 전체 비용 | [Cost Explorer](https://console.aws.amazon.com/cost-management/home#/cost-explorer) |
| OpenAI API (STT) | [platform.openai.com/usage](https://platform.openai.com/usage) |
| Google AI (curator) | [aistudio.google.com/usage](https://aistudio.google.com/usage) |
| Stripe 매출 | [dashboard.stripe.com](https://dashboard.stripe.com) |

### 비용 알람 (AWS Budgets)

월 예산 초과 시 이메일 알림 — 출시 전 반드시 설정:
```bash
# 월 $50 임계 알람 예시
aws budgets create-budget \
  --account-id 277304862504 \
  --budget '{"BudgetName":"lisna-monthly","BudgetLimit":{"Amount":"50","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"takgun.jr@gmail.com"}]}]'
```

## 5. 비상 대응

### 사용자가 quota 초과로 막힘 신고

```sql
-- 강제 quota 리셋 (한 번만)
UPDATE quota SET minutes_used = 0 WHERE user_id = '<uuid>' AND period = TO_CHAR(NOW(), 'YYYY-MM');
```

### 사용자가 데이터 삭제 요청 (GDPR-ish)

```sql
-- 단계적 삭제: notes → sessions → users
DELETE FROM notes WHERE session_id IN (SELECT id FROM sessions WHERE user_id = '<uuid>');
DELETE FROM sessions WHERE user_id = '<uuid>';
DELETE FROM quota WHERE user_id = '<uuid>';
DELETE FROM users WHERE id = '<uuid>';
```

### 백엔드 폭주로 비용 급증

긴급 차단 — Lambda 동시 실행 1로 제한:
```bash
aws lambda put-function-concurrency \
  --function-name <function-name> \
  --reserved-concurrent-executions 1
```
