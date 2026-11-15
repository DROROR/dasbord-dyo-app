# Bucket setup for Planner backups (Hetzner Object Storage)

1. Put the bucket's details straight into the server file. Never put them in chat or the
   repo:

   ```
   ssh fahad@195.201.171.205
   nano ~/.config/dyo-planner/backup.env
   ```

   Fill in `HETZNER_S3_ENDPOINT`, `HETZNER_S3_REGION`, `HETZNER_S3_BUCKET`,
   `HETZNER_S3_ROOT_FOLDER`, `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY` and
   `SLACK_BACKUP_WEBHOOK_URL`. Save with Ctrl+O, Enter, then Ctrl+X.

2. Turn on versioning and the 7-day retention rule, once:

   ```
   /opt/dashboard-dyo-app/ops/backup/apply-bucket-rules.sh
   ```

   It prints the versioning status (`Enabled`) and both lifecycle rules:
   - `<root folder>/` is kept 8 days, which is 7 full days plus today.
   - `<root folder>-test/` is kept 1 day.

3. In the Hetzner console, make sure the bucket's visibility is **Private**.

Note: Hetzner access keys work on every bucket in the project, and cannot be limited to
"add but never delete". So a stolen key could delete backups. Mitigations:
- Keep this key only in the server file above.
- Use a separate Hetzner project for backups if that matters.
