import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

const { mode, session } = vi.hoisted(() => ({ mode: { current: "mainnet_readonly" }, session: { current: { authenticated: false, context: null, accountId: null, accountType: null, agentId: null, merchantId: null, csrfToken: null, expiresAt: null } } }));
vi.mock("@/lib/api/data-source", () => ({
  useNetworkMode: () => ({ kind: mode.current, label: "Mainnet · Read-only · Execution disabled", detail: "Read-only", canWrite: false, canExecute: false }),
}));
vi.mock("@/lib/api/hooks", () => ({
  useHealth: () => ({ data: undefined }),
  useSession: () => ({ data: session.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/components/noir-wallet-card", () => ({ NoirWalletCard: () => <div data-testid="noir-wallet-card">Connect Noir Wallet</div> }));
vi.mock("@/components/agent-summary", () => ({ AgentSummary: () => <div />, WorkspaceOnboarding: () => <div data-testid="workspace-onboarding">Create workspace</div> }));
vi.mock("@/components/shell", () => ({ PageHeader: () => null }));

describe("mainnet read-only overview", () => {
  beforeEach(() => { mode.current = "mainnet_readonly"; });
  it("shows the wallet connection without entering the mock demo-session gate", () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("noir-wallet-card")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-session-gate")).toBeNull();
    expect(screen.getByText(/server observer unavailable/i)).toBeInTheDocument();
  });

  it("keeps local Noir Wallet observation available while backend health is unknown", () => {
    mode.current = "unknown";
    render(<DashboardPage />);
    expect(screen.getByTestId("noir-wallet-card")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-session-gate")).toBeNull();
    expect(screen.getByText(/backend unavailable.*wallet observation only/i)).toBeInTheDocument();
  });

  it("shows Testnet workspace onboarding without a backend session", () => {
    mode.current = "real";
    render(<DashboardPage />);
    expect(screen.getByTestId("workspace-onboarding")).toBeInTheDocument();
  });
});
