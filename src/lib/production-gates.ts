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

/** Server deployment configuration only. Never derive this from browser state or /api/health. */
export type DeploymentNetwork = "mainnet" | "testnet" | "unknown";

export function deploymentNetworkOf(value = process.env.VEILPAY_DEPLOYMENT_NETWORK): DeploymentNetwork {
  return value === "mainnet" || value === "testnet" ? value : "unknown";
}

function isTestnetWorkspaceWrite(pathname: string, method: string): boolean {
  const normalized = method.toUpperCase();
  if (normalized === "POST" && (pathname === "/api/auth/register" || pathname === "/api/agents")) return true;
  if (normalized === "POST" && (/^\/api\/agents\/[^/]+\/credentials(?:\/[^/]+\/(?:revoke|rotate))?$/.test(pathname) || pathname === "/api/v1/agent/payment-evaluations")) return true;
  if (normalized === "DELETE" && pathname === "/api/session") return true;
  if (normalized === "DELETE" && /^\/api\/agents\/[^/]+\/integrations\/activity$/.test(pathname)) return true;
  if (normalized === "PATCH" && /^\/api\/agents\/[^/]+$/.test(pathname)) return true;
  return normalized === "PUT" && /^\/api\/agents\/[^/]+\/policy$/.test(pathname);
}

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
  deploymentNetwork: DeploymentNetwork = deploymentNetworkOf(),
): ProductionRouteDecision {
  if (!production) return { kind: "next" };
  if (pathname === "/") return { kind: "redirect", destination: "/app" };
  if (LEGACY_SIMULATION_ROUTES.has(pathname)) return { kind: "not_found" };
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return { kind: "next" };
    // Mainnet and an absent/malformed deployment setting are always read-only.
    // Testnet has only the authenticated workspace surface; fixtures, invoices,
    // payment requests, execution, and every unlisted write stay unreachable.
    if (deploymentNetwork === "testnet" && isTestnetWorkspaceWrite(pathname, method)) return { kind: "next" };
    return { kind: "method_not_allowed" };
  }
  return { kind: "next" };
}
