import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { LiveApiClient } from "@/lib/api/live";
import { MockApiClient } from "@/lib/api/mock";
import { RequireContext } from "./shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("Session loading and recovery", () => {
  it("announces loading instead of leaving an empty page", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    const session = await api.createDemoSession("customer");
    vi.spyOn(api, "getSession").mockImplementation(() => new Promise(() => {}));
    render(<Providers client={api}><RequireContext ctx={session.context!}>Protected view</RequireContext></Providers>);
    expect(screen.getByRole("status", { name: "Loading" })).toHaveAttribute("aria-busy", "true");
  });
  it("keeps the named loading status while live health is still identifying the network", () => {
    const api = new LiveApiClient();
    vi.spyOn(api, "getHealth").mockImplementation(() => new Promise(() => {}));
    render(<Providers client={api}><RequireContext ctx="customer">Protected view</RequireContext></Providers>);
    expect(screen.getByRole("status", { name: "Loading" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows a recoverable error then retries without inventing a session", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    const session = await api.createDemoSession("customer");
    vi.spyOn(api, "getSession").mockRejectedValueOnce(new Error("Service unavailable")).mockResolvedValue(session);
    render(<Providers client={api}><RequireContext ctx={session.context!}>Protected view</RequireContext></Providers>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your session");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Protected view")).toBeInTheDocument();
  });
});
