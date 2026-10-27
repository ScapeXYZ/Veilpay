/** The only API destination permitted by the single-container public deployment. */
export const LOOPBACK_API_URL = "http://127.0.0.1:4100/api";

type Environment = Record<string, string | undefined>;

/**
 * Keep the browser-facing Next server as the only public entry point. A public
 * deployment must never rewrite cookies or authenticated API traffic to an
 * Internet-reachable Axum URL.
 */
export function apiProxyDestination(environment: Environment = process.env): string {
  const destination = environment.VEILPAY_BACKEND_URL ?? LOOPBACK_API_URL;
  if (environment.VEILPAY_PUBLIC_DEPLOYMENT === "1" && destination !== LOOPBACK_API_URL) {
    throw new Error("Public VeilPay deployments must proxy /api only to the local Axum listener");
  }
  return destination;
}
