#!/usr/bin/env bash
set -euo pipefail

# nostr.info staging deploy script
# Build Jekyll site and rsync to stage.nostr.info

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[deploy-stage] Building Jekyll site..."
bundle exec jekyll build --destination /tmp/nostr-info-stage

echo "[deploy-stage] Deploying to stage.nostr.info..."
rsync -avz --delete \
  -e "ssh -i /root/.ssh/hermes_deploy_key -o StrictHostKeyChecking=accept-new" \
  /tmp/nostr-info-stage/ \
  root@stage.nostr.info:/var/www/stage.nostr.info/

echo "[deploy-stage] Done. Verify at https://stage.nostr.info"
