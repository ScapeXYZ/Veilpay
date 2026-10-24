import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { MockBanner } from "@/components/source";
import { RequestComposer } from "@/components/request-composer";
import { seedHealth } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import type { ApiClient } from "@/lib/api/types";
import type { Health } from "@/lib/contract/schemas";
import { networkModeOf } from "./mode";

const real: Health = { ...seedHealth(), mode: "real", walletBackend: "zingolib", wallet: "ready", chainHeight: 3_100_000 };

/** A mock-backed client that reports itself as live with the given health (the gate keys on api.mode + /health). */
function liveClient(health: Health) {
  const inner = new MockApiClient({ latencyMs: 0 });
  const spy = vi.spyOn(inner, "requestPayment");
  const client = new Proxy(inner, {
    get(t, k, r) {
      if (k === "mode") return "live";
      if (k === "getHealth") return async () => health;
      const v = Reflect.get(t, k, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as unknown as ApiClient;
  return { client, spy };
}

describe("networkModeOf", () => {
  it("mainnet is read-only whatever the other health fields claim", () => {
    for (const mode of ["real", "testnet_manual", "mock", "disabled"] as const) {
      const m = networkModeOf({ ...real, network: "mainnet", mode }, "live");
      expect(m.kind).toBe("mainnet_readonly");
      expect(m.canWrite).toBe(false);
      expect(m.canExecute).toBe(false);
      expect(m.label).toMatch(/Read-only · Execution disabled/);
    }
  });
  it("fails closed when health is missing, errored or the network is unknown", () => {
    expect(networkModeOf(undefined, "live").canWrite).toBe(false);
    expect(networkModeOf(real, "live", true).canExecute).toBe(false);
    expect(networkModeOf({ ...real, network: "regtest" }, "live").canWrite).toBe(false);
  });
  it("testnet real allows writes; broadcast-disabled blocks only execute", () => {
    expect(networkModeOf(real, "live")).toMatchObject({ kind: "testnet", canWrite: true, canExecute: true });
    expect(networkModeOf({ ...real, wallet: "broadcast_disabled" }, "live")).toMatchObject({ kind: "disabled", canWrite: true, canExecute: false });
    expect(networkModeOf({ ...real, mode: "testnet_manual" }, "live").kind).toBe("testnet_manual");
  });
  it("the in-browser mock is always labelled simulation", () => {
    expect(networkModeOf({ ...real, network: "mainnet" }, "mock").kind).toBe("mock");
  });
});

describe("mainnet UI gate", () => {
  it("shows the persistent read-only banner", async () => {
    const { client } = liveClient({ ...real, network: "mainnet" });
    render(<Providers client={client}><MockBanner /></Providers>);
    expect(await screen.findByTestId("mainnet-banner")).toHaveTextContent(/Mainnet · Read-only · Execution disabled/i);
  });
  it("disables the payment request and never calls the API", async () => {
    const { client, spy } = liveClient({ ...real, network: "mainnet" });
    render(
      <Providers client={client}>
        <RequestComposer preset={{ invoiceId: "inv_x", zec: "0.1", reference: "r" }} cta="Request" onResult={() => {}} testId="rc" />
      </Providers>,
    );
    // before /health lands it is already blocked (fail closed), then names mainnet
    expect(screen.getByTestId("rc-submit")).toBeDisabled();
    expect(await screen.findByText(/Mainnet is read-only/)).toBeInTheDocument();
    const btn = screen.getByTestId("rc-submit");
    expect(btn).toBeDisabled();
    btn.click();
    expect(spy).not.toHaveBeenCalled();
  });
});
