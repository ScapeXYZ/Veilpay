import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoirWalletCard } from "./noir-wallet-card";

const { detectProvider, getNoirWallet } = vi.hoisted(() => ({ detectProvider: vi.fn(), getNoirWallet: vi.fn() }));
vi.mock("@noir-wallet/sdk", () => ({ detectProvider, getNoirWallet }));
vi.mock("@/lib/api/data-source", () => ({
  useNetworkMode: () => ({ kind: "mainnet_readonly" }),
}));

const accounts = [
  { id: "wallet-a:0", label: "Treasury", walletId: "wallet-a", accountId: "0", addresses: { transparent: "t1a", shielded: "u1a" } },
  { id: "wallet-b:0", label: "Operations", walletId: "wallet-b", accountId: "0", addresses: { transparent: "t1b", shielded: "u1b" } },
];

function provider(opts: { authorized?: boolean; reject?: boolean } = {}) {
  let authorized = opts.authorized ?? false;
  const listeners = new Set<(accounts?: unknown) => void>();
  const zcash = {
    getAccounts: vi.fn(async () => authorized ? { transparent: "t1a", shielded: "u1a", accounts } : null),
    connect: vi.fn(async () => {
      if (opts.reject) throw Object.assign(new Error("User rejected"), { code: 4001 });
      authorized = true;
      return { transparent: "t1a", shielded: "u1a", accounts };
    }),
    getBalance: vi.fn(async (id: string) => ({
      transparent: "0", shielded: id === accounts[1].id ? "1.25" : "2.50", available: id === accounts[1].id ? "1.00" : "2.00", total: id === accounts[1].id ? "1.30" : "2.60",
      accounts: accounts.map((account) => ({ id: account.id, walletId: account.walletId, accountId: account.accountId, synced: account.id !== accounts[1].id, balance: { transparent: "0", shielded: account.id === accounts[1].id ? "1.25" : "2.50", available: account.id === accounts[1].id ? "1.00" : "2.00", total: account.id === accounts[1].id ? "1.30" : "2.60" } })),
    })),
    getTransactionHistory: vi.fn(async () => [{ txid: "a".repeat(64), type: "receive", amount: "0.25", status: "mined", timestamp: 1_700_000_000_000, memo: "never render this" }]),
    disconnect: vi.fn(async () => { authorized = false; }),
    on: vi.fn((_event: string, listener: (accounts?: unknown) => void) => listeners.add(listener)),
    removeListener: vi.fn((_event: string, listener: (accounts?: unknown) => void) => listeners.delete(listener)),
  };
  return { provider: { isNoirWallet: true, zcash }, zcash, changed: (accounts?: unknown) => { if (Array.isArray(accounts) && accounts.length === 0) authorized = false; listeners.forEach((listener) => listener(accounts)); } };
}

describe("NoirWalletCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectProvider.mockRejectedValue(new Error("Noir Wallet is not installed"));
  });

  it("waits once for Noir Wallet's official delayed-injection signal before reporting unavailable", async () => {
    const fake = provider();
    getNoirWallet.mockReturnValueOnce(null).mockReturnValue(fake.provider);
    detectProvider.mockResolvedValue({});
    render(<NoirWalletCard />);
    await screen.findByText(/connect an account/i);
    expect(detectProvider).toHaveBeenCalledTimes(1);
    expect(fake.zcash.getAccounts).toHaveBeenCalledTimes(1);
    expect(fake.zcash.connect).not.toHaveBeenCalled();
  });

  it("reports unavailable only after the bounded detection attempt fails", async () => {
    getNoirWallet.mockReturnValue(null);
    render(<NoirWalletCard />);
    await screen.findByText(/not detected on this page/i);
    expect(detectProvider).toHaveBeenCalledTimes(1);
  });

  it("silently checks existing authorization and only requests it after a click", async () => {
    const fake = provider();
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText(/connect an account/i);
    expect(fake.zcash.getAccounts).toHaveBeenCalledTimes(1);
    expect(fake.zcash.connect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("connect-noir-wallet"));
    await screen.findByText("2.50 ZEC");
    expect(fake.zcash.connect).toHaveBeenCalledTimes(1);
  });

  it("renders returned mainnet addresses and wallet activity without rendering a memo", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText("2.50 ZEC");
    expect(screen.getByTestId("noir-addresses")).toHaveTextContent("t1a");
    expect(screen.getByTestId("noir-addresses")).toHaveTextContent("u1a");
    await screen.findByText("Receive");
    expect(screen.getByTestId("noir-activity-list")).toHaveTextContent("0.25 ZEC");
    expect(screen.queryByText("never render this")).toBeNull();
    expect(fake.zcash.getTransactionHistory).toHaveBeenCalledTimes(1);
  });

  it("refuses testnet-looking accounts instead of presenting them as mainnet", async () => {
    const fake = provider({ authorized: true });
    fake.provider.zcash.getAccounts.mockResolvedValue({ transparent: "tmabc", shielded: "utest1abc", accounts: [{ ...accounts[0], addresses: { transparent: "tmabc", shielded: "utest1abc" } }] });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText(/not a noir wallet mainnet connection/i);
    expect(screen.queryByTestId("noir-balances")).toBeNull();
    expect(fake.zcash.getTransactionHistory).not.toHaveBeenCalled();
  });

  it("switches only between authorized accounts and labels an unsynced wallet balance", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText("2.50 ZEC");
    fireEvent.change(screen.getByTestId("noir-account-select"), { target: { value: accounts[1].id } });
    await screen.findByText("1.25 ZEC");
    expect(fake.zcash.getBalance).toHaveBeenLastCalledWith(accounts[1].id);
    expect(screen.getByText(/sync is incomplete/i)).toBeInTheDocument();
  });

  it("clears stale state on authorization changes and revokes access only after an explicit click", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText("2.50 ZEC");
    await act(async () => fake.changed());
    await waitFor(() => expect(fake.zcash.getAccounts).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId("disconnect-noir-wallet"));
    await screen.findByText(/connect an account/i);
    expect(fake.zcash.disconnect).toHaveBeenCalledTimes(1);
  });

  it("treats an empty accountsChanged event as a locked wallet and clears its balance", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText("2.50 ZEC");
    await act(async () => fake.changed([]));
    await screen.findByText(/wallet is locked/i);
    expect(screen.queryByTestId("noir-balances")).toBeNull();
  });

  it("reports an authorization rejection without retaining an account", async () => {
    const fake = provider({ reject: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<NoirWalletCard />);
    await screen.findByText(/connect an account/i);
    fireEvent.click(screen.getByTestId("connect-noir-wallet"));
    await screen.findByText(/connection was declined/i);
    expect(screen.queryByTestId("noir-balances")).toBeNull();
  });
});
