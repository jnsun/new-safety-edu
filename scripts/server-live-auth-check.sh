#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1}"
credentials_file="${2:-/opt/safety-training/.initial-admin}"
cookie_jar=$(mktemp)
headers_file=$(mktemp)
trap 'rm -f "$cookie_jar" "$headers_file"' EXIT

set -a
# shellcheck disable=SC1090
. "$credentials_file"
set +a

login_status=$(python3 -c \
  'import json,os; print(json.dumps({"username":os.environ["ADMIN_USERNAME"],"password":os.environ["ADMIN_PASSWORD"]}))' |
  curl --silent --show-error --output /dev/null --dump-header "$headers_file" \
    --cookie-jar "$cookie_jar" --header 'content-type: application/json' \
    --data-binary @- --write-out '%{http_code}' "$base_url/api/auth/login")
[[ "$login_status" == 200 ]]
grep -qi 'HttpOnly' "$headers_file"
grep -qi 'SameSite=Strict' "$headers_file"
if [[ "$base_url" == https://* ]]; then
  grep -qi 'Secure' "$headers_file"
fi

me_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --write-out '%{http_code}' "$base_url/api/auth/me")
refresh_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --write-out '%{http_code}' "$base_url/api/auth/me")
page_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --write-out '%{http_code}' "$base_url/")
overview_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --write-out '%{http_code}' "$base_url/api/management/overview")
logout_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --cookie-jar "$cookie_jar" --request POST --write-out '%{http_code}' "$base_url/api/auth/logout")
after_logout_status=$(curl --silent --show-error --output /dev/null --cookie "$cookie_jar" \
  --write-out '%{http_code}' "$base_url/api/auth/me")
[[ "$me_status" == 200 && "$refresh_status" == 200 && "$page_status" == 200 ]]
[[ "$overview_status" == 200 && "$logout_status" == 204 && "$after_logout_status" == 401 ]]

echo "LIVE_AUTH=PASS login=$login_status me=$me_status refresh=$refresh_status page=$page_status overview=$overview_status logout=$logout_status after_logout=$after_logout_status"
