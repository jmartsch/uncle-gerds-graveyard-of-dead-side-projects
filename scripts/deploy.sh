#!/usr/bin/env bash
# Deploys the museum from your laptop to a Sprite:
# create it (once), upload the code, install, run it as a service on :8080, make the URL public.
#   ./scripts/deploy.sh            (Sprite name: ugm-museum)
#   SPRITE=ugm-test ./scripts/deploy.sh
set -euo pipefail

SPRITE="${SPRITE:-ugm-museum}"
APP=/home/sprite/museum
cd "$(dirname "$0")/.."

if ! command -v sprite >/dev/null; then
  echo "The Sprites CLI is missing. Install it first: https://docs.fly.io/sprites/quickstart" >&2
  exit 1
fi

if ! sprite exec -s "$SPRITE" -- true >/dev/null 2>&1; then
  echo "→ Creating Sprite $SPRITE"
  sprite create "$SPRITE"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tar --exclude=./node_modules --exclude=./data --exclude='./.env*' --exclude=./.git --exclude='*.tgz' --exclude=./previews -czf "$tmp/museum.tgz" .

echo "→ Uploading code"
sprite exec -s "$SPRITE" --no-stdin --file "$tmp/museum.tgz:/home/sprite/museum.tgz" -- bash -lc \
  "mkdir -p $APP && tar xzf /home/sprite/museum.tgz -C $APP && rm /home/sprite/museum.tgz && cd $APP && npm install --omit=dev --no-audit --no-fund"

if [ -f .env.sprite ]; then
  echo "→ Uploading .env.sprite as .env"
  sprite exec -s "$SPRITE" --no-stdin --file ".env.sprite:$APP/.env" -- chmod 600 "$APP/.env"
else
  echo "! No .env.sprite found: the museum runs without ADMIN_KEY and SPRITES_TOKEN (see .env.example)"
fi

sprite exec -s "$SPRITE" --no-stdin -- bash -lc \
  'node -e "process.exit(+process.versions.node.split(\".\")[0] >= 24 ? 0 : 1)" || echo "! Node < 24 on the Sprite: revivals need Node 24+ (Sprites SDK)"'

echo "→ Starting the museum service"
sprite exec -s "$SPRITE" --no-stdin -- bash -lc \
  "if sprite-env services get web >/dev/null 2>&1; then sprite-env services restart web; else sprite-env services create web --cmd \"\$(command -v node)\" --args server.js --dir $APP --env PORT=8080 --http-port 8080; fi"

echo "→ Opening the doors to the public"
sprite config update --url-auth public -s "$SPRITE"
sprite info -s "$SPRITE" | grep -i url
echo "Done. Check the connectors inside the Sprite with: sprite exec -s $SPRITE -- bash -lc 'cd $APP && node scripts/check.js'"
