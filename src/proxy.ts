import { NextResponse, type NextRequest } from "next/server";
import { deploymentNetworkOf, productionRouteDecision } from "@/lib/production-gates";

/**
 * Deployment boundary. Its network is server configuration, never a browser
 * preference or health response. The Rust backend repeats the same fail-closed
 * policy so a rewrite configuration mistake cannot create payment authority.
 */
export function proxy(request: NextRequest) {
  const decision = productionRouteDecision(
    request.nextUrl.pathname,
    request.method,
    process.env.NODE_ENV === "production",
    deploymentNetworkOf(),
  );
  if (decision.kind === "redirect") return NextResponse.redirect(new URL(decision.destination, request.url), 307);
  if (decision.kind === "not_found") return new NextResponse(null, { status: 404 });
  if (decision.kind === "method_not_allowed") {
    return NextResponse.json(
      { code: "READ_ONLY_API", message: "This production API operation is not available." },
      { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/demo", "/merchant", "/payments", "/policy", "/privacy", "/api/:path*"],
};
