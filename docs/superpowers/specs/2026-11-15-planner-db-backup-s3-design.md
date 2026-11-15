# Planner daily backup to S3 — design

Status: draft, waiting for approval. Date: 2026-11-15.

## Why

The Planner's data (leads, tasks, clients, docs, billing, logins) is business-critical.
The Supabase project is on the free plan, so Supabase keeps no backups we can restore
from. Today nothing else backs it up automatically either: user `fahad` on the new server
(195.201.171.205) has no crontab, so `~/db-backup.sh` only runs when someone runs it
by hand. The last run was 2026-11-14.

## Goals

- **Every day:** one backup of the Planner, made automatically.
- **Destination:** the backup goes to the S3 bucket the owner provides.
- **Retention:** the last 7 days are kept. Anything older is deleted automatically.
- **What it covers ("A to Z"):**
  - the whole database, including logins (`auth`) and Storage metadata;
  - the files in Supabase Storage (task attachments, Docs attachments, and any other bucket).
- **One-command restore:** a backup can be restored to a fresh Postgres in one step.
  This is proven once, by a real test restore.
- **Failures are loud:** a failed backup sends a Slack message the same day.

## Non-goals

- Firestore content (Platform Content page, Google Cloud project `dyo-courses`).
  It is a different system and a separate job if wanted.
- The other databases on the server (`dyo_video_agent`, `/opt/dyo-services/*`).
- `/opt/DB-backups`. It belongs to another team. Do not touch it or its pm2.

## Anti-goals (what would make this a failure even if it "works")

- **A backup that quietly stops running.** Nobody notices until it's needed.
- **A backup that cannot actually be restored.** For example: CSV only, no auth users, missing tables.
- **An S3 key on the server that can delete backups.** A compromised server could then wipe them.
- **Secrets in the repo or in chat.** Any DB password, AWS key or service-role key.

## Constraints and facts found

- **Database:** Supabase project `vljrrwbsfmafmfzhvuip`, reached through the pooler at
  `aws-0-eu-west-1.pooler.supabase.com:5432` (session mode) as `postgres.vljrrwbsfmafmfzhvuip`.
  The existing `~/db-backup.sh` already authenticates through a `PGPASSFILE`. Reuse it.
- **Tools on the server:** `pg_dump` 18.6 is installed. The AWS CLI is not.
- **Disk:** 391 GB free on `/`.
- **Supabase service-role key:** already in `/opt/dashboard-dyo-app/.env`, for the Storage API.
- **Repo gap:** the repo's migrations cannot rebuild the database on their own. Some tables
  (`boards`, `sequences`, `sequence_steps`, `message_templates`) exist only live. So the
  backup must carry the full schema, not rely on migrations.
- **Existing script:** `~/db-backup.sh` (CSV per public table, plus a schema snapshot).
  It keeps working as-is. This job does not replace it.

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | Daily cron on the new server: `pg_dump` + Storage files → S3, S3 lifecycle deletes after 7 days | Needs the AWS CLI (or rclone) installed on the server; everything else is already there | **Chosen** |
| B | Scheduled GitHub Actions workflow | Nothing on the server, but the DB password lives in GitHub; GitHub schedules can run late | Rejected |
| C | Rely on Supabase's own daily backups | The project is on the **free plan**, which has no backups to restore from at all | Rejected — not available |

## Design

1. **Script:** `ops/backup/planner-backup-s3.sh` in the repo, with no secrets in it. It reads
   its settings from `~/.config/dyo-planner/backup.env`, mode 600.

2. **Database dump:**
   - Run `pg_dump --format=custom` over the schemas Supabase restores need: at least `public`,
     `auth` and `storage`.
   - Check the result with `pg_restore --list`. A dump that fails or is empty aborts the run.
   - Record row counts per `public` table in a manifest, as `db-backup.sh` does today.

3. **Storage files:**
   - Copy every object of every Supabase Storage bucket into the backup.
   - Use the Storage API with the service-role key, or Supabase's S3-compatible endpoint with rclone.
   - Record the file count and total size in the manifest.

4. **Upload layout:**
   - `s3://<bucket>/planner/<YYYY-MM-DD>/db.dump`
   - `s3://<bucket>/planner/<YYYY-MM-DD>/storage/<bucket>/<path>`
   - `s3://<bucket>/planner/<YYYY-MM-DD>/manifest.json`, holding sizes, sha256 of `db.dump`,
     row counts and file counts.

5. **Retention:**
   - Set an S3 lifecycle rule on the prefix `planner/` that expires objects after 8 days.
     That keeps 7 full days plus today.
   - Turn bucket versioning on, with noncurrent versions expiring after 8 days. Then an
     overwrite can never destroy a backup.
   - The server keeps only the latest local copy, for fast restores.

6. **Schedule:** run from `fahad`'s crontab at 03:00 Asia/Jerusalem every day, with `flock`
   so two runs never overlap.

7. **S3 access:**
   - Create a dedicated IAM user limited to this bucket.
   - Grant it only `s3:PutObject`, `s3:GetObject` and `s3:ListBucket`. No `DeleteObject`;
     the lifecycle rule does all deleting.
   - On the bucket, block public access and keep default encryption on.

8. **Alerts:**
   - Any failing step posts to a Slack webhook with the step name and error.
   - A run that never happened is caught too. A separate midday cron checks that today's
     `manifest.json` exists in S3 and alerts if it doesn't.
   - Known gap: if the whole server is down, neither cron runs and no alert is sent. An
     external heartbeat (e.g. healthchecks.io) can close that later.

9. **Restore proof:**
   - After the first successful run, restore `db.dump` into a scratch Postgres (e.g. a
     temporary Docker container) and compare row counts with the manifest.
   - Write the exact restore commands into `ops/backup/RESTORE.md`.

## Needed from the owner

- **Bucket details:** the bucket name and region.
- **AWS key:** an access key for the restricted IAM user. Put it **directly into the
  server file**, never into chat or the repo.
- **Slack webhook:** the URL of the channel that should receive backup failures.

## Left to the builder

- The exact `pg_dump` flags that work against Supabase as the `postgres` role. Verify them
  with `pg_restore --list` and the test restore.
- AWS CLI or rclone, and the Storage API or Supabase's S3 endpoint for the files.
- The manifest's exact format.
