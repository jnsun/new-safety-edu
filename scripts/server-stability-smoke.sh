#!/usr/bin/env bash
set -euo pipefail

cd /opt/safety-training
test_db=safety_stability_final
test_container=safety-stability-api-final

set -a
# shellcheck disable=SC1091
. ./.env.production
set +a

cleanup() {
  docker rm -f "$test_container" >/dev/null 2>&1 || true
  docker compose --env-file .env.production exec -T postgres \
    dropdb --if-exists -U postgres "$test_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker compose --env-file .env.production exec -T postgres \
  createdb -U postgres -O "$APP_DB_USER" "$test_db"

database_url_without_query="${DATABASE_URL%%\?*}"
database_url_query=""
if [[ "$DATABASE_URL" == *\?* ]]; then
  database_url_query="?${DATABASE_URL#*\?}"
fi
test_database_url="${database_url_without_query%/*}/${test_db}${database_url_query}"

docker run --rm --network safety-training-backend --env-file .env.production \
  -e DATABASE_URL="$test_database_url" \
  safety-training-api:stability-final ./node_modules/.bin/prisma migrate deploy

docker run -d --name "$test_container" --network safety-training-backend \
  --env-file .env.production -e NODE_ENV=development -e PORT=3000 \
  -e DATABASE_URL="$test_database_url" -e UPLOAD_ROOT=/tmp/uploads \
  safety-training-api:stability-final >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "$test_container" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
  if [[ "$attempt" == 30 ]]; then
    docker logs --tail 200 "$test_container"
    exit 1
  fi
done

for smoke in day1-day2-smoke.ts day3-smoke.ts day4-smoke.ts; do
  docker exec -e DATABASE_URL="$test_database_url" \
    -e SMOKE_BASE_URL=http://127.0.0.1:3000 \
    "$test_container" ./node_modules/.bin/tsx "scripts/$smoke"
done

docker rm -f "$test_container" >/dev/null
bootstrap_username="stability-$(openssl rand -hex 8)"
bootstrap_password="$(openssl rand -base64 32 | tr -d '\n')"
docker run --rm --network safety-training-backend --env-file .env.production \
  -e DATABASE_URL="$test_database_url" \
  -e ADMIN_BOOTSTRAP_USERNAME="$bootstrap_username" \
  -e ADMIN_BOOTSTRAP_PASSWORD="$bootstrap_password" \
  safety-training-api:stability-final ./node_modules/.bin/tsx prisma/seed.ts >/dev/null
docker run -d --name "$test_container" --network safety-training-backend \
  --env-file .env.production -e NODE_ENV=production -e PORT=3000 \
  -e PUBLIC_BASE_URL=https://stability.invalid -e WECHAT_APP_ID=stability \
  -e WECHAT_APP_SECRET=x -e DATABASE_URL="$test_database_url" \
  -e UPLOAD_ROOT=/tmp/uploads safety-training-api:stability-final >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$test_container" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
  if [[ "$attempt" == 30 ]]; then
    docker logs --tail 200 "$test_container"
    exit 1
  fi
done
docker cp /opt/safety-training/app/scripts/production-auth-smoke.mjs \
  "$test_container":/tmp/production-auth-smoke.mjs >/dev/null
docker exec -e SMOKE_BASE_URL=http://127.0.0.1:3000 \
  -e SMOKE_USERNAME="$bootstrap_username" -e SMOKE_PASSWORD="$bootstrap_password" \
  "$test_container" node /tmp/production-auth-smoke.mjs

migration_count=$(docker compose --env-file .env.production exec -T postgres \
  psql -U postgres -d "$test_db" -Atc \
  'select count(*) from "_prisma_migrations" where finished_at is not null and rolled_back_at is null')
[[ "$migration_count" == 4 ]]
echo "ISOLATED_FINAL_REGRESSION=PASS migrations=$migration_count"
