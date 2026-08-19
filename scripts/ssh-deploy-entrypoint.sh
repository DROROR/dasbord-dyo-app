#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR='/opt/dashboard-dyo-app'
read -r ACTION SHA EXTRA <<<"${SSH_ORIGINAL_COMMAND:-}"

if [[ "$ACTION" != 'deploy' || ! "$SHA" =~ ^[0-9a-f]{40}$ || -n "${EXTRA:-}" ]]; then
  echo 'Only production deployment commands are allowed.' >&2
  exit 64
fi

exec "$APP_DIR/scripts/deploy-production.sh" "$SHA"
