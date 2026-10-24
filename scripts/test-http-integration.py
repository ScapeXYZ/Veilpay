#!/usr/bin/env python3
"""Run frontend HTTP checks against Axum with a disposable mock database."""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
subprocess.run(['cargo', 'build', '--manifest-path', 'backend/Cargo.toml', '--bin', 'veilpay-backend'], cwd=ROOT, check=True)
with tempfile.TemporaryDirectory(prefix='veilpay-http-') as directory:
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    database = Path(directory) / 'mock.sqlite'
    # Start from a minimal environment: never inherit wallet paths or transport settings.
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'SYSTEMROOT')}
    env.update(DATABASE_URL=f'sqlite://{database}', WALLET_BACKEND='mock', NETWORK='regtest',
               FRONTEND_ORIGIN=origin, BIND_ADDR=f'127.0.0.1:{port}')
    backend = subprocess.Popen([str(ROOT / 'backend/target/debug/veilpay-backend')], cwd=ROOT, env=env)
    try:
        for _ in range(100):
            if backend.poll() is not None:
                raise RuntimeError('Axum exited before becoming ready')
            try:
                with urllib.request.urlopen(f'{origin}/api/health', timeout=1) as response:
                    health = json.load(response)
                assert health['mode'] == 'mock' and health['walletBackend'] == 'mock'
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Axum readiness timed out')
        # Persisted unresolved observations exercise HTTP serialization and UI without a wallet.
        now = '2026-01-01T00:00:00Z'
        with sqlite3.connect(database) as connection:
            for suffix, operation in [('operator00001', {'needsOperator': True, 'state': 'unknown'}),
                                      ('pending000001', {'needsOperator': False, 'state': 'pending'}),
                                      ('prepared00001', {'needsOperator': False, 'state': 'pending',
                                                         'requiresOperatorConfirmation': True, 'phase': 'prepared'})]:
                payment = dict(id=f'pay_{suffix}', agentId='agt_fixture00001', merchantId='mer_demo',
                               invoiceId='inv_fixture00001', amountZat='1', reference='Persisted mock review fixture',
                               status='submitted', createdAt=now, txid=None, pool=None, mockRef='mock_fixture',
                               decision=dict(id='dec_fixture', result='authorized', policyVersion=1,
                                             evaluatedAt=now, violations=[], auditHash='fixture'), timeline=[],
                               walletOperation=dict(id=f'op_{suffix}', attempt=1, **operation))
                connection.execute('INSERT INTO records(kind,id,owner,body) VALUES(?,?,?,?)',
                                   ('payment', payment['id'], 'customer_demo', json.dumps(payment)))
        test_env = os.environ.copy()
        test_env.pop('INTEGRATION_SELF', None)
        test_env.update(BACKEND_URL=f'{origin}/api', AXUM_REVIEW_FIXTURES='1')
        subprocess.run(['npm', 'test', '--', 'src/lib/api/http.integration.test.ts'], cwd=ROOT, env=test_env, check=True)
    finally:
        backend.terminate()
        try:
            backend.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend.kill()
            backend.wait()
