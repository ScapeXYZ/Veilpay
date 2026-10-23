import { beforeEach, describe, expect, it } from "vitest";
import { Payment } from "@/lib/contract/schemas";
import { AGENT_ID, SEED_IDS } from "./fixtures";
import { MockApiClient } from "./mock";
import { ApiError } from "./types";

let api: MockApiClient;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof ApiError ? e.body.code : String(e);
  }
};

beforeEach(async () => {
  api = new MockApiClient({ latencyMs: 0 });
  await api.createDemoSession("customer");
});

describe("blocked-agent opener", () => {
  it("over-cap request is rejected by policy with CAP_EXCEEDED and nothing reserved", async () => {
    const before = (await api.getAgent(AGENT_ID)).usage;
    const p = await api.requestPayment(
      { agentId: AGENT_ID, invoiceId: SEED_IDS.blockedDemoInvoice, amountZat: "75000000", reference: "espresso" },
      "idem_blocked_1",
    );
    expect(p.status).toBe("rejected");
    expect(p.decision.violations.map((v) => v.code)).toContain("CAP_EXCEEDED");
    const after = (await api.getAgent(AGENT_ID)).usage;
    expect(after.reservedZat).toBe(before.reservedZat);
  });
});

describe("happy path", () => {
  it("request -> execute -> confirmed, contract-valid at every step", async () => {
    const p = await api.requestPayment(
      { agentId: AGENT_ID, invoiceId: SEED_IDS.happyDemoInvoice, amountZat: "12000000", reference: "beans" },
      "idem_happy_1",
    );
    expect(p.status).toBe("authorized");
    const ex = await api.executePayment(p.id, "idem_exec_1");
    expect(ex.status).toBe("submitted");
    expect(ex.txid ?? null).toBeNull(); // mock never invents a txid
    expect(ex.mockRef).toMatch(/^MOCK-REF-/);
    await api.advance(p.id);
    await api.advance(p.id);
    const done = await api.getPayment(p.id);
    expect(done.status).toBe("confirmed");
    expect(() => Payment.parse(done)).not.toThrow();
  });
});

describe("idempotency + no double send", () => {
  it("same key + same body replays; same key + different body conflicts", async () => {
    const body = { agentId: AGENT_ID, invoiceId: SEED_IDS.happyDemoInvoice, amountZat: "12000000", reference: "beans" };
    const a = await api.requestPayment(body, "idem_same");
    const b = await api.requestPayment(body, "idem_same");
    expect(b.id).toBe(a.id);
    expect(await code(api.requestPayment({ ...body, amountZat: "13000000" }, "idem_same"))).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("a second execute with a new key returns the current state, never a second send", async () => {
    const p = await api.requestPayment(
      { agentId: AGENT_ID, invoiceId: SEED_IDS.happyDemoInvoice, amountZat: "12000000", reference: "beans" },
      "idem_req_r1",
    );
    const one = await api.executePayment(p.id, "idem_exec_e1");
    const two = await api.executePayment(p.id, "idem_exec_e2");
    expect(two.mockRef).toBe(one.mockRef);
    expect(two.timeline.filter((e) => e.status === "submitted")).toHaveLength(1);
  });
});

describe("unresolved payments are never resent", () => {
  it("execute on an operator-review payment returns current state and never sends again", async () => {
    const before = await api.getPayment("pay_operator00001");
    const again = await api.executePayment("pay_operator00001", "idem_operator1");
    expect(again.timeline).toHaveLength(before.timeline.length);
    expect(again.mockRef ?? null).toBe(before.mockRef ?? null);
    const p = await api.getPayment("pay_operator00001");
    expect(p.walletOperation?.needsOperator).toBe(true);
    expect(p.status).toBe("submitted");
  });

  it("advance does not move an OUTCOME_UNKNOWN payment", async () => {
    const before = await api.getPayment("pay_operator00001");
    await api.advance("pay_operator00001");
    const after = await api.getPayment("pay_operator00001");
    expect(after.status).toBe(before.status);
    expect(after.timeline).toHaveLength(before.timeline.length);
  });
});

describe("policy at execute + pause", () => {
  it("paused agent: approved-but-unsent payment is rejected at execute", async () => {
    const p = await api.requestPayment(
      { agentId: AGENT_ID, invoiceId: SEED_IDS.happyDemoInvoice, amountZat: "12000000", reference: "beans" },
      "idem_pause",
    );
    await api.setAgentStatus(AGENT_ID, "paused");
    expect(await code(api.executePayment(p.id, "idem_pause_exec"))).toBe("POLICY_REJECTED");
    expect((await api.getPayment(p.id)).status).toBe("rejected");
  });

  it("stale policy version conflicts", async () => {
    const pol = await api.getPolicy(AGENT_ID);
    await api.putPolicy(AGENT_ID, { ...pol, expectedVersion: pol.version });
    expect(await code(api.putPolicy(AGENT_ID, { ...pol, expectedVersion: pol.version }))).toBe("VERSION_CONFLICT");
  });
});

describe("context isolation", () => {
  it("merchant cannot read customer payments; customer cannot read verification", async () => {
    expect(await code(api.getVerification("pay_confirmed0001"))).toBe("WRONG_CONTEXT");
    await api.createDemoSession("merchant");
    expect(await code(api.listPayments())).toBe("WRONG_CONTEXT");
    const v = await api.getVerification("pay_confirmed0001");
    expect(v.mock).toBe(true);
    expect(v.method).toBe("mock");
  });
});
