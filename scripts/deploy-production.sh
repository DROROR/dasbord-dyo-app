#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR='/opt/dashboard-dyo-app'
readonly DIST_DIR="$APP_DIR/dist"
readonly EXPECTED_BRANCH='production'
readonly HEALTH_URL='https://planner.dyocourses.com/'

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: deploy-production.sh <40-character-commit-sha>' >&2
  exit 64
fi
readonly EXPECTED_SHA="$1"

cd "$APP_DIR"

readonly NVM_DIR='/home/fahad/.nvm'
# SSH forced-command sessions do not load the user shell profile.
# Load the server-managed default Node.js version explicitly.
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "NVM is not installed at $NVM_DIR." >&2
  exit 69
fi
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use --silent default >/dev/null
command -v npm >/dev/null

exec 9>"$APP_DIR/.deploy.lock"
if ! flock -n 9; then
  echo 'Another production deployment is already running.' >&2
  exit 75
fi

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo 'Refusing to deploy over tracked local changes.' >&2
  exit 65
fi

git fetch --quiet origin "$EXPECTED_BRANCH"
readonly REMOTE_SHA="$(git rev-parse "origin/$EXPECTED_BRANCH")"
if [[ "$REMOTE_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Refusing stale deployment: production is $REMOTE_SHA, requested $EXPECTED_SHA." >&2
  exit 66
fi

git switch --quiet "$EXPECTED_BRANCH"
git merge --quiet --ff-only "$EXPECTED_SHA"


pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save --force >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null
npm ci --no-audit --no-fund

BUILD_DIR="$(mktemp -d "$APP_DIR/.deploy-build.XXXXXX")"
PREVIOUS_INDEX="$(mktemp "$APP_DIR/.previous-index.XXXXXX")"
cleanup() {
  rm -rf "$BUILD_DIR"
  rm -f "$PREVIOUS_INDEX"
}
trap cleanup EXIT

npm run build -- --outDir "$BUILD_DIR"
test -s "$BUILD_DIR/index.html"
test -d "$BUILD_DIR/assets"

mkdir -p "$DIST_DIR"
if [[ -f "$DIST_DIR/index.html" ]]; then
  cp "$DIST_DIR/index.html" "$PREVIOUS_INDEX"
fi

# Publish assets before the HTML entry point. Old hashed assets remain available
# so browsers with an earlier index do not break during or after deployment.
find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name index.html   -exec cp -a '{}' "$DIST_DIR/" \;
cp "$BUILD_DIR/index.html" "$DIST_DIR/.index.html.next"
mv -f "$DIST_DIR/.index.html.next" "$DIST_DIR/index.html"

if ! curl --fail --silent --show-error --max-time 20 "$HEALTH_URL" >/dev/null; then
  if [[ -s "$PREVIOUS_INDEX" ]]; then
    cp "$PREVIOUS_INDEX" "$DIST_DIR/.index.html.rollback"
    mv -f "$DIST_DIR/.index.html.rollback" "$DIST_DIR/index.html"
  fi
  echo 'Production health check failed; previous index.html restored.' >&2
  exit 69
fi

printf '%s\n' "$EXPECTED_SHA" > "$DIST_DIR/.deployed-sha"
echo "Production deployed successfully: $EXPECTED_SHA"
