# S3 setup for Planner backups (done once by the bucket owner)

Replace `BUCKET_NAME` with the real bucket name everywhere below, including inside
`iam-policy.json`.

## 1. Bucket settings (S3 console → the bucket)

- **Permissions → Block public access:** all four boxes ON.
- **Properties → Bucket Versioning:** Enable.
- **Properties → Default encryption:** SSE-S3 (the default) is fine.
- **Management → Lifecycle rules:** create the two rules in `lifecycle.json`:
  - `planner-7-days`, prefix `planner/`. Expire current versions after 8 days, and
    permanently delete noncurrent versions after 8 days.
  - `planner-test-cleanup`, prefix `planner-test/`, 1 day for both.

  With the AWS CLI, the same rules go on in one command:
  `aws s3api put-bucket-lifecycle-configuration --bucket BUCKET_NAME --lifecycle-configuration file://lifecycle.json`

## 2. A key that can add backups but never delete them (IAM console)

1. **Users → Create user:** name it `planner-backup`. No console access.
2. **Permissions → Create inline policy → JSON:** paste `iam-policy.json` with
   `BUCKET_NAME` replaced.
3. **Security credentials → Create access key:** choose "Application running outside AWS".

## 3. Put the key on the server, not in chat

```
ssh fahad@195.201.171.205
nano ~/.config/dyo-planner/backup.env
```

Fill in `S3_BUCKET`, `AWS_REGION` (e.g. `eu-central-1`), `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `SLACK_BACKUP_WEBHOOK_URL`. Save with Ctrl+O, Enter, then Ctrl+X.

## 4. Checks (run by Claude afterwards)

- The key **cannot delete**: `aws s3 rm` on a test object must fail with `AccessDenied`.
- Lifecycle and versioning: `get-bucket-lifecycle-configuration` shows both rules, and
  `get-bucket-versioning` shows `Enabled`. These need the owner's admin credentials,
  because the backup key has no permission to read bucket settings.
