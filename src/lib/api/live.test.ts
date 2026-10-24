import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveApiClient } from "./live";
import { MockApiClient } from "./mock";
import { seedPayments } from "./fixtures";
import { paymentBadge } from "@/lib/present";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("Live API contract", () => {
  it("preserves an awaiting-confirmation backend result rather than declaring it paid", async () => {
    const payment = { ...seedPayments()[0], status: "confirming" as const, failure: null, walletOperation: null };
    const fetcher = vi.fn().mockResolvedValue(response(payment));
    vi.stubGlobal("fetch", fetcher);
    const actual = await new LiveApiClient().getPayment(payment.id);
    expect(actual.status).toBe("confirming");
    expect(paymentBadge(actual).label).toBe("Sent, awaiting confirmation");
    expect(fetcher.mock.calls[0][0]).toBe(`/api/payments/${payment.id}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("only renders paid when the response itself says confirmed", async () => {
    const payment = { ...seedPayments()[0], status: "confirmed" as const, failure: null, walletOperation: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payment)));
    expect(paymentBadge(await new LiveApiClient().getPayment(payment.id)).label).toBe("Paid");
  });
  it("bootstraps CSRF and carries idempotency on invoice creation", async () => {
    const mock = new MockApiClient({ latencyMs: 0 });
    const session = await mock.createDemoSession("merchant");
    const body = { reference: "INV-test", amountZat: "10000000" };
    const invoice = await mock.createInvoice(body, "idem_backend_test");
    const fetcher = vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response(invoice));
    vi.stubGlobal("fetch", fetcher);
    expect(await new LiveApiClient().createInvoice(body, "idem_backend_test")).toEqual(invoice);
    expect(fetcher.mock.calls[0][0]).toBe("/api/session");
    expect(fetcher.mock.calls[1][0]).toBe("/api/merchant/invoices");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include", headers: { "X-CSRF-Token": session.csrfToken, "Idempotency-Key": "idem_backend_test" }, body: JSON.stringify(body) });
  });
  it("surfaces backend policy errors without fabricating a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: "NOT_FOUND", message: "Invoice not found" }, 404)));
    await expect(new LiveApiClient().getPayment("pay_missing001")).rejects.toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });
});
