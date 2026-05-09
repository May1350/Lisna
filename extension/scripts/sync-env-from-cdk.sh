#!/usr/bin/env bash
# Sync extension/.env.production with live CloudFormation outputs.
#
# Why this exists: CDK redeploys can destroy+recreate Lambda resources
# (e.g. SessCurateFn → new Function URL host). When that happens the
# .env.production CURATE_URL silently goes stale, builds embed a dead
# URL, and the extension fails with "ノート生成に失敗しました" without
# any backend log (request never reaches Lambda → no CloudWatch trace).
#
# This script reads StudyHelperApi/StudyHelperWs CFN outputs as
# ground truth and rewrites the URL lines in .env.production. Other
# lines (OAuth client ID, comments) are preserved.
#
# Usage:
#   bash extension/scripts/sync-env-from-cdk.sh        # update .env.production
#   bash extension/scripts/sync-env-from-cdk.sh --check # exit 1 if .env diverges from CFN
#
# Wired into `pnpm build` as a prebuild step so prod builds always
# embed live URLs.

set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.production"
MODE="${1:-update}"  # update | --check

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[sync-env] $ENV_FILE not found — nothing to sync" >&2
  exit 0
fi

# Pull live values from CFN outputs.
get_output() {
  local stack="$1" key="$2"
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" \
    --output text 2>/dev/null
}

API_URL=$(get_output StudyHelperApi ApiUrl)
CURATE_URL=$(get_output StudyHelperApi CurateUrl)
WS_URL=$(get_output StudyHelperWs WsUrl)

if [[ -z "$API_URL" || -z "$CURATE_URL" || -z "$WS_URL" ]]; then
  echo "[sync-env] FAIL: could not read all CFN outputs (API=$API_URL CURATE=$CURATE_URL WS=$WS_URL)" >&2
  echo "[sync-env]       run \`aws sts get-caller-identity\` to verify auth, or check stack names" >&2
  exit 1
fi

# Read current .env.production values for diff display.
read_env() {
  local key="$1"
  grep -E "^$key=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

CUR_API=$(read_env VITE_API_BASE_URL)
CUR_WS=$(read_env VITE_WS_URL)
CUR_CURATE=$(read_env VITE_CURATE_URL)

DRIFT=0
report() {
  local key="$1" cur="$2" live="$3"
  if [[ "$cur" != "$live" ]]; then
    echo "[sync-env] DRIFT: $key"
    echo "           was : $cur"
    echo "           live: $live"
    DRIFT=1
  fi
}
report VITE_API_BASE_URL "$CUR_API" "$API_URL"
report VITE_WS_URL       "$CUR_WS"  "$WS_URL"
report VITE_CURATE_URL   "$CUR_CURATE" "$CURATE_URL"

if [[ $DRIFT -eq 0 ]]; then
  echo "[sync-env] .env.production matches live CFN outputs ✓"
  exit 0
fi

if [[ "$MODE" == "--check" ]]; then
  echo "[sync-env] FAIL: .env.production has drifted from live CFN outputs (see above)" >&2
  echo "[sync-env]       run without --check to update, OR redeploy CDK if env is the truth" >&2
  exit 1
fi

# Update mode — rewrite the three URL lines in place.
python3 - "$ENV_FILE" "$API_URL" "$WS_URL" "$CURATE_URL" <<'PY'
import re, sys, pathlib
path, api, ws, curate = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
text = path.read_text()
def sub(key, val):
    global text
    text = re.sub(rf'^{re.escape(key)}=.*$', f'{key}={val}', text, flags=re.M)
sub('VITE_API_BASE_URL', api)
sub('VITE_WS_URL', ws)
sub('VITE_CURATE_URL', curate)
path.write_text(text)
PY

echo "[sync-env] .env.production updated from CFN outputs ✓"

# Sanity probe: CURATE_URL should answer (401 unauth ok, 403 = wrong host).
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$CURATE_URL" -m 5 || echo "000")
if [[ "$HTTP_CODE" == "403" || "$HTTP_CODE" == "000" ]]; then
  echo "[sync-env] WARN: CURATE_URL returned HTTP $HTTP_CODE — may be unreachable, dead host, or CFN output wrong" >&2
fi
