#!/usr/bin/env bash
# /opt/adspilot/deploy.sh — pull, build and restart AdsPilot when the deploy branch moved. Run every 2 minutes by adspilot-deploy.timer.
#
# Ported from SEOPilot's and DevPilot's proven scripts, with their two lessons kept:
#   · `git reset --hard`, never `git pull`: `npm install` rewrites lockfiles and a pull then refuses to merge, silently, while the old
#     build keeps serving (DevPilot, 2026-08-01).
#   · NO `git clean`: server/data/ is gitignored and holds the database. A clean would delete it on every deploy.
# Nothing tells anyone a deploy failed, so it re-checks /api/health and logs when the new commit never came up.
set -euo pipefail
REPO=/opt/adspilot/repo
BRANCH=${AP_DEPLOY_BRANCH:-main}
LOG=/var/log/adspilot-deploy.log
cd "$REPO"
git fetch -q origin "$BRANCH"
REMOTE=$(git rev-parse "origin/$BRANCH")
LOCAL=$(git rev-parse HEAD)
LIVE=$(curl -s --max-time 5 http://127.0.0.1:4020/api/health | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' || true)
if [ "$REMOTE" = "$LOCAL" ] && [ -n "$LIVE" ] && [ "${REMOTE:0:12}" = "$LIVE" ]; then exit 0; fi
git reset -q --hard "$REMOTE"
npm run setup >/dev/null 2>&1
npm run build >/dev/null 2>&1
sed -i "s/^AP_COMMIT=.*/AP_COMMIT=${REMOTE:0:12}/" server/.env || echo "AP_COMMIT=${REMOTE:0:12}" >> server/.env
sudo systemctl restart adspilot
for i in $(seq 1 30); do
  sleep 2
  LIVE=$(curl -s --max-time 5 http://127.0.0.1:4020/api/health | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' || true)
  [ "$LIVE" = "${REMOTE:0:12}" ] && exit 0
done
echo "$(date -Is) deploy of ${REMOTE:0:12} did not come up (health says: ${LIVE:-nothing})" >> "$LOG"
exit 1
