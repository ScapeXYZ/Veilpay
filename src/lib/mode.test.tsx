import { describe, expect, it } from "vitest";
import { seedHealth } from "@/lib/api/fixtures";
import { networkModeOf } from "./mode";

describe("networkModeOf demo safety", () => {
  it("allows only the backend-declared regtest mock simulation", () => {
    const mode = networkModeOf({ ...seedHealth(), network: "regtest", mode: "mock", walletBackend: "mock" }, "live");
    expect(mode).toMatchObject({ kind: "mock", canWrite: true, canExecute: true });
    expect(mode.detail).toMatch(/cannot sign, broadcast, settle/i);
  });

  it("does not grant execution from the regtest name or a mismatched mock capability", () => {
    expect(networkModeOf({ ...seedHealth(), network: "regtest", mode: "real", walletBackend: "zingo" }, "live").canExecute).toBe(false);
    expect(networkModeOf({ ...seedHealth(), network: "regtest", mode: "mock", walletBackend: "zingo" }, "live").canWrite).toBe(false);
  });

  it("keeps mainnet read-only even if its health fields claim mock capabilities", () => {
    const mode = networkModeOf({ ...seedHealth(), network: "mainnet", mode: "mock", walletBackend: "mock" }, "live");
    expect(mode).toMatchObject({ kind: "mainnet_readonly", canWrite: false, canExecute: false });
  });
});
