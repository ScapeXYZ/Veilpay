#!/usr/bin/env python3
"""Read-only NU7 public-testnet probe. Uses curl with HTTP/2 and Python stdlib."""
import json
import struct
import subprocess
from datetime import datetime, timezone

SERVER = "https://testnet.zec.rocks"


def varint(data, offset):
    value = shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
        shift += 7
        if shift > 63:
            raise ValueError("invalid protobuf varint")
    raise ValueError("truncated protobuf")


def fields(data):
    result = {}
    offset = 0
    while offset < len(data):
        tag, offset = varint(data, offset)
        wire = tag & 7
        if wire == 0:
            value, offset = varint(data, offset)
        elif wire == 2:
            size, offset = varint(data, offset)
            value = data[offset:offset + size]
            offset += size
            if len(value) != size:
                raise ValueError("truncated protobuf field")
        else:
            raise ValueError("unexpected protobuf wire type")
        result[tag >> 3] = value
    return result


def rpc(method):
    response = subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--http2", "--max-time", "30",
        "-H", "content-type: application/grpc", "-H", "te: trailers",
        "--data-binary", "@-", f"{SERVER}/cash.z.wallet.sdk.rpc.CompactTxStreamer/{method}",
    ], input=bytes(5), capture_output=True, check=True).stdout
    if len(response) < 5 or response[0] != 0:
        raise ValueError("missing or compressed gRPC response")
    size = struct.unpack(">I", response[1:5])[0]
    if len(response[5:]) != size:
        raise ValueError("invalid gRPC response length")
    return fields(response[5:])


def main():
    info, block = rpc("GetLightdInfo"), rpc("GetLatestBlock")
    text = lambda key: info.get(key, b"").decode("utf-8")
    if text(4) != "test" or text(6).lower() != "77190ad9" or block[1] < 4465026:
        raise SystemExit("REFUSED: server does not report activated NU7 public testnet")
    faucet = subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--max-time", "30",
        "https://faucet.testnet.valargroup.dev/api/status",
    ], capture_output=True, check=True)
    status = json.loads(faucet.stdout)
    print(json.dumps({
        "checkedAt": datetime.now(timezone.utc).isoformat(), "server": SERVER,
        "network": text(4), "branchId": text(6), "height": block[1],
        "nodeVersion": text(13), "lightwalletdVersion": text(1),
        "faucet": {k: status.get(k) for k in ["ready", "network", "walletSynced", "chainHeight", "payout", "capRemaining"]},
        "fundingRequested": False, "transactionSent": False,
    }, indent=2))


if __name__ == "__main__":
    main()
