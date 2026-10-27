import { describe, expect, it } from "vitest";
import { LOOPBACK_API_URL, apiProxyDestination } from "./deployment-config";

describe("public deployment API proxy", () => {
  it("uses the loopback Axum API by default", () => {
    expect(apiProxyDestination({})).toBe(LOOPBACK_API_URL);
  });

  it("refuses a public deployment with a remotely reachable backend", () => {
    expect(() => apiProxyDestination({
      VEILPAY_PUBLIC_DEPLOYMENT: "1",
      VEILPAY_BACKEND_URL: "https://api.example.test/api",
    })).toThrow("local Axum listener");
  });

  it("permits only the fixed loopback proxy in public mode", () => {
    expect(apiProxyDestination({
      VEILPAY_PUBLIC_DEPLOYMENT: "1",
      VEILPAY_BACKEND_URL: LOOPBACK_API_URL,
    })).toBe(LOOPBACK_API_URL);
  });
});
