import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNoirWalletUx } from "@/lib/wallet-ux/use-noir-wallet-ux";
import { BUSINESS_DRAFT_KEY } from "@/lib/wallet-ux/business-draft";
import { readUiPref, writeUiPref } from "@/lib/ui-prefs";
import type { WalletNetwork } from "@/lib/wallet-ux/wallet-state";
import { BusinessOnboarding } from "./business-onboarding";
import { WalletPanel } from "./wallet-panel";

const { getNoirWallet } = vi.hoisted(() => ({ getNoirWallet: vi.fn() }));
vi.mock("@noir-wallet/sdk", () => ({ getNoirWallet }));

const accounts = [
  { id: "wallet-a:0", label: "Treasury", walletId: "wallet-a", accountId: "0", addresses: { transparent: "t1aaaaaaaaaaaaaaaa", shielded: "u1treasuryshieldedaddress000000" } },
  { id: "wallet-b:0", label: "Operations", walletId: "wallet-b", accountId: "0", addresses: { transparent: "t1bbbbbbbbbbbbbbbb", shielded: "u1operationsshieldedaddress0000" } },
];

function provider(opts: { authorized?: boolean; reject?: boolean; list?: typeof accounts; unsynced?: string[] } = {}) {
  let authorized = opts.authorized ?? false;
  const list = opts.list ?? accounts;
  const listeners = new Set<(a?: unknown) => void>();
  const zcash = {
    getAccounts: vi.fn(async () => (authorized ? { transparent: list[0].addresses.transparent, shielded: list[0].addresses.shielded, accounts: list } : null)),
    connect: vi.fn(async () => {
      if (opts.reject) throw Object.assign(new Error("User rejected"), { code: 4001 });
      authorized = true;
      return { transparent: list[0].addresses.transparent, shielded: list[0].addresses.shielded, accounts: list };
    }),
    getBalance: vi.fn(async (id: string) => ({
      transparent: "0", shielded: "0",
      accounts: list.map((a) => ({ id: a.id, walletId: a.walletId, accountId: a.accountId, synced: !(opts.unsynced ?? []).includes(a.id),
        balance: { transparent: "0", shielded: a.id === list[0].id ? "2.50" : "0", available: "2.00", total: "2.60" } })),
      _asked: id,
    })),
    disconnect: vi.fn(async () => { authorized = false; }),
    sendTransaction: vi.fn(),
    signMessage: vi.fn(),
    getTransactionHistory: vi.fn(),
    on: vi.fn((_e: string, l: (a?: unknown) => void) => listeners.add(l)),
    removeListener: vi.fn((_e: string, l: (a?: unknown) => void) => listeners.delete(l)),
  };
  return { provider: { isNoirWallet: true, zcash }, zcash, emit: (a?: unknown) => listeners.forEach((l) => l(a)) };
}

function Harness({ expected = "mainnet" }: { expected?: WalletNetwork | null }) {
  const w = useNoirWalletUx(expected);
  return <><WalletPanel wallet={w} /><BusinessOnboarding wallet={w} /></>;
}

function neverCalledDangerous(z: ReturnType<typeof provider>["zcash"]) {
  expect(z.sendTransaction).not.toHaveBeenCalled();
  expect(z.signMessage).not.toHaveBeenCalled();
  expect(z.getTransactionHistory).not.toHaveBeenCalled();
}

describe("wallet UX panel", () => {
  beforeEach(() => { vi.clearAllMocks(); writeUiPref("local", BUSINESS_DRAFT_KEY, null); });

  it("not installed on desktop", async () => {
    getNoirWallet.mockReturnValue(null);
    render(<Harness />);
    await screen.findByTestId("wallet-state-not_installed");
    expect(screen.queryByTestId("wallet-connect")).toBeNull();
  });

  it("silent restore, connect only on click, picker switches account and refetches balance", async () => {
    const fake = provider();
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-state-disconnected");
    expect(fake.zcash.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("wallet-connect"));
    await screen.findByTestId("wallet-state-connected");
    expect(await screen.findByTestId("wallet-balance-shielded")).toHaveTextContent("2.50 ZEC");
    expect(fake.zcash.getBalance).toHaveBeenLastCalledWith("wallet-a:0");
    expect(screen.getByText("u1treasu…000000")).toBeInTheDocument();
    expect(screen.getAllByText(/Transparent · public/)).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId("wallet-account-wallet-b:0")).getByRole("radio"));
    await waitFor(() => expect(fake.zcash.getBalance).toHaveBeenLastCalledWith("wallet-b:0"));
    expect(await screen.findByTestId("wallet-balance-shielded")).toHaveTextContent("0 ZEC");
    neverCalledDangerous(fake.zcash);
  });

  it("unsynced account shows Unavailable, never 0", async () => {
    const fake = provider({ authorized: true, unsynced: ["wallet-a:0"] });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    expect(await screen.findByTestId("wallet-balance-shielded")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("wallet-balance-total")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("wallet-balance-note")).toHaveTextContent(/not finished syncing/);
  });

  it("declined connection keeps nothing", async () => {
    const fake = provider({ reject: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    fireEvent.click(await screen.findByTestId("wallet-connect"));
    await screen.findByTestId("wallet-state-rejected");
    expect(screen.queryByTestId("wallet-balance")).toBeNull();
  });

  it("wrong network fails closed", async () => {
    const fake = provider({ authorized: true, list: [{ ...accounts[0], addresses: { transparent: "tmTEST", shielded: "utest1abc" } }] });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-state-wrong_network");
    expect(screen.getByText(/wallet is on testnet/)).toBeInTheDocument();
    expect(screen.queryByTestId("wallet-account-picker")).toBeNull();
    expect(fake.zcash.getBalance).not.toHaveBeenCalled();
  });

  it("lock, account change and disconnect", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-balance-shielded");
    act(() => fake.emit([accounts[1]]));
    await screen.findByTestId("wallet-state-account_changed");
    expect(screen.queryByTestId("wallet-balance")).toBeNull();
    await screen.findByTestId("wallet-account-picker");
    fireEvent.click(within(screen.getByTestId("wallet-account-wallet-b:0")).getByRole("radio"));
    await screen.findByTestId("wallet-state-connected");
    act(() => fake.emit([]));
    await screen.findByTestId("wallet-state-locked");
    expect(screen.queryByTestId("wallet-balance")).toBeNull();
  });

  it("error state offers retry", async () => {
    const fake = provider({ authorized: true });
    fake.zcash.getAccounts.mockRejectedValueOnce(new Error("boom"));
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-state-error");
    fireEvent.click(screen.getByTestId("wallet-retry"));
    await screen.findByTestId("wallet-state-connected");
  });

  it("disconnect revokes and clears", async () => {
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-balance-shielded");
    fireEvent.click(screen.getByTestId("wallet-disconnect"));
    await screen.findByTestId("wallet-state-disconnected");
    expect(fake.zcash.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("business onboarding", () => {
  beforeEach(() => { vi.clearAllMocks(); writeUiPref("local", BUSINESS_DRAFT_KEY, null); });

  it("4 steps save only a labelled local draft with no wallet data and no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fake = provider({ authorized: true });
    getNoirWallet.mockReturnValue(fake.provider);
    render(<Harness />);
    await screen.findByTestId("wallet-balance-shielded");
    expect(screen.getByTestId("draft-badge")).toHaveTextContent("Local draft · Not registered");
    fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(await screen.findByText("Enter your business name.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("business-name"), { target: { value: "  Ada Coffee  " } });
    fireEvent.click(screen.getByLabelText("Services"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    await screen.findByTestId("onboarding-step-payout");
    fireEvent.click(screen.getByTestId("payout-wallet-b:0"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    await screen.findByTestId("onboarding-step-review");
    expect(screen.getByTestId("review-disclosure")).toHaveTextContent(/not registered/i);
    expect(within(screen.getByTestId("onboarding-step-review")).getByText("Operations")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await screen.findByTestId("onboarding-step-saved");
    const raw = readUiPref("local", BUSINESS_DRAFT_KEY)!;
    const saved = JSON.parse(raw);
    expect(saved).toMatchObject({ v: 1, businessName: "Ada Coffee", category: "Services", registered: false });
    expect(Object.keys(saved).sort()).toEqual(["businessName", "category", "registered", "savedAt", "v"]);
    expect(raw).not.toMatch(/u1|t1|wallet-/);
    expect(fetchSpy).not.toHaveBeenCalled();
    neverCalledDangerous(fake.zcash);
    fireEvent.click(screen.getByTestId("onboarding-delete"));
    await screen.findByTestId("onboarding-step-business");
    expect(readUiPref("local", BUSINESS_DRAFT_KEY)).toBeNull();
  });

  it("payout step asks to connect when no wallet, and a saved draft reloads", async () => {
    getNoirWallet.mockReturnValue(null);
    writeUiPref("local", BUSINESS_DRAFT_KEY, JSON.stringify({ v: 1, businessName: "Bob Bikes", category: "Online store", savedAt: "2026-10-25T00:00:00.000Z", registered: false }));
    render(<Harness />);
    expect(await screen.findByTestId("saved-summary")).toHaveTextContent("Bob Bikes · Online store");
    fireEvent.click(screen.getByTestId("onboarding-edit"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    await screen.findByTestId("payout-needs-wallet");
    expect(screen.getByTestId("onboarding-next")).toHaveTextContent("Skip for now");
  });
});
