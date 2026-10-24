#!/usr/bin/env python3
"""Create separate local testnet wallets and shielded addresses; never sends funds."""
import json
import os
from pathlib import Path
import subprocess
import sys

os.umask(0o077)
ROOT = Path(os.environ.get("VEILPAY_WALLET_ROOT", str(Path.home() / ".local/share/veilpay-testnet"))).resolve()
REPO = Path(__file__).resolve().parents[1]
BINARY = ROOT / "bin/zingo-cli"


def objects(raw):
    decoder = json.JSONDecoder()
    for offset, char in enumerate(raw):
        if char == "{":
            try:
                obj, _ = decoder.raw_decode(raw[offset:])
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                yield obj


def run(role, *args):
    directory = ROOT / role
    with (directory / "provision-private.log").open("ab") as log:
        result = subprocess.run([
            str(BINARY), "--chain", "testnet", "--offline", "--birthday", "4533641",
            "--data-dir", str(directory), *args,
        ], stdout=subprocess.PIPE, stderr=log, timeout=120)
        if result.returncode:
            # Raw output may contain wallet material. Keep it owner-only, outside Git.
            log.write(result.stdout)
            raise SystemExit(f"{role}: wallet command failed; inspect private local logs")
        return result.stdout.decode("utf-8")


def main():
    if ROOT == REPO or REPO in ROOT.parents:
        raise SystemExit("Wallet root must be outside the repository")
    if not BINARY.is_file():
        raise SystemExit(f"Install the pinned zingo-cli at {BINARY} first")
    addresses = {}
    for role in ["customer", "merchant"]:
        directory = ROOT / role
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        metadata = directory / "receiving-address.json"
        if metadata.exists():
            address = json.loads(metadata.read_text())
        else:
            raw = run(role, "new_address", "o")
            matches = [o for o in objects(raw) if "encoded_address" in o]
            if len(matches) != 1:
                raise SystemExit(f"{role}: address output did not match the pinned CLI schema")
            address = matches[0]
            if not address.get("has_orchard") or address.get("has_transparent") or not address["encoded_address"].startswith("utest1"):
                raise SystemExit(f"{role}: wallet did not generate a shielded testnet address")
            metadata.write_text(json.dumps(address, indent=2) + "\n")
        backup = directory / "recovery-private.json"
        if not backup.exists():
            backup.write_text(run(role, "recovery_info"))
        addresses[role] = {"address": address["encoded_address"], "addressIndex": address["address_index"]}
    if addresses["customer"]["address"] == addresses["merchant"]["address"]:
        raise SystemExit("Refused identical wallet addresses")
    print(json.dumps({"network": "testnet", "walletRoot": str(ROOT), "wallets": addresses,
                      "fundingRequested": False, "transactionSent": False}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except subprocess.TimeoutExpired:
        sys.exit("Wallet command timed out; inspect private local logs")
