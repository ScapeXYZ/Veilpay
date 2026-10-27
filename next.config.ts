import type { NextConfig } from "next";

/**
 * Same-origin API: in live mode the browser calls /api/* and Next proxies it to the Rust
 * backend (VEILPAY_BACKEND_URL, server-side only), so the session cookie stays first-party.
 */
// Keep the browser on a same-origin API. The proxy's separately configured
// deployment network decides whether its narrow Testnet workspace writes are
// available; the Rust backend repeats that policy.
const backend = process.env.VEILPAY_BACKEND_URL ?? "http://127.0.0.1:4000/api";

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Test harnesses can build/start an isolated production output while a local
  // development inspection server keeps using .next.
  distDir: process.env.VEILPAY_DIST_DIR ?? ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep Next's TypeScript build check enabled. The CLI runner receives empty
  // stdout from TypeScript 5.9 under this local Node 22 environment, so use
  // Next's supported compiler-API checker rather than parsing that stream.
  experimental: { useTypeScriptCli: false },
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return backend ? [{ source: "/api/:path*", destination: `${backend}/:path*` }] : [];
  },
};

export default nextConfig;
