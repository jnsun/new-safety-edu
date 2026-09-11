#!/bin/sh
set -eu

root=/opt/safety-training
stage=/tmp/safety-training-deploy
env_file="$root/.env.production"

test -d "$root/app"
test -f "$env_file"

if [ ! -f "$root/docker-compose.pre-web.yml" ]; then
  cp "$root/docker-compose.yml" "$root/docker-compose.pre-web.yml"
fi

install -d -m 750 "$root/app/deploy" "$root/app/apps/admin/src" \
  "$root/app/apps/api/src/routes" "$root/app/apps/api/src"
install -m 640 "$stage/Dockerfile" "$root/app/Dockerfile"
install -m 640 "$stage/pnpm-workspace.yaml" "$root/app/pnpm-workspace.yaml"
install -m 640 "$stage/apps/admin/src/App.tsx" "$root/app/apps/admin/src/App.tsx"
install -m 640 "$stage/apps/admin/src/Day2Pages.tsx" "$root/app/apps/admin/src/Day2Pages.tsx"
install -m 640 "$stage/apps/api/src/routes/day1.ts" "$root/app/apps/api/src/routes/day1.ts"
install -m 640 "$stage/apps/api/src/routes/day2.ts" "$root/app/apps/api/src/routes/day2.ts"
install -m 640 "$stage/apps/api/src/server.ts" "$root/app/apps/api/src/server.ts"
install -m 640 "$stage/deploy/nginx.conf" "$root/app/deploy/nginx.conf"
install -m 640 "$stage/docker-compose.production.yml" "$root/docker-compose.yml"

ensure_value() {
  key="$1"
  value="$2"
  grep -q "^${key}=" "$env_file" || printf '%s=%s\n' "$key" "$value" >> "$env_file"
}

ensure_secret_hex() {
  key="$1"
  grep -q "^${key}=" "$env_file" || printf '%s=%s\n' "$key" "$(openssl rand -hex 32)" >> "$env_file"
}

ensure_value NODE_ENV development
ensure_value PORT 3000
ensure_value PUBLIC_BASE_URL http://140.143.247.55
ensure_secret_hex COOKIE_SECRET
ensure_secret_hex JWT_SECRET
if ! grep -q '^FIELD_ENCRYPTION_KEY=' "$env_file"; then
  printf 'FIELD_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32 | tr -d '\n')" >> "$env_file"
fi
ensure_value UPLOAD_ROOT /app/var/uploads
ensure_secret_hex UPLOAD_SIGNING_SECRET
chmod 600 "$env_file"

cd "$root"
docker compose --env-file .env.production config --quiet
printf 'REMOTE_INSTALL_OK\n'
