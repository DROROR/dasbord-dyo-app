#!/usr/bin/env bash
# Midday check: did today's Planner backup reach S3? Only a manifest.json
# counts. The nightly script uploads it last, so a half-finished run is
# reported as missing.
#
#   check-backup-fresh.sh [--env <file>]
set -Eeuo pipefail

ENV_FILE="$HOME/.config/dyo-planner/backup.env"
if [ "${1:-}" = "--env" ]; then ENV_FILE="$2"; fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
# shellcheck source=s3-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/s3-env.sh"
NODE_BIN="${NODE_BIN:-node}"

DATE="$(TZ=Asia/Jerusalem date +%F)"
if s3 s3 ls "s3://$S3_BUCKET/$S3_PREFIX/$DATE/manifest.json" >/dev/null 2>&1; then
  echo "$(date -Is) backup $DATE is in S3"
  exit 0
fi

echo "$(date -Is) NO backup in S3 for $DATE"
if [ -n "${SLACK_BACKUP_WEBHOOK_URL:-}" ]; then
  body="$("$NODE_BIN" -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' \
    "⚠️ No Planner backup in S3 for $DATE (s3://$S3_BUCKET/$S3_PREFIX/$DATE/manifest.json is missing)")"
  curl -sS --max-time 10 -H 'Content-Type: application/json' -d "$body" \
    "$SLACK_BACKUP_WEBHOOK_URL" >/dev/null || echo "slack: post failed"
fi
exit 1
