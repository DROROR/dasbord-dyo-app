#!/usr/bin/env bash
# Nightly backup of the Planner to Hetzner Object Storage: the whole database
# (public, auth, storage schemas) as one pg_dump file, every Supabase Storage
# file, and a manifest.json uploaded LAST, so a folder without a manifest is
# never a good backup. The bucket's lifecycle rule deletes backups after 8 days.
#
#   planner-backup-s3.sh [--env <file>]
#
# Settings: ~/.config/dyo-planner/backup.env (see backup.env.example).
# Log: $LOCAL_DIR/backup.log. Last good backup: $LOCAL_DIR/latest/.
set -Eeuo pipefail
umask 077

ENV_FILE="$HOME/.config/dyo-planner/backup.env"
if [ "${1:-}" = "--env" ]; then ENV_FILE="$2"; fi
export LC_ALL=C.UTF-8

# Log first, so even a broken settings file leaves a trace.
LOCAL_DIR="$HOME/planner-s3-backups"
mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"
exec >> "$LOCAL_DIR/backup.log" 2>&1
STEP=settings
on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] || echo "$(date -Is) FAILED at step $STEP (exit $rc)"
}
trap on_exit EXIT

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

: "${PG_HOST:?}" "${PG_PORT:?}" "${PG_USER:?}" "${PG_DB:?}" "${PGPASSFILE:?}"
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
: "${HETZNER_S3_ENDPOINT:?}" "${HETZNER_S3_REGION:?}" "${HETZNER_S3_BUCKET:?}"
: "${HETZNER_S3_ACCESS_KEY:?}" "${HETZNER_S3_SECRET_KEY:?}"

case "$HETZNER_S3_ENDPOINT" in
  http://*|https://*) S3_ENDPOINT="$HETZNER_S3_ENDPOINT" ;;
  *) S3_ENDPOINT="https://$HETZNER_S3_ENDPOINT" ;;
esac
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
s3() { "${AWS_BIN:-aws}" --endpoint-url "$S3_ENDPOINT" s3 "$@" --only-show-errors; }

NODE_BIN="${NODE_BIN:-node}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGCONNECT_TIMEOUT=15

exec 9>"$LOCAL_DIR/.lock"
if ! flock -n 9; then
  echo "$(date -Is) another backup is already running; exiting"
  exit 75
fi

STEP=start
PSQL=(psql -w -X -q -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB")
DATE="$(TZ=Asia/Jerusalem date +%F)"
WORK="$LOCAL_DIR/work-$DATE"
rm -rf "$LOCAL_DIR"/work-*
mkdir -p "$WORK/storage"
STARTED_AT="$(date -u +%FT%TZ)"
echo "$(date -Is) backup $DATE starting"

STEP=dump
pg_dump -w -Fc --lock-wait-timeout=120s --schema=public --schema=auth --schema=storage \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -f "$WORK/db.dump"

STEP=verify-dump
pg_restore --list "$WORK/db.dump" > "$WORK/toc.txt"
"${PSQL[@]}" -tAc "select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' order by 1" > "$WORK/live-tables.txt"
awk '$4=="TABLE" && $5=="DATA" && $6=="public" {print $7}' "$WORK/toc.txt" | LC_ALL=C sort > "$WORK/dumped-tables.txt"
missing="$(LC_ALL=C comm -23 <(LC_ALL=C sort "$WORK/live-tables.txt") "$WORK/dumped-tables.txt")"
if [ -n "$missing" ]; then
  echo "tables missing from the dump: $missing"
  exit 1
fi
grep -q ' TABLE DATA auth users ' "$WORK/toc.txt" || { echo "auth.users missing from the dump"; exit 1; }
grep -q ' TABLE DATA storage objects ' "$WORK/toc.txt" || { echo "storage.objects missing from the dump"; exit 1; }

STEP=count-rows
TABLE_COUNTS="$("${PSQL[@]}" -tAc "select coalesce(json_object_agg(table_name,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint
    order by table_name), '{}')
  from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
AUTH_USERS="$("${PSQL[@]}" -tAc "select count(*) from auth.users")"
PG_VERSION="$("${PSQL[@]}" -tAc "show server_version")"

DEST="s3://$HETZNER_S3_BUCKET/$S3_PREFIX/$DATE"
# The database goes up first: a Storage problem must never cost us it.
STEP=upload-dump
s3 cp "$WORK/db.dump" "$DEST/db.dump"

STEP=storage
"${PSQL[@]}" -tA -F $'\t' -c "select bucket_id, name, coalesce((metadata->>'size')::bigint, 0)
  from storage.objects where name is not null order by 1, 2" > "$WORK/storage-list.tsv"
STORAGE_SUMMARY="$("${PSQL[@]}" -tAc "select coalesce(json_object_agg(bucket_id,
    json_build_object('files', n, 'bytes', b) order by bucket_id), '{}')
  from (select bucket_id, count(*) n, coalesce(sum((metadata->>'size')::bigint), 0) b
        from storage.objects where name is not null group by 1) s")"
"$NODE_BIN" "$SCRIPT_DIR/storage-export.mjs" --list "$WORK/storage-list.tsv" \
  --out "$WORK/storage" --url "$SUPABASE_URL" > "$WORK/storage-export.json"
echo "storage export: $(cat "$WORK/storage-export.json")"
# Belt and braces: every listed object must be on disk.
LISTED="$(wc -l < "$WORK/storage-list.tsv" | tr -d ' ')"
ON_DISK="$(find "$WORK/storage" -type f | wc -l | tr -d ' ')"
if [ "$LISTED" != "$ON_DISK" ]; then
  echo "storage: $LISTED objects listed but $ON_DISK files on disk"
  exit 1
fi

STEP=manifest
DUMP_BYTES="$(stat -c %s "$WORK/db.dump")"
DUMP_SHA="$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)"
cat > "$WORK/manifest.json" <<EOF
{
  "date": "$DATE",
  "started_at": "$STARTED_AT",
  "finished_at": "$(date -u +%FT%TZ)",
  "pg_server_version": "$PG_VERSION",
  "dump_bytes": $DUMP_BYTES,
  "dump_sha256": "$DUMP_SHA",
  "tables": $TABLE_COUNTS,
  "auth_users": $AUTH_USERS,
  "storage": $STORAGE_SUMMARY
}
EOF
"$NODE_BIN" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$WORK/manifest.json"

STEP=upload-storage
if [ -n "$(ls -A "$WORK/storage")" ]; then
  s3 cp "$WORK/storage" "$DEST/storage/" --recursive
fi
STEP=upload-manifest
s3 cp "$WORK/manifest.json" "$DEST/manifest.json"

STEP=finish
rm -rf "$LOCAL_DIR/latest"
mv "$WORK" "$LOCAL_DIR/latest"
echo "$(date -Is) backup $DATE done: $(du -sh "$LOCAL_DIR/latest" | cut -f1), $(wc -l < "$LOCAL_DIR/latest/storage-list.tsv" | tr -d ' ') files"
