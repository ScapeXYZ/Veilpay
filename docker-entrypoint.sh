#!/usr/bin/env bash
set -eu

readonly expected_backend_url="http://127.0.0.1:4100/api"
readonly expected_database_url="sqlite:///tmp/veilpay/veilpay-testnet.db"
readonly sqlite_directory="/tmp/veilpay"
readonly runtime_uid="10001"
readonly runtime_gid="10001"

require_exact() {
  local key="$1"
  local expected="$2"
  local actual="${!key-}"
  if [[ "$actual" != "$expected" ]]; then
    echo "Refusing unsafe public deployment: ${key} must be ${expected}" >&2
    exit 64
  fi
}

runtime_diagnostics() {
  echo "Render runtime diagnostic: uid=$(id -u) gid=$(id -g) groups=$(id -G)" >&2
  for path in / /tmp /tmp/veilpay; do
    if [[ -e "$path" ]]; then
      stat -c "Render runtime diagnostic: path=%n mode=%a owner=%u group=%g type=%F" "$path" >&2
    else
      echo "Render runtime diagnostic: path=${path} missing" >&2
    fi
  done
  if command -v findmnt >/dev/null 2>&1; then
    findmnt -T /tmp/veilpay -no TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null \
      | sed 's/^/Render runtime diagnostic: mount=/' >&2 || true
  elif [[ -r /proc/self/mountinfo ]]; then
    awk '$5 == "/" || $5 == "/tmp" || $5 == "/tmp/veilpay" { print "Render runtime diagnostic: mount=" $0 }' \
      /proc/self/mountinfo >&2 || true
  fi
}

reject_sqlite_directory() {
  echo "Refusing deployment: unsafe disposable SQLite directory ($1)" >&2
  return 73
}

ensure_sqlite_directory() {
  local directory="$1"
  local expected_uid="$2"
  local expected_gid="$3"
  local owner group mode probe

  # Do not repair an existing path: another principal may own it. Creation is
  # atomic under the sticky /tmp parent and the resulting directory is private.
  if [[ -L "$directory" ]]; then
    reject_sqlite_directory "symlink"
    return $?
  fi
  if [[ ! -e "$directory" ]]; then
    if ! mkdir --mode=0700 -- "$directory"; then
      reject_sqlite_directory "creation failed"
      return $?
    fi
  fi
  if [[ -L "$directory" || ! -d "$directory" ]]; then
    reject_sqlite_directory "not a directory"
    return $?
  fi

  owner=$(stat -c '%u' -- "$directory")
  group=$(stat -c '%g' -- "$directory")
  mode=$(stat -c '%a' -- "$directory")
  if [[ "$owner" != "$expected_uid" || "$group" != "$expected_gid" || "$mode" != "700" ]]; then
    reject_sqlite_directory "owner or mode mismatch"
    return $?
  fi

  # [[ -w ]] is an access hint. This verifies the actual SQLite directory can
  # create and remove a file under the service identity.
  if ! probe=$(mktemp "${directory}/.veilpay-write-probe.XXXXXX"); then
    reject_sqlite_directory "write probe creation failed"
    return $?
  fi
  if ! rm -- "$probe"; then
    reject_sqlite_directory "write probe removal failed"
    return $?
  fi
}

main() {
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
  require_exact BIND_ADDR 127.0.0.1:4100
  require_exact DATABASE_URL "$expected_database_url"

  # Image-layer ownership cannot establish the runtime mount or user Render
  # assigns. Log only identity and filesystem metadata, never settings.
  runtime_diagnostics
  if [[ "$(id -u)" != "$runtime_uid" || "$(id -g)" != "$runtime_gid" ]]; then
    reject_sqlite_directory "unexpected runtime identity"
    exit $?
  fi
  if ! ensure_sqlite_directory "$sqlite_directory" "$runtime_uid" "$runtime_gid"; then
    exit 73
  fi
  if [[ ! -w "$sqlite_directory" ]]; then
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
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
