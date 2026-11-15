# Planner Daily S3 Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every night, put a complete, restorable backup of the Planner into the owner's S3
bucket: the database including `auth`, plus every Supabase Storage file. Keep 7 days, and
alert on Slack when anything goes wrong.

**Architecture:**
- **Nightly run:** a bash script under `ops/backup/`, run from `fahad`'s crontab on the new
  server. It dumps the database with `pg_dump`, exports Storage files with a small
  dependency-free Node script, writes a manifest, and uploads with the AWS CLI. The manifest
  goes last.
- **Retention:** an S3 lifecycle rule deletes old backups.
- **Midday check:** a second cron checks that today's manifest exists.

**Tech Stack:** bash, `pg_dump`/`pg_restore` 18.6, Node 22 (nvm, `node:test`), AWS CLI v2
(user-local install), Slack incoming webhook, Docker `supabase/postgres` for the restore proof.

**Spec:** `docs/superpowers/specs/2026-11-15-planner-db-backup-s3-design.md`

## Global Constraints

- **Server and user:** 195.201.171.205, user `fahad`. No sudo is assumed; everything installs
  under `~`.
- **Database:** `aws-0-eu-west-1.pooler.supabase.com:5432`, user
  `postgres.vljrrwbsfmafmfzhvuip`, db `postgres`. Authentication goes through the existing
  `PGPASSFILE` used by `~/db-backup.sh`.
- **Schedule:** backup at 03:00 Asia/Jerusalem; freshness check at 12:00 Asia/Jerusalem.
  Folder dates use the Asia/Jerusalem calendar date.
- **S3 layout:** `s3://$S3_BUCKET/$S3_PREFIX/<YYYY-MM-DD>/{db.dump, storage/<bucket>/<path>, manifest.json}`,
  where `S3_PREFIX` defaults to `planner`.
- **Retention:** lifecycle expiry after 8 days on `planner/`. Versioning is on, and noncurrent
  versions expire after 8 days.
- **IAM key:** only `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on this bucket. Never
  `DeleteObject`.
- **Secrets:** none in the repo or in chat. All of them live in `~/.config/dyo-planner/backup.env`
  (mode 600), plus the existing PGPASSFILE.
- **Off limits:** `/opt/DB-backups`, `/usr/local/bin/pm2`, `/opt/dyo-services/*`.
- **Branch:** work on `ops/planner-s3-backup`, merge to `production` once at the end. Every
  push to `production` deploys.

## Review Focus

1. **Hebrew or space-containing Storage file names.** They must download and upload intact,
   so each path segment is URL-encoded. Test: Task 1 `downloads names with Hebrew and spaces`.
2. **Interrupted runs.** A run killed halfway must never look like a good backup:
   `manifest.json` is uploaded last, and the freshness check looks only for the manifest.
   Tests: Task 2 Step 6 and Task 3 `folder without manifest counts as missing`.
3. **Passwords under cron.** cron has no terminal, so nothing may ever wait on a password
   prompt. Every `psql`/`pg_dump` call uses `-w`. Test: Task 2 Step 5 runs with a bad
   PGPASSFILE and must fail fast, not hang.
4. **Tables added later.** They must be in the backup automatically. The dump is
   schema-wide, and verification compares live `public` tables against the dump's TOC.
   Test: Task 2 Step 4.
5. **Slack down or webhook unset.** The script still exits non-zero and writes the error to
   `~/planner-s3-backups/backup.log`. Test: Task 2 Step 7.

---

### Task 0: Server access and facts

**Files:** none (findings go into the Task 2 commit message and Task 5's RESTORE.md)

- [ ] **Step 1: Give this laptop key-based SSH to the server.** The owner runs it once and
  types the password:
  `ssh-copy-id fahad@195.201.171.205`.
  Verify: `ssh -o BatchMode=yes fahad@195.201.171.205 true` exits 0.
- [ ] **Step 2: Record the facts.** Run over SSH and note each value:
  - `timedatectl | grep 'Time zone'`: the server timezone, which decides the cron hours.
  - `docker version --format '{{.Server.Version}}'`: whether Docker is available for Task 5.
  - `cat ~/db-backups/20261114T101442Z/schema/server_version.txt`: the live Postgres major version.
  - `grep -o 'PGPASSFILE=[^ ]*' ~/db-backup.sh`: the passfile path.
  - `source ~/.nvm/nvm.sh && which node`: the node path.
  - `grep -c '^SUPABASE_SERVICE_ROLE_KEY=' /opt/dashboard-dyo-app/.env`: expected `1`.
- [ ] **Step 3: Size Storage.** Using the existing passfile:
  `psql -w ... -tAc "select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects group by 1"`.
  Expected: one row per bucket, with `task-attachments` and `work-doc-attachments` among them.

### Task 1: Storage export (`storage-export.mjs`)

**Files:**
- Create: `ops/backup/storage-export.mjs`
- Test: `ops/backup/storage-export.test.mjs`

**Interfaces:**
- Produces, as a CLI:
  `node storage-export.mjs --list <tsv-file> --out <dir> --url <SUPABASE_URL>`. It reads
  `SUPABASE_SERVICE_ROLE_KEY` from the environment.
  - Input: TSV lines `bucket_id\tname\tsize`.
  - Output: files at `<dir>/<bucket>/<name>`, plus one stdout JSON line
    `{"files":N,"bytes":B,"failed":0}`.
  - Exit code: 0 only if `failed === 0` and every written size equals its TSV size.
- Produces, as an export:
  `exportObjects({ objects, outDir, baseUrl, key, fetchImpl }) -> Promise<{files, bytes, failed, errors: string[]}>`.
  It downloads `GET {baseUrl}/storage/v1/object/authenticated/{bucket}/{encodedName}`, where
  `encodedName` encodes each `/`-separated segment with `encodeURIComponent`. It sends
  headers `Authorization: Bearer <key>` and `apikey: <key>`. Concurrency is 4, with 3
  retries per object.

- [ ] **Step 1: Write failing tests** with `node:test` against a local `http.createServer`
  fake:
  - `downloads names with Hebrew and spaces`: object `task-attachments` /
    `abc/דוח מכירות.pdf` with 5 bytes. Expect the request path to equal the encoded path and
    the file to exist with 5 bytes.
  - `size mismatch counts as failure`: the server returns 3 bytes for size 5. Expect
    `failed === 1`.
  - `404 after retries counts as failure`: expect `failed === 1` and `errors[0]` to contain
    the bucket and name.
  - `sends both auth headers`: expect both headers to equal the key.
- [ ] **Step 2: Run** `node --test ops/backup/`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `exportObjects` and the CLI wrapper. Use global `fetch`,
  `fs.promises`, and `mkdir -p` per directory. Never log the key.
- [ ] **Step 4: Run** `node --test ops/backup/`. Expected: 4 pass.
- [ ] **Step 5: Commit**: `git add ops/backup/storage-export*.mjs && git commit -m "Add Storage export for the nightly backup"`.

### Task 2: Nightly backup script (`planner-backup-s3.sh`)

**Files:**
- Create: `ops/backup/planner-backup-s3.sh`
- Create: `ops/backup/backup.env.example`. Keys only, no values: `PG_HOST`, `PG_PORT`,
  `PG_USER`, `PG_DB`, `PGPASSFILE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `S3_BUCKET`,
  `S3_PREFIX`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `SLACK_BACKUP_WEBHOOK_URL`, `LOCAL_DIR`.

**Interfaces:**
- Consumes: the Task 1 CLI.
- Produces:
  - Usage: `planner-backup-s3.sh [--env <file>]`, defaulting to
    `~/.config/dyo-planner/backup.env`.
  - Exit codes: 0 on success, non-zero on any failure.
  - Local output: `$LOCAL_DIR/latest/` holds the last good backup. Log at
    `$LOCAL_DIR/backup.log`.
  - S3 output: the layout in Global Constraints.
  - Manifest keys: `date`, `started_at`, `finished_at`, `pg_server_version`, `dump_bytes`,
    `dump_sha256`, `tables` (map of `public` table name to row count), `auth_users`,
    `storage` (map of bucket to `{files, bytes}`).

**Run order:**
1. Take `flock -n $LOCAL_DIR/.lock`.
2. Write a `trap` on ERR/EXIT that posts `❌ Planner backup failed at <step>: <last log line>`
   to Slack, best-effort with curl `--max-time 10`.
3. `pg_dump -w -Fc --schema=public --schema=auth --schema=storage --no-owner --no-acl`
   into `work/db.dump`. Adjust the flags only if Step 3 proves they fail, and record why.
4. Verify with `pg_restore --list`.
5. Count rows.
6. List Storage objects with `psql -w` from `storage.objects`, then run the Task 1 export.
7. Write `manifest.json`.
8. Upload `db.dump`, then `storage/` (`aws s3 cp --recursive`), then `manifest.json`, last.
9. Replace `latest/`.
10. Post `✅ Planner backup <date>: <dump size>, <N> files` to Slack. Success posts are wanted,
    so a silent day is noticeable.

- [ ] **Step 1: Copy to the server for testing.**
  `scp -r ops/backup fahad@195.201.171.205:~/planner-backup-test/`. Create the test env file
  with `S3_PREFIX=planner-test`.
- [ ] **Step 2: Lint.** `shellcheck ops/backup/planner-backup-s3.sh` locally (`brew install shellcheck`).
  Expected: no output.
- [ ] **Step 3: Full run.** Run the script on the server against `planner-test`. Expected:
  exit 0, and `aws s3 ls s3://$S3_BUCKET/planner-test/<date>/` shows `db.dump`, `storage/`
  and `manifest.json`.
- [ ] **Step 4: Coverage check.**
  - `pg_restore --list db.dump | grep -c 'TABLE DATA public '` equals the live count of
    `public` base tables.
  - The list contains `TABLE DATA auth users` and `TABLE DATA storage objects`.
  - The manifest's `tables` row counts equal a fresh `select count(*)` for `leads`, `tasks`
    and `clients`.
- [ ] **Step 5: No prompt hang.** With `PGPASSFILE=/nonexistent`, the script exits non-zero
  in under 30 s and posts a Slack failure.
- [ ] **Step 6: Interrupted upload.** Kill the script during the storage upload. Expected:
  no `manifest.json` for that date in `planner-test/`. Rerunning succeeds and overwrites it.
- [ ] **Step 7: Slack unreachable.** With `SLACK_BACKUP_WEBHOOK_URL=https://127.0.0.1:9/x`
  and a bad PGPASSFILE, expect a non-zero exit, `backup.log` showing the failure, and the
  run ending within 60 s.
- [ ] **Step 8: Overlap.** Two simultaneous runs: the second exits immediately with
  "already running" and touches nothing.
- [ ] **Step 9: Commit**: `git add ops/backup/planner-backup-s3.sh ops/backup/backup.env.example && git commit -m "Add nightly Planner backup to S3"`.

### Task 3: Midday freshness check (`check-backup-fresh.sh`)

**Files:**
- Create: `ops/backup/check-backup-fresh.sh`

**Interfaces:**
- Produces: `check-backup-fresh.sh [--env <file>]`. It exits 0 when
  `s3://$S3_BUCKET/$S3_PREFIX/<today Asia/Jerusalem>/manifest.json` exists. Otherwise it
  posts `⚠️ No Planner backup in S3 for <date>` to Slack and exits 1.

- [ ] **Step 1: Shellcheck.** Expected: clean.
- [ ] **Step 2: `today present`.** Against `planner-test` after Task 2 Step 3, expect exit 0
  and no Slack post.
- [ ] **Step 3: `folder without manifest counts as missing`.** With a date folder that has a
  `db.dump` but no manifest (left over from Task 2 Step 6, or uploaded by hand), expect
  exit 1 and a Slack warning.
- [ ] **Step 4: Commit**: `git commit -m "Add midday check that today's backup reached S3"`.

### Task 4: AWS bucket rules (applied by the owner)

**Files:**
- Create: `ops/backup/aws/iam-policy.json`. It allows `s3:ListBucket` on
  `arn:aws:s3:::<bucket>`, and `s3:PutObject`/`s3:GetObject` on `arn:aws:s3:::<bucket>/*`.
  Nothing else.
- Create: `ops/backup/aws/lifecycle.json`. Rule `planner-7-days`, prefix `planner/`:
  `Expiration.Days: 8` and `NoncurrentVersionExpiration.NoncurrentDays: 8`. A second rule,
  `planner-test-cleanup`, sets prefix `planner-test/` to 1 day.
- Create: `ops/backup/aws/README.md`. These are the owner's console/CLI steps: create the
  IAM user, attach the policy, create the access key, and put it **straight into**
  `backup.env` on the server. Also: enable versioning, apply the lifecycle rules, and
  confirm Block Public Access is on.

- [ ] **Step 1: Owner applies the rules.** The owner follows the README with
  `<bucket>` filled in.
- [ ] **Step 2: Verify the key cannot delete.** On the server, with the backup key,
  `aws s3 rm s3://$S3_BUCKET/planner-test/<date>/manifest.json` should fail with
  `AccessDenied`.
- [ ] **Step 3: Verify the rules.** The owner runs
  `aws s3api get-bucket-lifecycle-configuration` and `get-bucket-versioning`. Expected: both
  rules present, `Status: Enabled`.
- [ ] **Step 4: Commit**: `git add ops/backup/aws && git commit -m "Add S3 policy and retention rules for Planner backups"`.

### Task 5: Restore proof and RESTORE.md

**Files:**
- Create: `ops/backup/RESTORE.md`

- [ ] **Step 1: Restore into a scratch database.** On the server (or the laptop if the
  server has no Docker), start a scratch `supabase/postgres:<live major version from Task 0>`
  container on a random local port. Restore the `planner-test` `db.dump` with
  `pg_restore --no-owner --no-acl`.
- [ ] **Step 2: Compare counts.** Compare the restored row counts for every `public` table,
  plus `auth.users` and `storage.objects`, against `manifest.json`. Expected: all equal.
  Record any restore warnings and whether they matter.
- [ ] **Step 3: Write RESTORE.md.** Write down the exact commands that worked, covering:
  - a full restore into a new Supabase project;
  - restoring one table;
  - re-uploading Storage files from `storage/`.
- [ ] **Step 4: Clean up.** Remove the container.
- [ ] **Step 5: Commit**: `git add ops/backup/RESTORE.md && git commit -m "Document and prove restoring a Planner backup"`.

### Task 6: Go live

- [ ] **Step 1: Install the AWS CLI.** Install AWS CLI v2 user-locally
  (`./aws/install -i ~/.local/aws-cli -b ~/.local/bin`). Verify: `~/.local/bin/aws --version`.
- [ ] **Step 2: Write the production env file.** Create `~/.config/dyo-planner/backup.env`
  with `S3_PREFIX=planner` and mode 600. Verify: `stat -c %a` prints `600`.
- [ ] **Step 3: Merge and deploy.** Merge `ops/planner-s3-backup` into `production` and
  push. Verify that `/opt/dashboard-dyo-app/ops/backup/planner-backup-s3.sh` exists after
  the deploy.
- [ ] **Step 4: Install the crontab.** Add `fahad`'s crontab entries, with the hours
  converted from Asia/Jerusalem to the server timezone found in Task 0:
  - `<03:00 IL>` runs `planner-backup-s3.sh`
  - `<12:00 IL>` runs `check-backup-fresh.sh`

  Each entry sets `PATH` to include `~/.local/bin` and the nvm node bin. Verify: `crontab -l`.
- [ ] **Step 5: First production run.** Run the backup once by hand. Expected: exit 0,
  `planner/<date>/manifest.json` in S3, and a Slack ✅ message.
- [ ] **Step 6: Check the first scheduled run.** The next morning, the Slack ✅ arrived and
  the date folder exists. Note this in the PR/commit.
