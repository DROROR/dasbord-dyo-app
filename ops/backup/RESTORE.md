# Restoring the Planner from a nightly backup

Each night creates `s3://<bucket>/planner/<YYYY-MM-DD>/` in Hetzner Object Storage. It
holds:

- `db.dump`: the whole database (`public`, `auth`, `storage` schemas), in `pg_dump` custom
  format, with owners and grants kept.
- `storage/<bucket>/<path>`: every Supabase Storage file.
- `manifest.json`: row counts per table, `auth_users`, files per bucket, and the
  `dump_sha256`.

**A folder without `manifest.json` is an unfinished run. Don't use it.** The last good one
is also kept on the server at `~/planner-s3-backups/latest/`.

> Proven 2026-11-15: a `db.dump` was restored into `supabase/postgres:17.6.1.178` with
> **0 errors**. Every count matched the live database: all 46 public tables, 11 auth
> users, 13 storage objects, 123 RLS policies, 73 functions, and 2992 column grants.

## 1. Get a backup

On the server, which already has the CLI and the settings:

```bash
set -a; . ~/.config/dyo-planner/backup.env; set +a
export AWS_ACCESS_KEY_ID=$HETZNER_S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$HETZNER_S3_SECRET_KEY AWS_DEFAULT_REGION=$HETZNER_S3_REGION AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { ~/.local/bin/aws --endpoint-url "https://${HETZNER_S3_ENDPOINT#https://}" "$@"; }
S3_BUCKET=$HETZNER_S3_BUCKET S3_PREFIX=${HETZNER_S3_ROOT_FOLDER:-planner}
s3 s3 ls "s3://$S3_BUCKET/$S3_PREFIX/"                       # pick a date
D=2026-11-15
mkdir -p ~/restore-$D && cd ~/restore-$D
s3 s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$D/" . --recursive
sha256sum db.dump; grep dump_sha256 manifest.json            # must be equal
```

## 2a. Full restore (new or emptied Supabase project)

Supabase projects already contain the `auth` and `storage` schemas, so restore with
`--clean --if-exists`. That replaces them with the backup's content. Run it as a
superuser:
- In a Supabase project, use the direct connection string from the dashboard
  (Project Settings → Database).
- In a local `supabase/postgres` container, use `supabase_admin`.

```bash
pg_restore --clean --if-exists -d "<connection string of the TARGET database>" db.dump
```

**Never point this at the live project unless you mean to overwrite it.** `--clean` drops
tables before recreating them.

Then compare the counts in `manifest.json` with
`select count(*) from public.<table>` for a few tables, `auth.users`, and `storage.objects`.

## 2b. Bring back one table's rows

Restore into a scratch database first. For example, on a laptop with Docker:

```bash
docker run -d --name restore -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 supabase/postgres:17.6.1.178
docker cp db.dump restore:/tmp/db.dump
docker exec -e PGPASSWORD=x restore pg_restore --clean --if-exists -U supabase_admin -h localhost -d postgres /tmp/db.dump
```

Then copy just the rows you need from the scratch database into the live one. Do it inside
`begin; … rollback;` first, and change it to `commit` only once the counts look right.
Remove the container afterwards with `docker rm -f restore`.

## 3. Put the Storage files back

Files are under `storage/<bucket>/<path>`, exactly as the paths in `storage.objects`.
Upload them with the Supabase dashboard, or with the Storage API and the service-role key:

```bash
curl -X POST "$SUPABASE_URL/storage/v1/object/<bucket>/<path>" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  --data-binary @"storage/<bucket>/<path>"
```

After a full database restore (2a), `storage.objects` already lists the files. Only the
file contents need uploading.
