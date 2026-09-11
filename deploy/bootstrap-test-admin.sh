#!/bin/sh
set -eu

root=/opt/safety-training
container=safety-training-postgres-1
account_count="$(docker exec "$container" psql -U postgres -d safety_training -Atc 'select count(*) from accounts')"

if [ "$account_count" != 0 ]; then
  printf 'ADMIN_BOOTSTRAP_SKIPPED\n'
  exit 0
fi

username=company_admin
password="$(openssl rand -base64 24 | tr '/+' '-_' | tr -d '\n')"
runtime_env="$(mktemp)"
trap 'rm -f "$runtime_env"' EXIT
cp "$root/.env.production" "$runtime_env"
printf 'ADMIN_BOOTSTRAP_USERNAME=%s\nADMIN_BOOTSTRAP_PASSWORD=%s\n' \
  "$username" "$password" >> "$runtime_env"
chmod 600 "$runtime_env"

docker run --rm --network safety-training-backend --env-file "$runtime_env" \
  safety-training-api:day2 node --import tsx prisma/seed.ts

umask 077
printf 'ADMIN_USERNAME=%s\nADMIN_PASSWORD=%s\n' "$username" "$password" \
  > "$root/.initial-admin"
chmod 600 "$root/.initial-admin"
printf 'ADMIN_BOOTSTRAP_OK\n'
