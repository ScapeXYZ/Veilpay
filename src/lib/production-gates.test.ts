import { describe, expect, it } from "vitest";
import { isExplicitNonProductionMockMode, productionRouteDecision } from "./production-gates";

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

  it("denies every production API write while retaining read-only requests", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(productionRouteDecision("/api/payments/request", method, true)).toEqual({ kind: "method_not_allowed" });
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(productionRouteDecision("/api/health", method, true)).toEqual({ kind: "next" });
    }
  });

  it("permits mock UI only for tests or explicit non-production fixtures", () => {
    expect(isExplicitNonProductionMockMode("production", "1")).toBe(false);
    expect(isExplicitNonProductionMockMode("development", undefined)).toBe(false);
    expect(isExplicitNonProductionMockMode("development", "1")).toBe(true);
    expect(isExplicitNonProductionMockMode("test", undefined)).toBe(true);
  });
});
