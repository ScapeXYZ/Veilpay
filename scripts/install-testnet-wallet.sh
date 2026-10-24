#!/usr/bin/env bash
# Build an exact NU7-capable source revision. This script creates no wallet and sends nothing.
set -euo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
revision=6d43e7c48343cc39cf99bad7e05349baaf4f0b90
wallet_root="${VEILPAY_WALLET_ROOT:-$HOME/.local/share/veilpay-testnet}"
source_root="${VEILPAY_WALLET_SOURCE:-/tmp/veilpay-zingo-6d43e7c-m3}"
install_root="${VEILPAY_WALLET_INSTALL:-/tmp/veilpay-zingo-install}"
pkg-config --exists sqlite3 openssl
cargo +stable --version
mkdir -p "$source_root" "$wallet_root/bin"
chmod 700 "$wallet_root" "$wallet_root/bin"
if [[ ! -f "$source_root/zingo-cli/Cargo.toml" ]]; then
  archive="${source_root}.tar.gz"
  curl --fail --location --silent --show-error --retry 2 --max-time 300 \
    "https://api.github.com/repos/zingolabs/zingolib/tarball/$revision" --output "$archive"
  tar -xzf "$archive" -C "$source_root" --strip-components=1
  printf '%s\n' "$revision" > "$source_root/.veilpay-source-revision"
fi
if [[ ! -f "$source_root/.veilpay-source-revision" ]] || [[ "$(cat "$source_root/.veilpay-source-revision")" != "$revision" ]]; then
  printf 'Refused unverified source directory; choose a new VEILPAY_WALLET_SOURCE\n' >&2
  exit 1
fi
cd "$source_root"
sync_patch="$script_dir/patches/zingo-waitsync.patch"
if patch --dry-run --batch --forward --silent -p1 < "$sync_patch"; then
  patch --batch --forward --silent -p1 < "$sync_patch"
elif ! patch --dry-run --batch --silent --reverse -p1 < "$sync_patch"; then
  printf 'Refused source incompatible with the pinned waitsync patch\n' >&2
  exit 1
fi
transport_patch="$script_dir/patches/zingo-structured-transport.patch"
if patch --dry-run --batch --forward --silent -p1 < "$transport_patch"; then
  patch --batch --forward --silent -p1 < "$transport_patch"
elif ! patch --dry-run --batch --silent --reverse -p1 < "$transport_patch"; then
  printf 'Refused source incompatible with the structured transport patch\n' >&2
  exit 1
fi
cargo +stable install --path zingo-cli --locked --root "$install_root" --jobs 2
cargo +stable install --path zingo-netutils --locked --features nym --bin nym-proxy --root "$install_root" --jobs 2
install -m 700 "$install_root/bin/zingo-cli" "$wallet_root/bin/zingo-cli"
install -m 700 "$install_root/bin/nym-proxy" "$wallet_root/bin/nym-proxy"
printf '%s\n' "$revision" > "$wallet_root/source-revision"
sha256sum "$sync_patch" > "$wallet_root/source-patch-checksum"
sha256sum "$transport_patch" > "$wallet_root/transport-patch-checksum"
sha256sum "$wallet_root/bin/zingo-cli" "$wallet_root/bin/nym-proxy" > "$wallet_root/binary-checksums"
printf 'Installed pinned CLI and proxy under %s/bin\n' "$wallet_root"
