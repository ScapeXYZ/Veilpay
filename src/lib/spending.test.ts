import { describe, expect, it } from "vitest";
import { seedPayments } from "@/lib/api/fixtures";
import type { Payment } from "@/lib/contract/schemas";
import { aggregateSpending, barPct, completedAt, dayKey } from "./spending";

const base = seedPayments().find((p) => p.status === "confirmed")!;
let n = 0;
function pay(status: Payment["status"], amountZat: string, at: string, extra: Partial<Payment> = {}): Payment {
  n += 1;
  return {
    ...base,
    id: `pay_test${String(n).padStart(8, "0")}`,
    status,
    amountZat,
    createdAt: at,
    timeline: status === "confirmed" ? [{ status: "requested", kind: "status", at }, { status: "confirmed", kind: "status", at }] : [{ status, kind: "status", at }],
    walletOperation: undefined,
    failure: null,
    ...extra,
  };
}
const NOW = new Date("2026-10-25T10:00:00.000Z");

describe("aggregateSpending", () => {
  it("sums completed payments per day and excludes blocked attempts from the spent total", () => {
    const s = aggregateSpending(
      [
        pay("confirmed", "5000000", "2026-10-25T08:00:00Z"),
        pay("confirmed", "2500000", "2026-10-25T09:00:00Z"),
        pay("rejected", "75000000", "2026-10-25T09:30:00Z"),
        pay("confirmed", "1000000", "2026-10-23T12:00:00Z"),
      ],
      { range: 7, now: NOW, timeZone: "UTC" },
    );
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)!.key).toBe("2026-10-25");
    expect(s.days[0].key).toBe("2026-10-19");
    expect(s.days.at(-1)).toMatchObject({ spentZat: "7500000", completedCount: 2, blockedCount: 1, blockedZat: "75000000" });
    expect(s.days.find((d) => d.key === "2026-10-23")!.spentZat).toBe("1000000");
    expect(s.spentZat).toBe("8500000");
    expect(s.blockedCount).toBe(1);
    expect(s.blockedZat).toBe("75000000");
    expect(s.maxDayZat).toBe("7500000");
  });

  it("never counts in-flight, failed or expired payments as spent", () => {
    const s = aggregateSpending(
      [pay("submitted", "100", "2026-10-25T08:00:00Z"), pay("confirming", "100", "2026-10-25T08:00:00Z"), pay("failed", "100", "2026-10-25T08:00:00Z"), pay("expired", "100", "2026-10-25T08:00:00Z")],
      { range: 7, now: NOW, timeZone: "UTC" },
    );
    expect(s.spentZat).toBe("0");
    expect(s.completedCount).toBe(0);
    expect(s.inFlightCount).toBe(2);
  });

  it("leaves a confirmed payment with an unresolved wallet state out of the spent total", () => {
    const op = seedPayments().find((p) => p.id === "pay_operator00001")!;
    const s = aggregateSpending([{ ...op, status: "confirmed", createdAt: "2026-10-25T08:00:00Z" }], { range: 7, now: NOW, timeZone: "UTC" });
    expect(s.spentZat).toBe("0");
  });

  it("buckets 30 days and drops anything outside the window", () => {
    const s = aggregateSpending(
      [pay("confirmed", "300", "2026-09-26T00:00:00Z"), pay("confirmed", "200", "2026-09-25T23:59:59Z"), pay("confirmed", "100", "2026-10-18T12:00:00Z")],
      { range: 30, now: NOW, timeZone: "UTC" },
    );
    expect(s.days).toHaveLength(30);
    expect(s.days[0].key).toBe("2026-09-26");
    expect(s.spentZat).toBe("400");
    expect(aggregateSpending([pay("confirmed", "100", "2026-10-18T12:00:00Z")], { range: 7, now: NOW, timeZone: "UTC" }).spentZat).toBe("0");
  });

  it("buckets by the viewer's calendar day at time-zone edges", () => {
    // 20:00 UTC Oct 24 is 01:30 Oct 25 in Kolkata; 03:00 UTC Oct 25 is 23:00 Oct 24 in New York.
    const p = [pay("confirmed", "100", "2026-10-24T20:00:00Z"), pay("confirmed", "50", "2026-10-25T03:00:00Z")];
    const ist = aggregateSpending(p, { range: 7, now: NOW, timeZone: "Asia/Kolkata" });
    expect(ist.days.at(-1)).toMatchObject({ key: "2026-10-25", spentZat: "150" });
    const ny = aggregateSpending(p, { range: 7, now: NOW, timeZone: "America/New_York" });
    expect(ny.days.at(-1)).toMatchObject({ key: "2026-10-25", spentZat: "0" });
    expect(ny.days.find((d) => d.key === "2026-10-24")!.spentZat).toBe("150");
  });

  it("keeps exactly one bucket per calendar day across a DST change", () => {
    const s = aggregateSpending([], { range: 7, now: new Date("2026-11-03T12:00:00Z"), timeZone: "America/New_York" });
    expect(s.days.map((d) => d.key)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("dates a completed payment by its latest confirmed event, not its request", () => {
    const p = pay("confirmed", "100", "2026-10-23T08:00:00Z", {
      timeline: [{ status: "requested", kind: "status", at: "2026-10-23T08:00:00Z" }, { status: "confirmed", kind: "status", at: "2026-10-24T08:00:00Z" }],
    });
    expect(completedAt(p)).toBe("2026-10-24T08:00:00Z");
    const s = aggregateSpending([p], { range: 7, now: NOW, timeZone: "UTC" });
    expect(s.days.find((d) => d.key === "2026-10-24")!.spentZat).toBe("100");
  });

  it("filters to the selected agent", () => {
    const s = aggregateSpending([pay("confirmed", "100", "2026-10-25T08:00:00Z", { agentId: "agt_other000001" })], { range: 7, now: NOW, timeZone: "UTC", agentId: base.agentId });
    expect(s.spentZat).toBe("0");
  });

  it("returns zero-filled days for an empty history", () => {
    const s = aggregateSpending([], { range: 7, now: NOW, timeZone: "UTC" });
    expect(s.days.every((d) => d.spentZat === "0" && d.blockedCount === 0)).toBe(true);
    expect(s).toMatchObject({ spentZat: "0", blockedCount: 0, completedCount: 0, maxDayZat: "0" });
  });

  it("uses BigInt-safe totals for large amounts", () => {
    const s = aggregateSpending([pay("confirmed", "2100000000000000", "2026-10-25T08:00:00Z"), pay("confirmed", "1", "2026-10-25T08:00:00Z")], { range: 7, now: NOW, timeZone: "UTC" });
    expect(s.spentZat).toBe("2100000000000001");
  });
});

describe("dayKey / barPct", () => {
  it("formats calendar keys in the given zone", () => {
    expect(dayKey("2026-10-24T20:00:00Z", "UTC")).toBe("2026-10-24");
    expect(dayKey("2026-10-24T20:00:00Z", "Asia/Kolkata")).toBe("2026-10-25");
  });
  it("scales bars and keeps tiny non-zero days visible", () => {
    expect(barPct("0", "100")).toBe(0);
    expect(barPct("100", "100")).toBe(100);
    expect(barPct("50", "100")).toBe(50);
    expect(barPct("1", "1000000")).toBe(2);
    expect(barPct("5", "0")).toBe(0);
  });
});
