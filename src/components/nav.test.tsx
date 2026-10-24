import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { MockApiClient } from "@/lib/api/mock";
import { AppShell, RequireContext } from "./shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/spending-rules" }));

describe("app navigation (Temi 1228774)", () => {
  it("has exactly five main items, with Privacy and Activity only under More", async () => {
    render(
      <Providers client={new MockApiClient({ latencyMs: 0 })}>
        <AppShell><p>page</p></AppShell>
      </Providers>,
    );
    const mains = screen.getAllByRole("navigation", { name: "Main" });
    const rail = mains[0];
    const labels = within(rail).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels).toEqual(["Overview", "Spending rules", "Payments", "Merchant", "Help & demo"]);
    expect(within(rail).getByRole("link", { name: "Spending rules" })).toHaveAttribute("aria-current", "page");
    for (const m of mains) expect(within(m).queryByRole("link", { name: /privacy|activity/i })).toBeNull();
    expect(within(screen.getByTestId("rail-more")).getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Activity", "Privacy"]);

    fireEvent.click(screen.getByTestId("nav-more"));
    const sheet = screen.getByRole("dialog", { name: "More navigation" });
    for (const name of ["Help & demo", "Activity", "Privacy"]) expect(within(sheet).getByRole("link", { name })).toBeInTheDocument();
  });

  it("never renders practice controls on app pages", () => {
    render(
      <Providers client={new MockApiClient({ latencyMs: 0 })}>
        <AppShell><p>page</p></AppShell>
      </Providers>,
    );
    expect(screen.queryByTestId("mock-controls")).toBeNull();
  });
});

describe("RequireContext", () => {
  it("opens the right role by itself instead of showing a switch button", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    await api.createDemoSession("customer");
    const spy = vi.spyOn(api, "createDemoSession");
    render(
      <Providers client={api}>
        <RequireContext ctx="merchant"><p>merchant only</p></RequireContext>
      </Providers>,
    );
    expect(await screen.findByText("merchant only")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("merchant");
    expect(spy.mock.calls.filter((c) => c[0] === "merchant").length).toBeLessThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
  });
});
