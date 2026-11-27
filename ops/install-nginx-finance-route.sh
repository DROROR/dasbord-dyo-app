#!/usr/bin/env bash
# Adds https://planner.dyocourses.com/api/finance/ (server/finance-api.mjs) to
# the planner's nginx site, and stops /api/claude/ from passing the marker that
# route sets, so the finance API answers only at its own address.
# Run once as root:  bash /opt/dashboard-dyo-app/ops/install-nginx-finance-route.sh
set -Eeuo pipefail

readonly CONF='/etc/nginx/conf.d/planner.conf'
readonly CLAUDE='    location /api/claude/ {'
readonly BLOCK='    location /api/finance/ {
        limit_req zone=planner_api burst=30 nodelay;
        proxy_pass http://127.0.0.1:3002/finance/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Planner-Route finance;
        proxy_connect_timeout 5s;
        proxy_read_timeout 65s;
        proxy_send_timeout 65s;
        client_max_body_size 16k;
    }
'

if [[ $EUID -ne 0 ]]; then
  echo 'Run as root.' >&2
  exit 77
fi

if grep -q 'location /api/finance/' "$CONF"; then
  echo 'Finance route is already installed.'
  exit 0
fi

backup="$CONF.backup.$(date +%Y%m%d%H%M%S)"
cp -a "$CONF" "$backup"

python3 - "$CONF" "$CLAUDE" "$BLOCK" <<'PY'
import sys
from pathlib import Path

path, claude, block = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text()
if text.count(claude) != 1:
    raise SystemExit(f'Expected exactly one "{claude.strip()}" in {path}')
text = text.replace(claude, block + claude + '\n        proxy_set_header X-Planner-Route "";', 1)
path.write_text(text)
PY

if ! nginx -t; then
  cp -a "$backup" "$CONF"
  echo "nginx rejected the change; restored $backup." >&2
  exit 78
fi

systemctl reload nginx
echo "Finance route installed. Backup: $backup"
