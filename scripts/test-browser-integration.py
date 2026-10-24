#!/usr/bin/env python3
"""Real Chromium smoke suite. Requires Python Playwright and installed Chromium."""
import argparse, hashlib, json, os, signal, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['dev', 'production'], default='dev')
parser.add_argument('--bundler', choices=['webpack', 'turbopack'], default='turbopack')
parser.add_argument('--mobile', action='store_true')
parser.add_argument('--label', default='diagnostic')
parser.add_argument('--hmr-edits', type=int, default=0)
parser.add_argument('--reloads', type=int, default=0)
args = parser.parse_args()
if args.hmr_edits and args.mode != 'dev': parser.error('--hmr-edits requires development mode')
OUT = ROOT / 'docs/images/milestone5' / args.label
OUT.mkdir(parents=True, exist_ok=True)
results = {'checks': [], 'consoleErrors': [], 'pageErrors': [], 'failedRequests': [], 'httpErrors': [], 'apiOrigins': [], 'diagnosticsPassed': False, 'runtimeExceptions': [], 'responses': [], 'websockets': [], 'reloadsCompleted': 0, 'hmrUpdatesCompleted': 0}
def check(name):
    results['checks'].append(name)
    print('PASS:', name, flush=True)
def ready(url, process):
    for _ in range(180):
        if process.poll() is not None: raise RuntimeError(f'Server exited: {url}')
        try:
            with urllib.request.urlopen(url, timeout=1) as r: return r.read()
        except OSError: time.sleep(.5)
    raise RuntimeError(f'Readiness timeout: {url}')
with tempfile.TemporaryDirectory(prefix='veilpay-browser-') as tmp:
    processes = []
    try:
        env = {k:v for k,v in os.environ.items() if k in ('PATH','LANG','SYSTEMROOT')}
        env.update(DATABASE_URL=f'sqlite://{tmp}/mock.sqlite', WALLET_BACKEND='mock', NETWORK='regtest', FRONTEND_ORIGIN='http://127.0.0.1:3100', BIND_ADDR='127.0.0.1:4000')
        log = open(f'{tmp}/backend.log','w+')
        processes.append(subprocess.Popen([str(ROOT/'backend/target/debug/veilpay-backend')], cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True))
        health = json.loads(ready('http://127.0.0.1:4000/api/health', processes[-1]))
        assert health['walletBackend'] == 'mock' and health['network'] == 'regtest'
        frontenv = os.environ.copy()
        frontenv.update(NEXT_PUBLIC_API_MODE='live', NEXT_PUBLIC_API_BASE='/api', VEILPAY_BACKEND_URL='http://127.0.0.1:4000/api')
        frontlog = open(f'{tmp}/next.log','w+')
        processes.append(subprocess.Popen((['npm','run','dev','--','--'+args.bundler] if args.mode == 'dev' else ['npm','run','start']), cwd=ROOT, env=frontenv, stdout=frontlog, stderr=frontlog, start_new_session=True))
        ready('http://127.0.0.1:3100/api/health', processes[-1])
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            results['chromium'] = browser.version
            results['mode'] = args.mode
            results['bundler'] = args.bundler if args.mode == 'dev' else None
            private = OUT/'private'
            private.mkdir(exist_ok=True)
            contexts = []
            def context_new():
                ctx = browser.new_context(viewport={'width':390,'height':844} if args.mobile else {'width':1440,'height':1000})
                ctx.tracing.start(screenshots=True, snapshots=True, sources=True)
                contexts.append(ctx)
                return ctx
            def page_new(ctx):
                page = ctx.new_page()
                page.set_default_navigation_timeout(90000)
                # CDP retains source coordinates for syntax errors whose pageerror has no stack.
                cdp = ctx.new_cdp_session(page)
                cdp.send('Runtime.enable')
                cdp.send('Debugger.enable')
                def runtime_exception(event):
                    detail = event['exceptionDetails']
                    results['runtimeExceptions'].append({k: detail[k] for k in
                        ('text', 'url', 'lineNumber', 'columnNumber', 'scriptId', 'stackTrace') if k in detail})
                cdp.on('Runtime.exceptionThrown', runtime_exception)
                def script_failed(event):
                    record = {k: event[k] for k in ('url', 'scriptId', 'startLine', 'startColumn', 'endLine', 'endColumn') if k in event}
                    try:
                        source = cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                        filename = f'syntax-{len(results["runtimeExceptions"])}-{event["scriptId"]}.js'
                        (private/filename).write_text(source)
                        record.update(sourceFile='private/'+filename, sha256=hashlib.sha256(source.encode()).hexdigest())
                    except Exception as error: record['captureError'] = str(error)
                    results['runtimeExceptions'].append({'scriptFailedToParse': record})
                cdp.on('Debugger.scriptFailedToParse', script_failed)
                def response_finished(request):
                    response = request.response()
                    if response is None: return
                    if request.resource_type not in ('document', 'script', 'fetch', 'xhr'): return
                    record = dict(url=response.url, status=response.status, method=request.method,
                                  resourceType=request.resource_type, contentType=response.headers.get('content-type'),
                                  at=time.time(), headers={k:v for k,v in response.headers.items() if k in
                                  ('content-length', 'content-encoding', 'transfer-encoding', 'etag', 'cache-control')})
                    try:
                        body = response.body()
                        filename = f'response-{len(results["responses"])}.body'
                        (private/filename).write_bytes(body)
                        record.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), bodyFile='private/'+filename)
                    except Exception as error: record['captureError'] = str(error)
                    results['responses'].append(record)
                page.on('requestfinished', response_finished)
                def websocket_open(socket):
                    def received(payload):
                        try:
                            message = json.loads(payload)
                            results['websockets'].append({'url': socket.url, 'at': time.time(), 'type': message.get('type'), 'action': message.get('action')})
                        except (ValueError, TypeError):
                            results['websockets'].append({'url': socket.url, 'nonJson': True})
                    socket.on('framereceived', received)
                page.on('websocket', websocket_open)
                page.on('console', lambda m: results['consoleErrors'].append({'text':m.text,'location':m.location}) if m.type == 'error' else None)
                page.on('pageerror', lambda e: results['pageErrors'].append({'message':str(e),'stack':e.stack}))
                page.on('requestfailed', lambda r: results['failedRequests'].append({'url':r.url,'error':r.failure}))
                page.on('response', lambda r: results['httpErrors'].append({'url':r.url,'status':r.status}) if r.status >= 400 else None)
                page.on('request', lambda r: results['apiOrigins'].append(r.url.split('/api/')[0]) if '/api/' in r.url else None)
                return page
            def fetch(page, path, method='GET', body=None, headers=None):
                return page.evaluate('''async ({path,method,body,headers}) => {const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===null?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}}''',dict(path=path,method=method,body=body,headers=headers or {}))
            try:
                merchant = context_new()
                m = page_new(merchant)
                m.goto('http://127.0.0.1:3100/merchant', wait_until='domcontentloaded')
                m.wait_for_load_state('networkidle')
                expect(m.get_by_test_id('ctx-customer')).to_have_attribute('aria-pressed', 'true')
                expect(m.get_by_test_id('ctx-customer')).to_be_enabled()
                m.get_by_test_id('ctx-merchant').click()
                expect(m.get_by_test_id('create-invoice')).to_be_visible()
                card=m.get_by_test_id('create-invoice')
                card.get_by_label('Reference').fill('M5 browser invoice')
                card.get_by_label('Amount (ZEC)').fill('0.02')
                with m.expect_response(lambda r: r.url.endswith('/api/merchant/invoices') and r.request.method=='POST') as response:
                    card.get_by_role('button',name='Create invoice',exact=True).click()
                invoice=response.value.json(); iid=invoice['id']
                expect(m.get_by_test_id('invoice-no-qr')).to_contain_text('DEMO ONLY')
                assert m.locator('a[href^="zcash:"], textarea').count()==0
                assert fetch(m,'/merchant/invoices/'+iid)['body']['id']==iid
                m.screenshot(path=str(OUT/'01-merchant-invoice-desktop.png'),full_page=True)
                check('Fresh merchant creates invoice; real detail GET; mock request has no wallet URI or QR')
                m.reload(); expect(m.get_by_test_id('invoices')).to_contain_text(iid)
                check('Merchant cookie and invoice list survive reload; inline created detail is in memory')
                customer=context_new()
                c=page_new(customer); c.goto('http://127.0.0.1:3100/', wait_until='domcontentloaded')
                c.wait_for_load_state('networkidle')
                c.get_by_test_id('ctx-customer').click()
                with c.expect_response(lambda r:r.url.endswith('/api/agents') and r.request.method=='POST') as response:
                    c.get_by_role('button',name='Create demo agent').click()
                aid=response.value.json()['id']
                expect(c.get_by_test_id('agent-summary')).to_be_visible()
                check('Separate fresh customer creates and selects agent')
                assert fetch(c,'/merchant/invoices/'+iid)['status'] in (403,404)
                assert fetch(m,'/agents/'+aid)['status'] in (403,404)
                check('Customer cannot read merchant invoice; merchant cannot read customer agent')
                c.get_by_role('link',name='Agent policy',exact=True).click()
                c.get_by_label('Per-payment cap (ZEC)').fill('0.01')
                c.get_by_label('Total budget (ZEC)').fill('0.05')
                c.get_by_test_id('save-policy').click()
                expect(c.get_by_test_id('policy-form')).to_contain_text('Policy v2')
                c.screenshot(path=str(OUT/'02-policy-desktop.png'),full_page=True)
                c.get_by_role('link',name='Overview',exact=True).click()
                form=c.get_by_test_id('request-happy')
                form.get_by_label('Invoice id').fill(iid); form.get_by_label('Amount (ZEC)').fill('0.02')
                with c.expect_response(lambda r:r.url.endswith('/api/payments/request')) as response: form.get_by_role('button').click()
                blocked=response.value.json(); assert blocked['status']=='rejected'
                expect(c.get_by_test_id('payment-detail')).to_contain_text('Blocked')
                c.screenshot(path=str(OUT/'03-policy-blocked-desktop.png'),full_page=True)
                check('Saved policy v2 rejects invoice above per-payment cap in actual UI')
                c.get_by_role('link',name='Agent policy',exact=True).click()
                c.get_by_label('Per-payment cap (ZEC)').fill('0.03'); c.get_by_test_id('save-policy').click()
                expect(c.get_by_test_id('policy-form')).to_contain_text('Policy v3')
                c.get_by_role('link',name='Overview',exact=True).click()
                form=c.get_by_test_id('request-happy'); form.get_by_label('Invoice id').fill(iid); form.get_by_label('Amount (ZEC)').fill('0.02')
                with c.expect_response(lambda r:r.url.endswith('/api/payments/request')) as response: form.get_by_role('button').click()
                payment=response.value.json(); pid=payment['id']; assert payment['status']=='authorized'
                with c.expect_response(lambda r:r.url.endswith('/execute')) as response: c.get_by_test_id('execute').click()
                executed=response.value.json(); req=response.value.request
                assert executed['status']=='confirmed' and executed['txid'] is None and executed['mockRef']
                headers={k:v for k,v in req.all_headers().items() if k in ('x-csrf-token','idempotency-key')}
                replay=fetch(c,'/payments/'+pid+'/execute','POST',headers=headers)
                assert replay['status']==202 and replay['body']==executed, (replay, executed)
                c.screenshot(path=str(OUT/'04-mock-payment-desktop.png'),full_page=True)
                check('Browser executes mock payment; exact idempotency replay returns identical confirmed result with no txid')
                m.get_by_label('Payment ID to verify').fill(pid); m.get_by_role('button',name='Check',exact=True).click()
                expect(m.get_by_test_id('verification-method')).to_contain_text('Simulated, no chain read')
                m.get_by_test_id('ack').click(); expect(m.get_by_test_id('acknowledged')).to_be_visible()
                m.screenshot(path=str(OUT/'05-merchant-ack-desktop.png'),full_page=True)
                assert fetch(m,'/merchant/invoices/'+iid)['body']['status']=='paid'
                check('Merchant verifies mock receipt, acknowledges, and refreshed invoice is paid')
                cookies=customer.cookies(); assert cookies and all(x['httpOnly'] and x['secure'] and x['sameSite']=='Strict' for x in cookies)
                assert 'veilpay' not in c.evaluate('document.cookie').lower()
                assert fetch(c,'/agents/'+aid,'PATCH',{'status':'paused'})['status']==403
                assert fetch(c,'/agents/'+aid,'PATCH',{'status':'paused'},{'X-CSRF-Token':'wrong'})['status']==403
                results['cookieAttributes']=[{k:v for k,v in x.items() if k!='value'} for x in cookies]
                assert set(results['apiOrigins'])=={'http://127.0.0.1:3100'}
                check('Chromium accepts localhost Secure HttpOnly Strict cookie; missing/wrong CSRF rejected; all API requests same origin')
                c.reload(); c.wait_for_timeout(1500)
                c.screenshot(path=str(OUT/'08-customer-reload-desktop.png'),full_page=True)
                c.get_by_role('button',name='Select agent').wait_for(timeout=5000)
                c.get_by_label('Existing agent ID').fill(aid); c.get_by_role('button',name='Select agent').click()
                expect(c.get_by_test_id('agent-summary')).to_contain_text('0.03')
                check('Reload restores customer session; agent selection resets and existing ID reselects persisted policy')
                m.get_by_label('Payment ID to verify').fill('pay_missing000000'); m.get_by_role('button',name='Check',exact=True).click()
                expect(m.get_by_role('alert')).to_contain_text('No payment found')
                m.screenshot(path=str(OUT/'06-api-error-desktop.png'),full_page=True)
                check('Real API 404 renders friendly recoverable merchant lookup alert')
                for page,name in [(c,'customer'),(m,'merchant')]:
                    page.set_viewport_size({'width':390,'height':844})
                    page.screenshot(path=str(OUT/f'07-{name}-mobile.png'),full_page=True)
                    widths=page.evaluate('({viewport:innerWidth,scroll:document.documentElement.scrollWidth})')
                    assert widths['scroll']<=widths['viewport'], widths
                check('390px mobile customer and merchant layouts have no document horizontal overflow')
                for _ in range(args.reloads):
                    for page in (m, c):
                        page.reload(wait_until='domcontentloaded')
                        control = page.get_by_test_id('ctx-merchant' if page == m else 'ctx-customer')
                        expect(control).to_have_attribute('aria-pressed', 'true')
                        expect(control).to_be_enabled()
                        results['reloadsCompleted'] += 1
                if args.hmr_edits:
                    source = ROOT/'src/components/source.tsx'
                    original = source.read_text()
                    anchor = 'Mock mode: simulated backend.'
                    assert original.count(anchor) == 1
                    try:
                        for edit in range(args.hmr_edits):
                            marker = f'HMR probe {edit + 1}.'
                            source.write_text(original.replace(anchor, anchor+' '+marker))
                            for page in (m, c):
                                expect(page.get_by_test_id('mock-banner')).to_contain_text(marker, timeout=30000)
                                context_control = page.get_by_test_id('ctx-merchant' if page == m else 'ctx-customer')
                                expect(context_control).to_be_enabled()
                                expect(context_control).to_have_attribute('aria-pressed', 'true')
                            results['hmrUpdatesCompleted'] += 1
                    finally:
                        source.write_text(original)
                    for page in (m, c):
                        expect(page.get_by_test_id('mock-banner')).not_to_contain_text('HMR probe', timeout=30000)
                    check('Live source edits refresh both browser contexts; original source restored')
                assert not results['runtimeExceptions'], results['runtimeExceptions']
                assert not results['pageErrors'], results['pageErrors']
                assert all('?_rsc=' in r['url'] and r['error']=='net::ERR_ABORTED' for r in results['failedRequests']), results['failedRequests']
                def expected_http(r):
                    path = r['url'].split(':3100')[-1]
                    return (path == '/api/session' and r['status'] == 401
                        or path in ('/api/merchant/invoices/'+iid, '/api/agents/'+aid) and r['status'] == 403
                        or path == '/api/payments/pay_missing000000/verification' and r['status'] == 404)
                assert all(expected_http(r) for r in results['httpErrors']), results['httpErrors']
                assert all(e['text'].startswith('Failed to load resource:') and any(e['location'].get('url') == r['url'] and expected_http(r) for r in results['httpErrors']) for e in results['consoleErrors']), results['consoleErrors']
                results['diagnosticsPassed'] = True
                check('No uncaught browser exceptions or unexpected console, HTTP, or transport errors')
                results['apiOrigins']=sorted(set(results['apiOrigins']))
            finally:
                for i, ctx in enumerate(contexts):
                    for j, page in enumerate(ctx.pages):
                        try: page.screenshot(path=str(OUT/f'final-{i}-{j}.png'), full_page=True, timeout=5000)
                        except Exception: pass  # Never replace the original failure with screenshot failure.
                    ctx.tracing.stop(path=str(OUT/f'trace-{i}.zip'))
                browser.close()
                if results['diagnosticsPassed']:
                    results['diagnosticsPassed'] = False
                    assert not results['runtimeExceptions'], results['runtimeExceptions']
                    assert not results['pageErrors'], results['pageErrors']
                    assert all('?_rsc=' in r['url'] and r['error']=='net::ERR_ABORTED' for r in results['failedRequests']), results['failedRequests']
                    assert all(expected_http(r) for r in results['httpErrors']), results['httpErrors']
                    assert all(e['text'].startswith('Failed to load resource:') and any(e['location'].get('url') == r['url'] and expected_http(r) for r in results['httpErrors']) for e in results['consoleErrors']), results['consoleErrors']
                    results['diagnosticsPassed'] = True

    finally:
        for process in reversed(processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL); process.wait()
        for name in ('backend', 'next'):
            path = Path(tmp)/f'{name}.log'
            if path.exists(): (OUT/f'{name}.log').write_text(path.read_text())
        results['apiOrigins'] = sorted(set(results['apiOrigins']))
        results['cleanup']='Server process groups stopped; temporary directory and SQLite removed on context exit.'
        (OUT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
