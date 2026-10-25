/**
 * Production boundary rules. They deliberately do not infer backend health:
 * an untrusted or unavailable backend must never make simulation routes or
 * write methods available in the public deployment.
 */
const LEGACY_SIMULATION_ROUTES = new Set([
  "/demo",
  "/merchant",
  "/payments",
  "/policy",
  "/privacy",
]);

export type ProductionRouteDecision =
  | { kind: "next" }
  | { kind: "redirect"; destination: "/app" }
  | { kind: "not_found" }
  | { kind: "method_not_allowed" };

export function isExplicitNonProductionMockMode(
  nodeEnv = process.env.NODE_ENV,
  allowMockUi = process.env.NEXT_PUBLIC_ALLOW_MOCK_UI,
): boolean {
  return nodeEnv === "test" || (nodeEnv !== "production" && allowMockUi === "1");
}

export function productionRouteDecision(
  pathname: string,
  method: string,
  production: boolean,
): ProductionRouteDecision {
  if (!production) return { kind: "next" };
  if (pathname === "/") return { kind: "redirect", destination: "/app" };
  if (LEGACY_SIMULATION_ROUTES.has(pathname)) return { kind: "not_found" };
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return { kind: "method_not_allowed" };
  }
  return { kind: "next" };
}
