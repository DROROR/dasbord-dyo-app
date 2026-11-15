#!/usr/bin/env bash
# One-time setup of the backup bucket: turns on versioning (so an overwrite
# never destroys a backup) and the retention rule that deletes backups after
# 8 days, i.e. keeps 7 full days plus today. Safe to run again.
#
#   apply-bucket-rules.sh [--env <file>]
set -Eeuo pipefail

ENV_FILE="$HOME/.config/dyo-planner/backup.env"
if [ "${1:-}" = "--env" ]; then ENV_FILE="$2"; fi
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
# shellcheck source=s3-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/s3-env.sh"

s3 s3api put-bucket-versioning --bucket "$S3_BUCKET" \
  --versioning-configuration Status=Enabled

rules="$(cat <<EOF
{
  "Rules": [
    {
      "ID": "planner-7-days",
      "Filter": { "Prefix": "$S3_PREFIX/" },
      "Status": "Enabled",
      "Expiration": { "Days": 8 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 8 }
    },
    {
      "ID": "planner-test-cleanup",
      "Filter": { "Prefix": "$S3_PREFIX-test/" },
      "Status": "Enabled",
      "Expiration": { "Days": 1 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 1 }
    }
  ]
}
EOF
)"
s3 s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
  --lifecycle-configuration "$rules"

echo "versioning: $(s3 s3api get-bucket-versioning --bucket "$S3_BUCKET" --query Status --output text)"
echo "lifecycle rules:"
s3 s3api get-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
  --query 'Rules[].[ID, Filter.Prefix, Expiration.Days, Status]' --output text
