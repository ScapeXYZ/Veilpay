#!/usr/bin/env bash
set -eu

readonly expected_backend_url="http://127.0.0.1:4100/api"
readonly expected_database_url="sqlite:///tmp/veilpay/veilpay-testnet.db"

require_exact() {
  local key="$1"
  local expected="$2"
  local actual="${!key-}"
  if [[ "$actual" != "$expected" ]]; then
    echo "Refusing unsafe public deployment: ${key} must be ${expected}" >&2
    exit 64
  fi
}

if [[ -z "${FRONTEND_ORIGIN-}" || ! "${FRONTEND_ORIGIN}" =~ ^https://[^/]+$ ]]; then
  echo "Refusing public deployment: FRONTEND_ORIGIN must be the exact HTTPS Render origin" >&2
  exit 64
fi

require_exact NETWORK testnet
require_exact WALLET_BACKEND zingo
require_exact VEILPAY_DEPLOYMENT_NETWORK testnet
require_exact NEXT_PUBLIC_API_MODE live
require_exact VEILPAY_PUBLIC_DEPLOYMENT 1
require_exact VEILPAY_BACKEND_URL "$expected_backend_url"
require_exact DATABASE_URL "$expected_database_url"

if [[ ! -w /tmp/veilpay ]]; then
  echo "Refusing deployment: disposable SQLite directory is not writable" >&2
  exit 73
fi

cd /app/frontend
/app/veilpay-backend &
backend_pid=$!
node server.js &
frontend_pid=$!

shutdown() {
  trap - INT TERM
  kill -TERM "$frontend_pid" "$backend_pid" 2>/dev/null || true
  wait "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

# PID 1 supervises both processes: an unexpected exit of either stops the
# container so Render can restart it rather than serving a partial application.
set +e
wait -n "$backend_pid" "$frontend_pid"
status=$?
set -e
kill -TERM "$frontend_pid" "$backend_pid" 2>/dev/null || true
wait "$frontend_pid" 2>/dev/null || true
wait "$backend_pid" 2>/dev/null || true
if [[ "$status" -eq 0 ]]; then
  exit 1
fi
exit "$status"
