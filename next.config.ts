import type { NextConfig } from "next";

/**
 * Same-origin API: in live mode the browser calls /api/* and Next proxies it to the Rust
 * backend (VEILPAY_BACKEND_URL, server-side only), so the session cookie stays first-party.
 */
const backend = process.env.VEILPAY_BACKEND_URL;

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  /** Pre-Phase-1 deep links keep working (reviewed aliases, not permanent). */
  async redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    return [
      to("/policy", "/app/spending-rules"),
      to("/app/policy", "/app/spending-rules"),
      to("/help", "/app/help"),
      ...["payments", "merchant", "privacy", "activity"].map((r) => to(`/${r}`, `/app/${r}`)),
    ];
  },
  async rewrites() {
    return backend ? [{ source: "/api/:path*", destination: `${backend}/:path*` }] : [];
  },
};

export default nextConfig;
