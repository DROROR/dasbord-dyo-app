#!/usr/bin/env bash
# Nightly backup of the Planner to S3: the whole database (public, auth,
# storage schemas) as one pg_dump file, every Supabase Storage file, and a
# manifest.json uploaded LAST, so a folder without a manifest is never a good
# backup. Retention (7 days) is an S3 lifecycle rule, not this script.
#
#   planner-backup-s3.sh [--env <file>] [--no-upload]
#
# --no-upload stops after building the backup locally (for testing).
# Settings: ~/.config/dyo-planner/backup.env (see backup.env.example).
set -Eeuo pipefail
umask 077

ENV_FILE="$HOME/.config/dyo-planner/backup.env"
UPLOAD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --no-upload) UPLOAD=0; shift ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

: "${PG_HOST:?}" "${PG_PORT:?}" "${PG_USER:?}" "${PG_DB:?}" "${PGPASSFILE:?}"
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
if [ "$UPLOAD" = 1 ]; then
  : "${S3_BUCKET:?}" "${AWS_REGION:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
fi
S3_PREFIX="${S3_PREFIX:-planner}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/planner-s3-backups}"
NODE_BIN="${NODE_BIN:-node}"
AWS_BIN="${AWS_BIN:-aws}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGCONNECT_TIMEOUT=15

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"
LOG="$LOCAL_DIR/backup.log"
exec > >(tee -a "$LOG") 2>&1

exec 9>"$LOCAL_DIR/.lock"
if ! flock -n 9; then
  echo "$(date -Is) another backup is already running; exiting"
  exit 75
fi

STEP=start
notify() {
  [ -n "${SLACK_BACKUP_WEBHOOK_URL:-}" ] || { echo "slack: no webhook set, not posting"; return 0; }
  local body
  body="$("$NODE_BIN" -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$1")"
  curl -sS --max-time 10 -H 'Content-Type: application/json' -d "$body" \
    "$SLACK_BACKUP_WEBHOOK_URL" >/dev/null || echo "slack: post failed"
}
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "$(date -Is) FAILED at step '$STEP' (exit $rc)"
    notify "❌ Planner backup failed at step '$STEP' (exit $rc). Log: $LOG on $(hostname)"
  fi
}
trap on_exit EXIT

PSQL=(psql -w -X -q -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB")
DATE="$(TZ=Asia/Jerusalem date +%F)"
WORK="$LOCAL_DIR/work-$DATE"
rm -rf "$WORK"
mkdir -p "$WORK/storage"
STARTED_AT="$(date -u +%FT%TZ)"
echo "$(date -Is) backup $DATE starting"

STEP=dump
pg_dump -w -Fc --schema=public --schema=auth --schema=storage \
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

if [ "$UPLOAD" = 1 ]; then
  DEST="s3://$S3_BUCKET/$S3_PREFIX/$DATE"
  STEP=upload-dump
  "$AWS_BIN" s3 cp "$WORK/db.dump" "$DEST/db.dump" --only-show-errors
  STEP=upload-storage
  if [ -n "$(ls -A "$WORK/storage")" ]; then
    "$AWS_BIN" s3 cp "$WORK/storage" "$DEST/storage/" --recursive --only-show-errors
  fi
  STEP=upload-manifest
  "$AWS_BIN" s3 cp "$WORK/manifest.json" "$DEST/manifest.json" --only-show-errors
fi

STEP=finish
rm -rf "$LOCAL_DIR/latest"
mv "$WORK" "$LOCAL_DIR/latest"
SIZE="$(du -sh "$LOCAL_DIR/latest" | cut -f1)"
FILES="$(wc -l < "$LOCAL_DIR/latest/storage-list.tsv" | tr -d ' ')"
echo "$(date -Is) backup $DATE done: $SIZE, $FILES files, upload=$UPLOAD"
if [ "$UPLOAD" = 1 ]; then
  notify "✅ Planner backup $DATE: database $(numfmt --to=iec "$DUMP_BYTES"), $FILES files, total $SIZE"
fi
