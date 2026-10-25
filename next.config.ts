import type { NextConfig } from "next";

/**
 * Same-origin API: in live mode the browser calls /api/* and Next proxies it to the Rust
 * backend (VEILPAY_BACKEND_URL, server-side only), so the session cookie stays first-party.
 */
// Submission builds are mainnet-observation builds. Keep the browser on a
// same-origin API and use the local read-only backend unless deployment
// configuration explicitly supplies another reviewed endpoint.
const backend = process.env.VEILPAY_BACKEND_URL ?? "http://127.0.0.1:4000/api";

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep Next's project-local `tsc` build check enabled. The compiler-API
  // worker can stall in restricted runners after compilation completes.
  experimental: { useTypeScriptCli: true },
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return backend ? [{ source: "/api/:path*", destination: `${backend}/:path*` }] : [];
  },
};

export default nextConfig;
