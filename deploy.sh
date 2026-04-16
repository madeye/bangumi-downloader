#!/usr/bin/env bash
set -euo pipefail

# Deploy bangumi-downloader to a remote server.
#
# Usage:
#   ./deploy.sh user@host              # explicit host
#   DEPLOY_HOST=user@host ./deploy.sh  # env var
#
# Prerequisites:
#   - SSH access to the host
#   - Git repo cloned at REMOTE_APP_DIR on the host
#   - systemd service REMOTE_SERVICE configured and enabled
#   - .env.local already present on the host (not managed by this script)

DEPLOY_HOST="${1:-${DEPLOY_HOST:-}}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/bangumi/app}"
REMOTE_SERVICE="${REMOTE_SERVICE:-bangumi.service}"
REMOTE_USER="${REMOTE_USER:-bangumi}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Usage: ./deploy.sh <user@host>" >&2
  echo "  or set DEPLOY_HOST=<user@host>" >&2
  exit 1
fi

echo "==> Deploying to $DEPLOY_HOST:$REMOTE_APP_DIR"

ssh "$DEPLOY_HOST" bash -s -- "$REMOTE_APP_DIR" "$REMOTE_USER" "$REMOTE_SERVICE" <<'REMOTE_SCRIPT'
set -euo pipefail

APP_DIR="$1"
APP_USER="$2"
SERVICE="$3"

cd "$APP_DIR"

echo "--- git pull"
sudo -u "$APP_USER" git pull

echo "--- npm ci"
sudo -u "$APP_USER" npm ci

echo "--- npm run build"
sudo -u "$APP_USER" npm run build

echo "--- restarting $SERVICE"
systemctl restart "$SERVICE"
systemctl status "$SERVICE" --no-pager
REMOTE_SCRIPT

echo "==> Deploy complete"
