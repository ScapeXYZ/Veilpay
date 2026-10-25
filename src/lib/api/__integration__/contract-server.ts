/**
 * Lauki-owned HTTP contract stand-in. Not Temi's backend and not wallet evidence.
 * Implements the subset of contracts/openapi.yaml exercised by the opt-in suite.
 * All data is synthetic, all state is in memory, and the listener is loopback-only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import * as S from "@/lib/contract/schemas";

const COOKIE = "__Host-veilpay_session";
const MERCHANT = "mer_contract0001";
const now = () => new Date().toISOString();
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const copy = <T>(value: T): T => structuredClone(value);

type SessionRecord = { context: S.SessionContext; csrfToken: string };
type Reply = { status: number; body: unknown };

export async function startContractServer() {
  const sessions = new Map<string, SessionRecord>();
  const agents = new Map<string, S.Agent>();
  const invoices = new Map<string, S.Invoice>();
  const payments = new Map<string, S.Payment>();
  const replays = new Map<string, { input: string; reply: Reply }>();
  const counters = { invoicesCreated: 0, paymentRequests: 0, simulatedSends: 0 };
  let sequence = 0;
  const id = (prefix: string) => `${prefix}_${String(++sequence).padStart(12, "0")}`;
  let origin = "";
  // Milestone 3 shape: a real-testnet ZIP-321 invoice for an Orchard-only utest1 UA. Encoding vector
  // only (receiver bytes 0x01..0x2b); nothing here is a wallet, a key, or chain data.
  const M3_UA = "utest1s9tgkxz3facm5lakztmrm7g062wxvq7kdd93w23kmr368h90wxjrc0la8cxwzfummn2wd2q3ql6t3nt77s5r3n3uflj8kz2e2sz5yrtk";
  invoices.set("inv_m3testnet00001", S.Invoice.parse({ id: "inv_m3testnet00001", merchantId: MERCHANT,
    reference: "M3 testnet invoice", amountZat: "12345678", status: "open", createdAt: now(), expiresAt: future(),
    payTo: M3_UA, network: "testnet", paymentPayload: { format: "zip321", uri: `zcash:${M3_UA}?amount=0.12345678`,
      network: "testnet", mock: false, spendable: true } }));

  function payment(paymentId: string, status: S.PaymentStatus, patch: Partial<S.Payment> = {}): S.Payment {
    return S.Payment.parse({
      id: paymentId, agentId: "agt_contract0001", merchantId: MERCHANT,
      invoiceId: "inv_contract0001", amountZat: "1", reference: "HTTP contract fixture",
      status, decision: { id: "dec_contract0001", result: "authorized", policyVersion: 1,
        evaluatedAt: now(), violations: [], auditHash: "synthetic-contract-only" },
      timeline: [{ status, kind: "status", at: now() }], createdAt: now(),
      confirmations: status === "confirmed" ? 1 : 0, txid: null, pool: null,
      mockRef: "mock_00000000000000000000000000000001", walletOperation: null, failure: null, ...patch,
    });
  }
  const op = (state: NonNullable<S.WalletOperation>["state"], needsOperator: boolean): S.WalletOperation => ({
    id: "wop_contract0001", state, attempt: 1, needsOperator, lastReconciledAt: null,
  });
  for (const value of [
    payment("pay_confirmed0001", "confirmed"),
    payment("pay_confirming001", "confirming"),
    payment("pay_operator00001", "authorized", { walletOperation: op("unknown", true) }),
    payment("pay_unknown000001", "failed", { walletOperation: op("unknown", false) }),
    payment("pay_pending000001", "confirmed", { walletOperation: op("pending", false) }),
    payment("pay_outcome000001", "authorized", { failure: {
      code: "OUTCOME_UNKNOWN", retriable: false, definitive: false,
    } }),
  ]) payments.set(value.id, value);

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }
  function error(res: ServerResponse, status: number, code: S.ErrorCode) {
    send(res, status, S.ApiErrorBody.parse({ code, message: `Synthetic contract error: ${code}` }));
  }
  async function body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65_536) throw new Error("Request too large");
      chunks.push(Buffer.from(chunk));
    }
    return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }
  function requireRole(res: ServerResponse, session: SessionRecord, role: S.SessionContext) {
    if (session.context === role) return true;
    error(res, 403, "WRONG_CONTEXT");
    return false;
  }
  function statePost(
    req: IncomingMessage, res: ServerResponse, session: SessionRecord,
    path: string, input: unknown, action: () => Reply,
  ) {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !S.IdempotencyKeyHeader.safeParse(key).success) {
      error(res, 400, "VALIDATION_FAILED"); return;
    }
    const scope = `${session.context}:${path}:${key}`;
    const serialized = JSON.stringify(input);
    const old = replays.get(scope);
    if (old) {
      if (old.input !== serialized) { error(res, 409, "IDEMPOTENCY_MISMATCH"); return; }
      send(res, old.reply.status, old.reply.body, { "Idempotent-Replay": "true" }); return;
    }
    const reply = action();
    if (reply.status !== 503) replays.set(scope, { input: serialized, reply: copy(reply) });
    send(res, reply.status, reply.body);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", origin).pathname;
      const method = req.method ?? "GET";
      if (path === "/health" && method === "GET") {
        send(res, 200, S.Health.parse({ status: "ok", network: "testnet", wallet: "ready",
          walletBackend: "mock", chainHeight: null, confirmationsRequired: 1, mode: "mock",
          reconciler: { lastRunAt: null, unresolved: 4 },
          chainWatcher: { lastBlockAt: null, watchDepth: 100, deepReorgAlert: false } })); return;
      }
      if (method !== "GET" && req.headers.origin !== origin) { error(res, 403, "CSRF_FAILED"); return; }
      if (path === "/session/demo" && method === "POST") {
        const parsed = S.DemoSessionRequest.safeParse(await body(req));
        if (!parsed.success) { error(res, 400, "VALIDATION_FAILED"); return; }
        const token = randomUUID();
        const session = { context: parsed.data.context, csrfToken: randomUUID() };
        sessions.set(token, session);
        send(res, 200, S.Session.parse({ ...session, merchantId: session.context === "merchant" ? MERCHANT : null,
          agentId: session.context === "customer" ? [...agents.keys()].at(-1) ?? null : null, expiresAt: future() }),
        { "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/` }); return;
      }
      const token = req.headers.cookie?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const session = token ? sessions.get(token) : undefined;
      if (!session) { error(res, 401, "UNAUTHENTICATED"); return; }
      if (method !== "GET" && req.headers["x-csrf-token"] !== session.csrfToken) { error(res, 403, "CSRF_FAILED"); return; }
      if (path === "/session" && method === "GET") {
        send(res, 200, S.Session.parse({ ...session, merchantId: session.context === "merchant" ? MERCHANT : null,
          agentId: session.context === "customer" ? [...agents.keys()].at(-1) ?? null : null, expiresAt: future() })); return;
      }
      if (path === "/agents" && method === "POST") {
        if (!requireRole(res, session, "customer")) return;
        const parsed = S.AgentCreate.safeParse(await body(req));
        if (!parsed.success) { error(res, 400, "VALIDATION_FAILED"); return; }
        statePost(req, res, session, path, parsed.data, () => {
          const agent = S.Agent.parse({ id: id("agt"), ...parsed.data, status: "active", createdAt: now(),
            policy: { ...parsed.data.policy, version: 1, updatedAt: now() }, usage: {
              spentZat: "0", reservedZat: "0", remainingZat: parsed.data.policy.totalBudgetZat,
              approvedCount: 0, rejectedCount: 0, pendingCount: 0 } });
          agents.set(agent.id, agent); return { status: 201, body: agent };
        }); return;
      }
      if (path.startsWith("/merchant/")) {
        if (!requireRole(res, session, "merchant")) return;
        if (path === "/merchant/invoices" && method === "POST") {
          const parsed = S.InvoiceCreate.safeParse(await body(req));
          if (!parsed.success) { error(res, 400, "VALIDATION_FAILED"); return; }
          statePost(req, res, session, path, parsed.data, () => {
            const invoiceId = id("inv");
            const invoice = S.Invoice.parse({ id: invoiceId, merchantId: MERCHANT, ...parsed.data,
              status: "open", createdAt: now(), expiresAt: parsed.data.expiresAt ?? future(),
              payTo: "mock-address-not-on-chain", paymentPayload: {
                format: "veilpay-mock-v1", uri: `veilpay-mock:${invoiceId}`, mock: true, spendable: false } });
            invoices.set(invoice.id, invoice); counters.invoicesCreated++;
            return { status: 201, body: invoice };
          }); return;
        }
        if (path === "/merchant/invoices" && method === "GET") { send(res, 200, { items: [...invoices.values()] }); return; }
        if (path.startsWith("/merchant/invoices/") && method === "GET") {
          const invoice = invoices.get(decodeURIComponent(path.slice("/merchant/invoices/".length)));
          if (!invoice) { error(res, 404, "NOT_FOUND"); return; }
          if (invoice.expiresAt && Date.parse(invoice.expiresAt) <= Date.now() && invoice.status === "open") invoice.status = "expired";
          send(res, 200, invoice); return;
        }
      }
      if (path === "/payments/request" && method === "POST") {
        if (!requireRole(res, session, "customer")) return;
        const parsed = S.PaymentRequestCreate.safeParse(await body(req));
        if (!parsed.success) { error(res, 400, "VALIDATION_FAILED"); return; }
        const agent = agents.get(parsed.data.agentId);
        const invoice = invoices.get(parsed.data.invoiceId);
        if (!agent || !invoice) { error(res, 404, "NOT_FOUND"); return; }
        statePost(req, res, session, path, parsed.data, () => {
          const p = payment(id("pay"), "authorized", { ...parsed.data, merchantId: invoice.merchantId });
          payments.set(p.id, p); counters.paymentRequests++;
          return { status: 201, body: p };
        }); return;
      }
      if (path === "/payments" && method === "GET") {
        if (!requireRole(res, session, "customer")) return;
        send(res, 200, S.PaymentList.parse({ items: [...payments.values()], nextCursor: null })); return;
      }
      const match = /^\/payments\/([^/]+)(?:\/(execute|verification))?$/.exec(path);
      if (match) {
        const [, paymentId, operation] = match;
        const role = operation === "verification" ? "merchant" : "customer";
        if (!requireRole(res, session, role)) return;
        const p = payments.get(paymentId);
        if (!p) { error(res, 404, "NOT_FOUND"); return; }
        if (!operation && method === "GET") { send(res, 200, p); return; }
        if (operation === "verification" && method === "GET") {
          send(res, 200, S.Verification.parse({ paymentId: p.id, invoiceId: p.invoiceId,
            state: p.status === "confirmed" ? "received" : "pending", expectedZat: p.amountZat,
            receivedZat: p.status === "confirmed" ? p.amountZat : "0",
            confirmations: p.confirmations ?? 0, confirmationsRequired: 1, method: "mock", checkedAt: now(), mock: true })); return;
        }
        if (operation === "execute" && method === "POST") {
          statePost(req, res, session, path, {}, () => {
            if (p.status !== "authorized" || p.walletOperation) return { status: 202, body: p };
            p.status = "confirming"; p.walletOperation = op("broadcast", false);
            p.timeline.push({ status: "confirming", kind: "status", at: now() });
            counters.simulatedSends++; return { status: 202, body: p };
          }); return;
        }
      }
      error(res, 404, "NOT_FOUND");
    })().catch(() => {
      if (!res.headersSent) error(res, 500, "INTERNAL");
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Contract listener has no TCP address");
  origin = `http://127.0.0.1:${address.port}`;
  return { baseUrl: origin, counters, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}
