import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { MockApiClient } from "@/lib/api/mock";
import { LiveApiClient } from "@/lib/api/live";
import { AGENT_ID } from "@/lib/api/fixtures";
import { seedHealth } from "@/lib/api/fixtures";
import { AgentSummary, WorkspaceOnboarding } from "./agent-summary";

describe("Fresh backend session", () => {
  it("creates and selects an agent when the session has no default agent", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    const session = await api.createDemoSession("customer");
    vi.spyOn(api, "getSession").mockResolvedValue({ ...session, agentId: null });
    const agent = { ...await api.getAgent(AGENT_ID), name: "Demo customer agent" };
    const create = vi.spyOn(api, "createAgent").mockResolvedValue(agent);
    vi.spyOn(api, "getAgent").mockResolvedValue(agent);
    render(<Providers client={api}><AgentSummary withControls /></Providers>);
    fireEvent.click(await screen.findByRole("button", { name: "Create demo agent" }));
    expect(await screen.findByTestId("agent-summary")).toHaveTextContent("Demo customer agent");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].policy.allowedMerchantIds).toEqual(["mer_demo"]);
  });
});

describe("Testnet workspace onboarding", () => {
  const unauthenticated = { authenticated: false, context: null, accountId: null, accountType: null, agentId: null, merchantId: null, csrfToken: null, expiresAt: null };

  function liveApi() {
    const api = new LiveApiClient();
    vi.spyOn(api, "getHealth").mockResolvedValue({ ...seedHealth(), network: "testnet", mode: "disabled", wallet: "broadcast_disabled", walletBackend: "zingo" });
    vi.spyOn(api, "getSession").mockResolvedValue(unauthenticated);
    return api;
  }

  it("submits a separate workspace registration and never calls wallet or demo identity APIs", async () => {
    const api = liveApi();
    const register = vi.spyOn(api, "registerAccount").mockResolvedValue({ ...unauthenticated, authenticated: true, context: "customer", accountId: "usr_test", accountType: "individual", expiresAt: "2030-01-01T00:00:00Z" });
    const demo = vi.spyOn(api, "createDemoSession");
    render(<Providers client={api}><WorkspaceOnboarding /></Providers>);
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Test workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create secure session" }));
    await waitFor(() => expect(register).toHaveBeenCalledWith({ displayName: "Test workspace", accountType: "individual" }));
    expect(demo).not.toHaveBeenCalled();
  });

  it("shows a registration failure and permits an existing-cookie session recheck", async () => {
    const api = liveApi();
    vi.spyOn(api, "registerAccount").mockRejectedValue(new Error("Registration unavailable"));
    const getSession = vi.spyOn(api, "getSession");
    render(<Providers client={api}><WorkspaceOnboarding /></Providers>);
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Test workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create secure session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not reach the service");
    fireEvent.click(screen.getByRole("button", { name: "Check existing session" }));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
  });
});
