# Sourced by the backup scripts: turns the HETZNER_S3_* settings into what the
# AWS CLI expects, and defines `s3` (the AWS CLI pointed at Hetzner).
# shellcheck shell=bash

: "${HETZNER_S3_ENDPOINT:?}" "${HETZNER_S3_REGION:?}" "${HETZNER_S3_BUCKET:?}"
: "${HETZNER_S3_ACCESS_KEY:?}" "${HETZNER_S3_SECRET_KEY:?}"

case "$HETZNER_S3_ENDPOINT" in
  http://*|https://*) S3_ENDPOINT="$HETZNER_S3_ENDPOINT" ;;
  *) S3_ENDPOINT="https://$HETZNER_S3_ENDPOINT" ;;
esac
# shellcheck disable=SC2034 # used by the scripts that source this file
S3_BUCKET="$HETZNER_S3_BUCKET"
# The folder inside the bucket; no leading or trailing slashes.
S3_PREFIX="${HETZNER_S3_ROOT_FOLDER:-planner}"
S3_PREFIX="${S3_PREFIX#/}"
S3_PREFIX="${S3_PREFIX%/}"

export AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="$HETZNER_S3_REGION"
# AWS CLI 2.23+ adds checksums by default that some S3-compatible stores
# reject; only send them when the operation requires it.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

s3() { "${AWS_BIN:-aws}" --endpoint-url "$S3_ENDPOINT" "$@"; }
