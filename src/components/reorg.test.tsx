import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Providers } from "@/app/providers";
import { AGENT_ID, SEED_IDS, seedPayments } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import { Payment } from "@/lib/contract/schemas";
import { paymentBadge, unresolvedOf } from "@/lib/present";
import { PaymentDetail } from "./payment";
import { HealthStrip } from "./shell";

const seed = (id: string) => seedPayments().find((p) => p.id === id)!;

describe("reorg states", () => {
  it("confirmed -> reorg -> confirming: contract-valid, shown as confirming, not unresolved", () => {
    const p = seed("pay_reorged000001");
    expect(() => Payment.parse(p)).not.toThrow();
    expect(p.status).toBe("confirming");
    const kinds = p.timeline.map((e) => e.kind);
    expect(kinds.indexOf("reorg")).toBeGreaterThan(p.timeline.findIndex((e) => e.status === "confirmed"));
    expect(unresolvedOf(p)).toBeNull();
    expect(paymentBadge(p).label).not.toMatch(/paid/i);
  });

  it("reorg then expiry: reconciled to a definitive failure, labelled as such", () => {
    const p = seed("pay_reorgfail0001");
    expect(p.status).toBe("failed");
    expect(p.failure?.code).toBe("EXPIRED_UNMINED");
    expect(p.failure?.definitive).toBe(true);
    expect(p.timeline.some((e) => e.kind === "reconciled")).toBe(true);
    renderDetail(p);
    expect(screen.getByTestId("failure-definitive")).toHaveTextContent("EXPIRED_UNMINED");
    expect(within(screen.getByTestId("timeline")).getByText(/^Rechecked:/)).toBeInTheDocument();
  });

  describe("mock reorg on a live payment", () => {
    let api: MockApiClient;
    beforeEach(async () => {
      api = new MockApiClient({ latencyMs: 0 });
      await api.createDemoSession("customer");
    });

    it("moves spent back to reserved exactly once, invoice reopens, then re-confirms", async () => {
      const p = await api.requestPayment(
        { agentId: AGENT_ID, invoiceId: SEED_IDS.happyDemoInvoice, amountZat: "12000000", reference: "beans" },
        "idem_reorg_req1",
      );
      await api.executePayment(p.id, "idem_reorg_exec1");
      await api.advance(p.id);
      await api.advance(p.id);
      expect((await api.getPayment(p.id)).status).toBe("confirmed");
      const paid = (await api.getAgent(AGENT_ID)).usage;

      await api.reorg(p.id);
      const after = await api.getPayment(p.id);
      expect(after.status).toBe("confirming");
      expect(after.confirmations).toBe(0);
      expect(after.timeline.filter((e) => e.kind === "reorg")).toHaveLength(1);
      const u = (await api.getAgent(AGENT_ID)).usage;
      expect(BigInt(u.spentZat)).toBe(BigInt(paid.spentZat) - 12000000n);
      expect(BigInt(u.reservedZat)).toBe(BigInt(paid.reservedZat) + 12000000n);
      expect(() => Payment.parse(after)).not.toThrow();

      await api.advance(p.id);
      expect((await api.getPayment(p.id)).status).toBe("confirmed");
      expect((await api.getAgent(AGENT_ID)).usage.spentZat).toBe(paid.spentZat);
    });

    it("reorg on a non-mined payment is a no-op", async () => {
      const before = await api.getPayment("pay_operator00001");
      await api.reorg("pay_operator00001");
      expect((await api.getPayment("pay_operator00001")).timeline).toHaveLength(before.timeline.length);
    });
  });
});

describe("deep-reorg alert", () => {
  it("is hidden normally and shown as an alert when health reports it", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    const { unmount } = render(
      <Providers client={api}>
        <HealthStrip />
      </Providers>,
    );
    await screen.findByTestId("reconciler-strip");
    expect(screen.queryByTestId("deep-reorg-alert")).toBeNull();
    unmount();

    api.setDeepReorgAlert(true);
    expect((await api.getHealth()).chainWatcher.deepReorgAlert).toBe(true);
    render(
      <Providers client={api}>
        <HealthStrip />
      </Providers>,
    );
    const alert = await screen.findByTestId("deep-reorg-alert");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/watch depth/i);
    expect(alert).toHaveTextContent(/operator/i);
  });
});

function renderDetail(p: Payment) {
  return render(
    <Providers client={new MockApiClient({ latencyMs: 0 })}>
      <PaymentDetail p={p} />
    </Providers>,
  );
}
