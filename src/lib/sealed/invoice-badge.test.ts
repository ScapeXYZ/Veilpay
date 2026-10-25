import { describe, expect, it } from "vitest";
import { invoiceBadgeText } from "./invoice-badge";

describe("invoiceBadgeText", () => {
  it("says Simulated paid / Simulated paid late in practice mode", () => {
    expect(invoiceBadgeText("paid", true)).toBe("Simulated paid");
    expect(invoiceBadgeText("paid_late", true)).toBe("Simulated paid late");
  });
  it("keeps Paid / Paid late outside practice mode", () => {
    expect(invoiceBadgeText("paid", false)).toBe("Paid");
    expect(invoiceBadgeText("paid_late", false)).toBe("Paid late");
  });
  it("leaves open and expired unchanged", () => {
    expect(invoiceBadgeText("open", true)).toBe("open");
    expect(invoiceBadgeText("expired", false)).toBe("expired");
  });
  it("never renders a bare paid word in practice mode", () => {
    for (const s of ["paid", "paid_late"] as const) expect(invoiceBadgeText(s, true)).toMatch(/^Simulated /);
  });
});
