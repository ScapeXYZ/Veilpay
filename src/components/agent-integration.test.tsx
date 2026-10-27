import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Providers } from "@/app/providers";
import { AGENT_ID } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import { AgentIntegration } from "./agent-integration";

function renderIntegration() {
  return render(<Providers client={new MockApiClient({ latencyMs: 0 })}><AgentIntegration agentId={AGENT_ID} /></Providers>);
}

describe("AgentIntegration onboarding", () => {
  it("offers all supported integration templates without embedding a credential", () => {
    renderIntegration();
    const selector = screen.getByRole("combobox", { name: "Integration type" });
    expect(screen.getByText("OpenClaw setup")).toBeInTheDocument();
    expect(screen.getAllByText(/VEILPAY_AGENT_CREDENTIAL/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/vpa_[a-z0-9]{20,}/i)).toBeNull();
    fireEvent.change(selector, { target: { value: "python" } });
    expect(screen.getByText("Python setup")).toBeInTheDocument();
    expect(screen.getByText(/requests\.post/)).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "javascript" } });
    expect(screen.getByText("JavaScript setup")).toBeInTheDocument();
    expect(screen.getByText(/crypto\.randomUUID/)).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "https" } });
    expect(screen.getByText("Other HTTPS Agent setup")).toBeInTheDocument();
    expect(screen.getByText(/curl --fail-with-body/)).toBeInTheDocument();
  });

  it("explains verification, credential privacy, and retained rules", () => {
    renderIntegration();
    expect(screen.getByText(/Generating a credential is not proof/)).toBeInTheDocument();
    expect(screen.getByText(/only after a verified API request/)).toBeInTheDocument();
    expect(screen.getByText(/Keep credentials out of URLs, analytics, logs, prompts, and screenshots/)).toBeInTheDocument();
    expect(screen.getByText(/Rules remain active when an agent disconnects/)).toBeInTheDocument();
  });
});
