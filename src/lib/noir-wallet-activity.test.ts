import { describe, expect, it } from "vitest";
import { aggregateWalletActivity, walletAmountZat, walletDirection } from "./noir-wallet-activity";

const now = new Date(2026, 9, 25, 12);

describe("Noir Wallet activity aggregation", () => {
  it("uses only exact receive and send entries for directionally-derived totals", () => {
    const series = aggregateWalletActivity([
      { txid: "receive", type: "receive", amount: "1.25", status: "mined", timestamp: new Date(2026, 9, 25, 9).getTime() },
      { txid: "send", type: "send", amount: "0.40", status: "pending", timestamp: new Date(2026, 9, 24, 9).getTime() },
      { txid: "shield", type: "shield", amount: "4.00", status: "mined", timestamp: new Date(2026, 9, 25, 8).getTime() },
      { txid: "bad", type: "receive", amount: "1.000000001", status: "mined", timestamp: new Date(2026, 9, 25, 7).getTime() },
    ], 7, now);

    expect(series.incomingZat).toBe("125000000");
    expect(series.outgoingZat).toBe("40000000");
    expect(series.count).toBe(2);
  });

  it("keeps an empty window empty rather than inventing wallet activity", () => {
    const series = aggregateWalletActivity([{ txid: "old", type: "receive", amount: "1", status: "mined", timestamp: new Date(2026, 8, 1).getTime() }], 7, now);
    expect(series.count).toBe(0);
    expect(series.maxDayZat).toBe("0");
  });

  it("does not infer a direction or total for unsupported values", () => {
    expect(walletDirection("shield")).toBeNull();
    expect(walletAmountZat("-0.1")).toBeNull();
    expect(walletAmountZat("1.000000001")).toBeNull();
  });
});
