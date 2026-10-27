#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../docker-entrypoint.sh
source "${repo_root}/docker-entrypoint.sh"

test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
test_uid="$(id -u)"
test_gid="$(id -g)"

expect_rejection() {
  if "$@"; then
    echo "expected rejection: $*" >&2
    exit 1
  fi
}

# A runtime tmpfs can omit the image-layer directory entirely.
missing_directory="${test_root}/missing"
ensure_sqlite_directory "$missing_directory" "$test_uid" "$test_gid"
[[ -d "$missing_directory" ]]
[[ "$(stat -c '%a:%u:%g' -- "$missing_directory")" == "700:${test_uid}:${test_gid}" ]]

# Existing private state remains usable without any chmod/chown repair.
private_directory="${test_root}/private"
mkdir --mode=0700 -- "$private_directory"
ensure_sqlite_directory "$private_directory" "$test_uid" "$test_gid"

symlink_directory="${test_root}/symlink"
ln -s "$private_directory" "$symlink_directory"
expect_rejection ensure_sqlite_directory "$symlink_directory" "$test_uid" "$test_gid"

# A mismatched expected owner models a path controlled by another principal.
expect_rejection ensure_sqlite_directory "$private_directory" "$((test_uid + 1))" "$test_gid"

# Exercise the real write-probe failure path without weakening the production
# function: a test-only mktemp shim makes its create operation fail.
fake_bin="${test_root}/fake-bin"
mkdir -- "$fake_bin"
printf '#!/usr/bin/env bash\nexit 1\n' > "${fake_bin}/mktemp"
chmod 0700 "${fake_bin}/mktemp"
PATH="${fake_bin}:${PATH}" expect_rejection ensure_sqlite_directory "$private_directory" "$test_uid" "$test_gid"

echo "render entrypoint preflight tests passed"
