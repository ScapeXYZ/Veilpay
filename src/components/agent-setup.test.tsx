import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { MockApiClient } from "@/lib/api/mock";
import { AGENT_ID } from "@/lib/api/fixtures";
import { AgentSummary } from "./agent-summary";

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
