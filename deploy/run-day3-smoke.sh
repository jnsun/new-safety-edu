#!/bin/sh
set -eu

root=/opt/safety-training
db="safety_day3_smoke_$$"
container="safety-day3-smoke-$$"
runtime_env="$(mktemp)"
uploads="$(mktemp -d)"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then docker logs "$container" 2>/dev/null | tail -80 || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker exec safety-training-postgres-1 dropdb -U postgres --if-exists --force "$db" >/dev/null 2>&1 || true
  rm -f "$runtime_env"
  rm -rf "$uploads"
  exit "$status"
}
trap cleanup EXIT

case "$db" in safety_day3_smoke_*) ;; *) exit 1 ;; esac
docker exec safety-training-postgres-1 createdb -U postgres -O safety_app "$db"
database_url="$(sed -n 's/^DATABASE_URL=//p' "$root/.env.production")"
grep -v '^DATABASE_URL=' "$root/.env.production" > "$runtime_env"
printf 'DATABASE_URL=%s/%s\n' "${database_url%/*}" "$db" >> "$runtime_env"
chmod 600 "$runtime_env"

docker run --rm --network safety-training-backend --env-file "$runtime_env" \
  safety-training-api:day2 node_modules/.bin/prisma migrate deploy >/dev/null
chmod 777 "$uploads"
docker run -d --name "$container" --network safety-training-backend --env-file "$runtime_env" \
  -e PORT=3000 -e PUBLIC_BASE_URL=http://127.0.0.1:3000 -v "$uploads:/app/var/uploads" \
  safety-training-api:day2 >/dev/null

i=0
until docker exec "$container" node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>{if(!r.ok)process.exit(1)})' >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 30 ] || { docker logs "$container"; exit 1; }; sleep 1
done
docker cp /tmp/day3-smoke.ts "$container:/app/day3-smoke.ts"
docker exec "$container" node --import tsx day3-smoke.ts
