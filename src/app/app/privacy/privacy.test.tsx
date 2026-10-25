/**
 * Regression for correction 2 + 7 on the Privacy page: a completed simulated payment never reads
 * "not sent yet" or a plain "Paid" badge; it says mock execution only, no real shielded settlement.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/app/privacy/page";
import { Providers } from "@/app/providers";
import { seedPayments } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import { privacyEvidence } from "@/lib/present";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/privacy" }));

const seed = (id: string) => seedPayments().find((p) => p.id === id)!;

describe("privacy evidence line", () => {
  it("a completed simulated payment is mock execution, never 'not sent yet'", () => {
    const p = { ...seed("pay_confirmed0001"), pool: null };
    const line = privacyEvidence(p, true);
    expect(line).not.toMatch(/not sent yet/i);
    expect(line).toMatch(/mock execution only/i);
    expect(line).toMatch(/no real shielded settlement/i);
  });
  it("a simulated pool is labelled simulated", () => {
    const p = { ...seed("pay_confirmed0001"), pool: "orchard" as const };
    expect(privacyEvidence(p, true)).toMatch(/simulated orchard pool/);
  });
  it("nothing sent still says not sent yet", () => {
    const p = { ...seed("pay_confirmed0001"), status: "authorized" as const, mockRef: null, txid: null, timeline: [], pool: null };
    expect(privacyEvidence(p, true)).toMatch(/not sent yet/i);
    expect(privacyEvidence(p, false)).toBe(", not sent yet");
  });
  it("live mode keeps the server-reported pool wording", () => {
    const p = { ...seed("pay_confirmed0001"), mockRef: null, pool: "orchard" as const };
    expect(privacyEvidence(p, false)).toBe(", which reports it as sent through the orchard pool");
  });
});

describe("privacy page with practice data", () => {
  it("shows simulated status labels and mock-execution evidence for the completed payment", async () => {
    render(
      <Providers client={new MockApiClient({ latencyMs: 0 })}>
        <PrivacyPage />
      </Providers>,
    );
    const list = await screen.findByRole("listbox", { name: "Payment for the privacy lens" }, { timeout: 5000 });
    expect(list.textContent).not.toMatch(/(^|[^a-z])Paid([^a-z]|$)/);
    const done = within(list).getAllByRole("option").find((o) => /Simulated complete/.test(o.textContent ?? ""));
    expect(done).toBeTruthy();
    fireEvent.click(done!);
    const ev = screen.getByTestId("lens-evidence");
    expect(ev.textContent).not.toMatch(/not sent yet/i);
    expect(ev.textContent).toMatch(/mock execution only.*no real shielded settlement/i);
  });
});
