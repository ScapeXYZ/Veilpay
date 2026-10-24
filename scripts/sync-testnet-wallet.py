#!/usr/bin/env python3
"""Back up and synchronize an existing wallet using the patched pinned CLI."""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
from datetime import datetime, timezone


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=["customer", "merchant"], nargs="?", default="customer")
    args = parser.parse_args()
    root = Path(os.environ.get("VEILPAY_WALLET_ROOT", str(Path.home() / ".local/share/veilpay-testnet"))).resolve()
    wallet = root / args.role
    required = ["zingo-wallet.dat", "receiving-address.json", "recovery-private.json"]
    if not all((wallet / name).is_file() for name in required):
        raise SystemExit("Refused: existing wallet and recovery files are required")
    patch = Path(__file__).resolve().parent / "patches/zingo-waitsync.patch"
    marker = root / "source-patch-checksum"
    if not marker.is_file() or marker.read_text().split()[0] != hashlib.sha256(patch.read_bytes()).hexdigest():
        raise SystemExit("Install the pinned CLI with the waitsync patch first")
    with (root / "sync.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backups = root / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        backup = backups / f"{args.role}-{stamp}"
        shutil.copytree(wallet, backup)
        log_path = root / f"{args.role}-sync-{stamp}.log"
        command = [str(root / "bin/zingo-cli"), "--chain", "testnet", "--server",
                   "https://testnet.zec.rocks:443", "--data-dir", str(wallet),
                   "--waitsync", "sync", "status"]
        print(f"Backup: {backup}\nPrivate diagnostic log: {log_path}", flush=True)
        with log_path.open("w") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        for name in ["receiving-address.json", "recovery-private.json"]:
            if (wallet / name).read_bytes() != (backup / name).read_bytes():
                raise SystemExit(f"Refused: {name} changed; preserve backup and inspect locally")
        output = log_path.read_text()
        height = re.search(r"sync end height: (\d+)", output)
        complete = re.search(r"percentage total outputs scanned: 100(?:\.0+)?\s", output)
        if result.returncode or not height or not complete:
            raise SystemExit("Sync did not prove completion; inspect the private log. Rerun to resume saved progress.")
        print(f"Synchronized {args.role} through block {height[1]}. Receiving and recovery files unchanged.")


if __name__ == "__main__":
    main()
