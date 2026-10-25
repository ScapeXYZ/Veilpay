import { NextResponse, type NextRequest } from "next/server";
import { productionRouteDecision } from "@/lib/production-gates";

/**
 * Deployment boundary for the public mainnet observer. This is defence in
 * depth: backend mainnet guards still own the authorization decision.
 */
export function proxy(request: NextRequest) {
  const decision = productionRouteDecision(
    request.nextUrl.pathname,
    request.method,
    process.env.NODE_ENV === "production",
  );
  if (decision.kind === "redirect") return NextResponse.redirect(new URL(decision.destination, request.url), 307);
  if (decision.kind === "not_found") return new NextResponse(null, { status: 404 });
  if (decision.kind === "method_not_allowed") {
    return NextResponse.json(
      { code: "READ_ONLY_API", message: "The production mainnet API is read-only." },
      { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/demo", "/merchant", "/payments", "/policy", "/privacy", "/api/:path*"],
};
