import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MerchantPage from "@/app/merchant/page";
import { Providers } from "@/app/providers";
import { MockApiClient } from "@/lib/api/mock";
import { errorText } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/types";
import { ErrorCode } from "@/lib/contract/schemas";
import { RouteAnnouncements } from "./route-announcements";

vi.mock("next/navigation", () => ({ usePathname: () => "/merchant" }));

describe("Readable merchant errors", () => {
  it("uses consistent title case for Paid and Paid late invoice badges", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    await api.createDemoSession("merchant");
    render(<Providers client={api}><MerchantPage /></Providers>);
    const invoices = await screen.findByTestId("invoices");
    expect(invoices).toHaveTextContent("Paid");
    expect(invoices).toHaveTextContent("Paid late");
    expect(invoices).not.toHaveTextContent("paid late");
  });

  it("shows exactly one friendly alert only after an invalid lookup", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    await api.createDemoSession("merchant");
    render(<Providers client={api}><MerchantPage /></Providers>);
    const input = await screen.findByLabelText("Payment ID to verify");
    await screen.findByTestId("verification");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "invalid-payment-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No payment found with that ID. Check it and try again.");
    expect(alert).not.toHaveTextContent("NOT_FOUND");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
  it.each(ErrorCode.options)("maps %s to helpful copy without raw server data", (code) => {
    const copy = errorText(new ApiError(400, { code, message: "raw server detail" }));
    expect(copy).not.toContain(code);
    expect(copy).not.toContain("raw server detail");
    expect(copy.length).toBeGreaterThan(25);
  });
  it("keeps the framework route announcer polite rather than an empty error alert", async () => {
    const host = document.createElement("next-route-announcer");
    const shadow = host.attachShadow({ mode: "open" });
    const announcement = document.createElement("div");
    announcement.setAttribute("role", "alert");
    announcement.setAttribute("aria-live", "assertive");
    shadow.appendChild(announcement);
    document.body.appendChild(host);
    const view = render(<RouteAnnouncements />);
    await waitFor(() => expect(announcement).toHaveAttribute("role", "status"));
    expect(announcement).toHaveAttribute("aria-live", "polite");
    view.unmount();
    host.remove();
  });
});
