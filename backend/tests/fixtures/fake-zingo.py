#!/usr/bin/python3
"""Synthetic process fixture. Never reads a wallet or uses the network."""
import json
import os
from pathlib import Path
import sys
root = Path.cwd()
fixture = json.loads((root / 'fixture.json').read_text())
with (root / 'calls.jsonl').open('a') as calls:
    calls.write(json.dumps({'args': sys.argv[1:], 'seedPresent': 'ZINGO_SEED' in os.environ}) + '\n')
if os.environ.get('VEILPAY_MACHINE') == '1':
    assert '--offline' in sys.argv and '--server' not in sys.argv
    for line in sys.stdin:
        command = line.strip().split()[0]
        with (root / 'steps.txt').open('a') as steps:
            steps.write(command + '\n')
        if command == 'send':
            value = {'fee': 1000}
        elif command == 'calculate':
            value = {'txids': ['a' * 64]}
        elif command == 'quit':
            value = {}
        else:
            raise SystemExit(2)
        print(json.dumps({'ok': True, 'output': json.dumps(value)}), flush=True)
        if command == 'quit':
            break
elif 'new_address' in sys.argv:
    assert '--offline' in sys.argv
    print(json.dumps(fixture['address']))
elif 'balance' in sys.argv:
    assert '--offline' in sys.argv
    print(json.dumps(fixture['balance']))
elif 'info' in sys.argv:
    assert '--chain' in sys.argv and 'testnet' in sys.argv
    print(json.dumps({'chain_name': 'main' if (root / 'wrong-network').exists() else 'test', 'latest_block_height': 4534002}))
elif 'transactions' in sys.argv:
    assert '--waitsync' in sys.argv or '--offline' in sys.argv
    if '--offline' in sys.argv:
        fixture['history']['transaction_summaries'][0]['status'] = 'calculated'
    print(json.dumps(fixture['history']))
elif 'transmit' in sys.argv:
    print(json.dumps({'txids': [sys.argv[-1]]}))
else:
    raise SystemExit(3)
