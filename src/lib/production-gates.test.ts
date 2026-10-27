import { describe, expect, it } from "vitest";
import { deploymentNetworkOf, isExplicitNonProductionMockMode, productionRouteDecision } from "./production-gates";

describe("production mainnet route gates", () => {
  it("redirects only the production landing route to the wallet overview", () => {
    expect(productionRouteDecision("/", "GET", true)).toEqual({ kind: "redirect", destination: "/app" });
    expect(productionRouteDecision("/", "GET", false)).toEqual({ kind: "next" });
  });

  it("removes every legacy simulation route from production routing", () => {
    for (const pathname of ["/demo", "/merchant", "/payments", "/policy", "/privacy"]) {
      expect(productionRouteDecision(pathname, "GET", true)).toEqual({ kind: "not_found" });
    }
  });

  it("keeps mainnet and unknown production deployments read-only", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(productionRouteDecision("/api/agents", method, true, "mainnet")).toEqual({ kind: "method_not_allowed" });
      expect(productionRouteDecision("/api/agents", method, true, "unknown")).toEqual({ kind: "method_not_allowed" });
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(productionRouteDecision("/api/health", method, true)).toEqual({ kind: "next" });
    }
  });

  it("allows only authenticated-workspace write routes in a configured Testnet production deployment", () => {
    for (const [pathname, method] of [
      ["/api/auth/register", "POST"],
      ["/api/agents", "POST"],
      ["/api/agents/agt_123", "PATCH"],
      ["/api/agents/agt_123/policy", "PUT"],
      ["/api/session", "DELETE"],
    ]) {
      expect(productionRouteDecision(pathname, method, true, "testnet")).toEqual({ kind: "next" });
    }
    for (const [pathname, method] of [
      ["/api/session/demo", "POST"],
      ["/api/merchant/invoices", "POST"],
      ["/api/payments/request", "POST"],
      ["/api/payments/pay_123/execute", "POST"],
      ["/api/agents/agt_123", "DELETE"],
    ]) {
      expect(productionRouteDecision(pathname, method, true, "testnet")).toEqual({ kind: "method_not_allowed" });
    }
  });

  it("parses only an explicit server deployment network", () => {
    expect(deploymentNetworkOf("testnet")).toBe("testnet");
    expect(deploymentNetworkOf("mainnet")).toBe("mainnet");
    expect(deploymentNetworkOf("regtest")).toBe("unknown");
    expect(deploymentNetworkOf(undefined)).toBe("unknown");
  });

  it("permits mock UI only for tests or explicit non-production fixtures", () => {
    expect(isExplicitNonProductionMockMode("production", "1")).toBe(false);
    expect(isExplicitNonProductionMockMode("development", undefined)).toBe(false);
    expect(isExplicitNonProductionMockMode("development", "1")).toBe(true);
    expect(isExplicitNonProductionMockMode("test", undefined)).toBe(true);
  });
});
