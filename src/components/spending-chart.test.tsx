import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Providers } from "@/app/providers";
import { seedPayments } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import type { Payment } from "@/lib/contract/schemas";
import { SpendingChartView } from "./spending-chart";

const base = seedPayments().find((p) => p.status === "confirmed")!;
const NOW = new Date("2026-10-25T10:00:00.000Z");
const mk = (id: string, status: Payment["status"], amountZat: string, at: string): Payment => ({
  ...base, id, status, amountZat, createdAt: at, walletOperation: undefined, failure: null,
  timeline: [{ status, kind: "status", at }],
});
const history = [
  mk("pay_c1", "confirmed", "5000000", "2026-10-25T08:00:00Z"),
  mk("pay_c2", "confirmed", "2000000", "2026-10-22T08:00:00Z"),
  mk("pay_r1", "rejected", "75000000", "2026-10-25T09:00:00Z"),
  mk("pay_s1", "submitted", "100", "2026-10-25T09:30:00Z"),
];
const view = (props: Partial<Parameters<typeof SpendingChartView>[0]>) =>
  render(
    <Providers client={new MockApiClient({ latencyMs: 0 })}>
      <SpendingChartView payments={history} isLoading={false} error={null} simulated now={NOW} timeZone="UTC" {...props} />
    </Providers>,
  );

describe("SpendingChartView", () => {
  it("shows simulated spend with blocked attempts separate and out of the total", () => {
    view({});
    const card = screen.getByTestId("spending-activity");
    expect(card).toHaveTextContent("Agent spending activity");
    expect(screen.getByTestId("spending-sim-label")).toHaveTextContent(/simulated/i);
    expect(screen.getByTestId("spending-total")).toHaveTextContent("0.07 ZEC");
    expect(screen.getByTestId("spending-blocked")).toHaveTextContent(/^1/);
    expect(screen.getByTestId("spending-blocked")).toHaveTextContent(/not spent, no money moved/);
    expect(screen.getByTestId("spending-inflight")).toHaveTextContent(/^1/);
    expect(screen.getByTestId("spending-bar-2026-10-25")).toHaveAttribute("data-zat", "5000000");
    expect(screen.getByTestId("spending-blocked-2026-10-25")).toHaveTextContent("1✕");
    expect(screen.getByTestId("spending-footnote")).toHaveTextContent(/no funds moved and no chain settlement/i);
    expect(card).not.toHaveTextContent(/balance:|settled on|arrived/i);
  });

  it("exposes an accessible summary and a data table", () => {
    view({});
    expect(screen.getByRole("img", { name: /2 simulated payments totalling 0\.07 ZEC in the last 7 days\. 1 blocked attempt, not counted as spent/ })).toBeInTheDocument();
    const table = screen.getByTestId("spending-table");
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByRole("rowheader", { name: "Sunday, October 25" })).toBeInTheDocument();
  });

  it("switches to a 30-day view", () => {
    view({ payments: [...history, mk("pay_old", "confirmed", "1000000", "2026-10-05T08:00:00Z")] });
    expect(screen.getByTestId("spending-total")).toHaveTextContent("0.07 ZEC");
    fireEvent.click(screen.getByTestId("spending-range-30"));
    expect(screen.getByTestId("spending-range-30")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("spending-total")).toHaveTextContent("0.08 ZEC");
    expect(within(screen.getByTestId("spending-table")).getAllByRole("row")).toHaveLength(31);
  });

  it("shows an honest empty state, never zero bars pretending to be data", () => {
    view({ payments: [mk("pay_s2", "submitted", "100", "2026-10-25T09:30:00Z")] });
    expect(screen.getByTestId("spending-empty")).toHaveTextContent("No simulated payments or blocked attempts in the last 7 days. 1 still in progress, not counted yet.");
    expect(screen.queryByTestId("spending-chart")).toBeNull();
  });

  it("shows loading and error states without a chart", () => {
    const { unmount } = view({ payments: undefined, isLoading: true });
    expect(within(screen.getByTestId("spending-loading")).getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("spending-chart")).toBeNull();
    unmount();
    view({ payments: undefined, error: new Error("boom") });
    expect(screen.getByTestId("spending-error")).toHaveTextContent(/payment history could not be loaded, so no chart is shown/i);
    expect(screen.queryByTestId("spending-chart")).toBeNull();
  });

  it("uses neutral wording outside a simulation and flags truncated history", () => {
    view({ simulated: false, truncated: true });
    expect(screen.queryByTestId("spending-sim-label")).toBeNull();
    expect(screen.getByTestId("spending-footnote")).toHaveTextContent(/not a wallet balance/i);
    expect(screen.getByTestId("spending-footnote")).toHaveTextContent(/only the most recent payments/i);
  });
});
