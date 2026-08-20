#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONF='/etc/nginx/sites-available/dashboard.dyocourses.com'
readonly MARKER='    location = /sw.js {'
readonly BLOCK='    location /api/claude/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 125s;
        proxy_send_timeout 125s;
        client_max_body_size 1m;
    }

'

if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo.' >&2
  exit 77
fi

if grep -q 'location /api/claude/' "$CONF"; then
  echo 'Anthropic Nginx route is already installed.'
  nginx -t
  systemctl reload nginx
  exit 0
fi

backup="$CONF.backup.$(date +%Y%m%d%H%M%S)"
cp -a "$CONF" "$backup"

python3 - "$CONF" "$MARKER" "$BLOCK" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
marker = sys.argv[2]
if marker not in text:
    raise SystemExit(f'Nginx insertion marker not found in {path}')
path.write_text(text.replace(marker, sys.argv[3] + marker, 1))
PY

if ! nginx -t; then
  cp -a "$backup" "$CONF"
  echo "Nginx validation failed; restored $backup." >&2
  exit 78
fi

systemctl reload nginx
echo "Anthropic Nginx route installed. Backup: $backup"
