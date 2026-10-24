// @vitest-environment node
/**
 * Opt in: INTEGRATION_SELF=1, or BACKEND_URL=https://test-backend.example/api.
 * Native fetch crosses actual TCP sockets. The wrapper supplies browser-style
 * in-memory cookies/Origin only; it does not stub responses or backend state.
 * External runs require a disposable testnet/regtest backend. NEVER mainnet.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveApiClient } from "./live";
import { ApiError } from "./types";
import { ApiContext, errorText, qk } from "./hooks";
import * as S from "@/lib/contract/schemas";
import { paymentBadge, unresolvedOf } from "@/lib/present";
import { PaymentDetail } from "@/components/payment";
import { invoicePaymentUri } from "@/components/invoice-request";
import { startContractServer } from "./__integration__/contract-server";

const selfMode = process.env.INTEGRATION_SELF === "1";
const externalUrl = process.env.BACKEND_URL;
const enabled = selfMode || Boolean(externalUrl);
const nativeFetch = globalThis.fetch;
const key = () => `http_${randomUUID()}`;
type Exchange = {
  method: string; path: string; status: number; requestHeaders: Headers;
  responseHeaders: Headers; body: unknown;
};

/** Browser credentials for one backend origin, held only in memory. */
function browserTransport(base: string) {
  const origin = new URL(base).origin;
  const cookies = new Map<string, string>();
  const exchanges: Exchange[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== origin) throw new Error("Integration transport refuses cross-origin requests");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (init?.credentials === "include" && cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (method !== "GET" && method !== "HEAD") headers.set("Origin", origin);
    const response = await nativeFetch(input, { ...init, headers, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(10_000) });
    const setCookies = response.headers.getSetCookie();
    for (const value of setCookies) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.clone().text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    exchanges.push({ method, path: url.pathname, status: response.status, requestHeaders: headers,
      responseHeaders: response.headers, body });
    return response;
  };
  return { fetcher, exchanges, clear: () => cookies.clear() };
}

describe.skipIf(!enabled)("HTTP integration (native sockets; explicit backend opt-in)", () => {
  let ownServer: Awaited<ReturnType<typeof startContractServer>> | undefined;
  let base: string;
  let client: LiveApiClient;
  let transport: ReturnType<typeof browserTransport>;
  let health: S.Health;
  let invoice: S.Invoice;

  beforeAll(async () => {
    if (selfMode && externalUrl) throw new Error("Set either INTEGRATION_SELF or BACKEND_URL, not both");
    if (selfMode) ownServer = await startContractServer();
    base = (ownServer?.baseUrl ?? externalUrl!).replace(/\/$/, "");
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) {
      throw new Error("BACKEND_URL must be an HTTP(S) API base without credentials, query or fragment");
    }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !loopback) throw new Error("Non-loopback backends must use HTTPS");
    transport = browserTransport(base);
    vi.stubGlobal("fetch", transport.fetcher);
    client = new LiveApiClient(base);
    health = S.Health.parse(await client.getHealth());
    if (!["testnet", "regtest"].includes(health.network)) throw new Error("Refusing non-test-network backend");
  }, 20_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await ownServer?.close();
  });

  it("validates health over HTTP and never treats a disabled backend as real wallet evidence", () => {
    expect(S.Health.safeParse(health).success).toBe(true);
    expect(transport.exchanges.some((e) => e.path.endsWith("/health") && e.status === 200)).toBe(true);
  });

  it("bootstraps a cookie session, enforces CSRF, and creates a schema-valid invoice", async () => {
    const session = S.Session.parse(await client.createDemoSession("merchant"));
    expect(session.context).toBe("merchant");
    const bootstrap = transport.exchanges.at(-1)!;
    expect(bootstrap.responseHeaders.getSetCookie().some((c) => c.startsWith("__Host-veilpay_session="))).toBe(true);
    const cookie = bootstrap.responseHeaders.getSetCookie().find((c) => c.startsWith("__Host-veilpay_session="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(bootstrap.requestHeaders.has("X-CSRF-Token")).toBe(false);
    expect(bootstrap.requestHeaders.has("Idempotency-Key")).toBe(false);
    const restored = await client.getSession();
    expect(restored.context).toBe("merchant");
    expect(restored.csrfToken).toBe(session.csrfToken);
    const invoiceBody = { reference: `http-integration-${randomUUID().slice(0, 8)}`, amountZat: "1" };
    const rejected = await transport.fetcher(`${base}/merchant/invoices`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": key() },
      body: JSON.stringify(invoiceBody),
    });
    expect(rejected.status).toBe(403);
    expect(S.ApiErrorBody.parse(await rejected.json()).code).toBe("CSRF_FAILED");
    invoice = S.Invoice.parse(await client.createInvoice(invoiceBody, key()));
    const sent = transport.exchanges.at(-1)!;
    expect(sent.requestHeaders.get("Cookie")).toContain("__Host-veilpay_session=");
    expect(sent.requestHeaders.get("X-CSRF-Token")).toBe(session.csrfToken);
    expect(sent.requestHeaders.get("Idempotency-Key")).toMatch(/^http_/);
    expect(sent.status).toBe(201);
  });

  it("a fresh client restores CSRF from the cookie before its first state-changing request", async () => {
    const coldClient = new LiveApiClient(base);
    const start = transport.exchanges.length;
    await coldClient.createInvoice({ reference: `http-cold-${randomUUID().slice(0, 8)}`, amountZat: "1" }, key());
    const exchanges = transport.exchanges.slice(start);
    expect(exchanges.map((e) => e.method)).toEqual(["GET", "POST"]);
    expect(exchanges[0].path.endsWith("/session")).toBe(true);
    expect(exchanges[0].requestHeaders.get("Cookie")).toContain("__Host-veilpay_session=");
    expect(exchanges[1].requestHeaders.get("X-CSRF-Token")).toBe(S.Session.parse(exchanges[0].body).csrfToken);
  });

  it("replays the original 201 invoice without a second creation and rejects a changed payload", async () => {
    const body = { reference: `http-replay-${randomUUID().slice(0, 8)}`, amountZat: "2" };
    const replayKey = key();
    const before = ownServer?.counters.invoicesCreated;
    const first = await client.createInvoice(body, replayKey);
    const second = await client.createInvoice(body, replayKey);
    expect(second).toEqual(first);
    const replay = transport.exchanges.at(-1)!;
    expect(replay.status).toBe(201);
    expect(replay.responseHeaders.get("Idempotent-Replay")).toBe("true");
    expect((await client.listInvoices()).items?.filter((i) => i.id === first.id)).toHaveLength(1);
    if (ownServer) expect(ownServer.counters.invoicesCreated).toBe(before! + 1);
    let caught: unknown;
    try { await client.createInvoice({ ...body, amountZat: "3" }, replayKey); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).body.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(errorText(caught)).toBe("This request changed after it was submitted. Check its status before creating another.");
  });

  it("GET /merchant/invoices/{id} fetches the created invoice and mock payload never becomes a wallet URI", async () => {
    const fetched = S.Invoice.parse(await client.getInvoice(invoice.id));
    expect(fetched.id).toBe(invoice.id);
    expect(fetched.reference).toBe(invoice.reference);
    expect(transport.exchanges.at(-1)!.path).toBe(`${new URL(base).pathname.replace(/\/$/, "")}/merchant/invoices/${invoice.id}`);
    if (fetched.paymentPayload) {
      expect(fetched.paymentPayload).toMatchObject({ format: "veilpay-mock-v1", mock: true, spendable: false });
      expect(fetched.paymentPayload.uri).not.toMatch(/^zcash:/i);
      expect(invoicePaymentUri(fetched, false)).toBeNull();
    }
    if (health.mode === "mock") expect(invoicePaymentUri(fetched, true)).toBeNull();
  });

  it("maps real HTTP 404 and wrong-role responses to human-readable copy, not success", async () => {
    let missing: unknown;
    try { await client.getInvoice(`inv_${randomUUID().replaceAll("-", "")}`); } catch (error) { missing = error; }
    expect(missing).toBeInstanceOf(ApiError);
    expect((missing as ApiError).status).toBe(404);
    expect((missing as ApiError).body.code).toBe("NOT_FOUND");
    expect(errorText(missing)).toBe("No payment found with that ID. Check it and try again.");
    let forbidden: unknown;
    try { await client.listPayments(); } catch (error) { forbidden = error; }
    expect(forbidden).toBeInstanceOf(ApiError);
    expect((forbidden as ApiError).status).toBe(403);
    expect((forbidden as ApiError).body.code).toBe("WRONG_CONTEXT");
    expect(errorText(forbidden)).not.toContain("WRONG_CONTEXT");
  });

  it("keeps confirmed, inflight and every observed unresolved payment faithful to HTTP response state", async () => {
    await client.createDemoSession("customer");
    const confirmedCandidates = selfMode ? ["pay_confirmed0001"] : [];
    const list = S.PaymentList.parse(await client.listPayments({ limit: 100 }));
    confirmedCandidates.push(...list.items.filter((p) => p.status === "confirmed" && !unresolvedOf(p)).map((p) => p.id));
    await client.createDemoSession("merchant");
    for (const id of new Set(confirmedCandidates)) {
      const verification = S.Verification.parse(await client.getVerification(id));
      expect(["received", "late"]).toContain(verification.state);
      expect(verification.confirmations).toBeGreaterThanOrEqual(verification.confirmationsRequired);
      expect(verification.receivedZat).toBe(verification.expectedZat);
    }
    await client.createDemoSession("customer");
    for (const p of list.items) {
      const fetched = await client.getPayment(p.id);
      const wire = S.Payment.parse(transport.exchanges.at(-1)!.body);
      expect(fetched.status).toBe(wire.status);
      const unresolved = unresolvedOf(fetched);
      expect(paymentBadge(fetched).label === "Paid").toBe(fetched.status === "confirmed" && !unresolved);
      if (unresolved) expect(paymentBadge(fetched).label).not.toMatch(/^Paid$|^Failed$/);
    }
    if (selfMode) {
      expect(list.items.some((p) => p.status === "confirmed" && !unresolvedOf(p))).toBe(true);
      expect(list.items.some((p) => p.status === "confirming")).toBe(true);
      for (const id of ["pay_operator00001", "pay_unknown000001", "pay_pending000001", "pay_outcome000001"]) {
        const fetched = await client.getPayment(id);
        expect(unresolvedOf(fetched)).not.toBeNull();
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        qc.setQueryData(qk.health, health);
        const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc },
          createElement(ApiContext.Provider, { value: client }, createElement(PaymentDetail, { p: fetched }))));
        expect(markup).not.toContain('data-testid="execute"');
        expect(markup).not.toMatch(/<button[^>]*>[^<]*(?:resend|retry execute)/i);
        qc.clear();
      }
    }
  });

  it("creates/replays a payment over HTTP and never performs a real-wallet send", async () => {
    const agent = await client.createAgent({ name: "HTTP integration only", policy: {
      perTxLimitZat: "10", totalBudgetZat: "100", allowedMerchantIds: [invoice.merchantId], requestTtlSeconds: 900,
    } }, key());
    const body = { agentId: agent.id, invoiceId: invoice.id, amountZat: invoice.amountZat, reference: "HTTP integration only" };
    const requestKey = key();
    const p = await client.requestPayment(body, requestKey);
    expect(await client.requestPayment(body, requestKey)).toEqual(p);
    expect(transport.exchanges.at(-1)!.responseHeaders.get("Idempotent-Replay")).toBe("true");
    if (health.mode !== "mock" || health.walletBackend !== "mock") {
      // A live testnet wallet is still money. This suite NEVER invokes it.
      expect(p.status).not.toBe("confirmed");
      return;
    }
    expect(p.status).toBe("authorized");
    const executeKey = key();
    const before = ownServer?.counters.simulatedSends;
    const [first, concurrentReplay] = await Promise.all([
      client.executePayment(p.id, executeKey), client.executePayment(p.id, executeKey),
    ]);
    expect(concurrentReplay).toEqual(first);
    expect(transport.exchanges.slice(-2).some((e) => e.responseHeaders.get("Idempotent-Replay") === "true")).toBe(true);
    expect(await client.executePayment(p.id, executeKey)).toEqual(first);
    expect(transport.exchanges.at(-1)!.status).toBe(202);
    expect(transport.exchanges.at(-1)!.responseHeaders.get("Idempotent-Replay")).toBe("true");
    const duplicate = await client.executePayment(p.id, key());
    expect(duplicate.id).toBe(p.id);
    expect(duplicate.walletOperation?.attempt).toBe(first.walletOperation?.attempt);
    if (ownServer) expect(ownServer.counters.simulatedSends).toBe(before! + 1);
    expect(paymentBadge(first).label === "Paid").toBe(first.status === "confirmed" && !unresolvedOf(first));
    await client.createDemoSession("merchant");
    const verification = S.Verification.parse(await client.getVerification(p.id));
    // Only the deterministic stand-in guarantees no chain-event race between reads.
    if (selfMode && first.status !== "confirmed") expect(verification.state).not.toBe("received");
  });
});
