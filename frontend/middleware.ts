import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** UX-only gate — real protection is FastAPI JWT verification. */
const PROTECTED = [
  "/dashboard",
  "/session",
  "/practice",
  "/exam",
  "/custom-quiz",
  "/chat",
  "/saved",
  "/weak-spots",
  "/weekly-plan",
  "/summary",
  "/onboarding",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!needsAuth) return NextResponse.next();

  // Supabase stores the session in localStorage by default (not cookies), so
  // middleware cannot reliably see tokens. Keep a soft cookie flag set by the
  // client after login for redirect UX only.
  const flag = request.cookies.get("uraan_signed_in")?.value;
  if (!flag) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/session/:path*",
    "/practice/:path*",
    "/exam/:path*",
    "/custom-quiz/:path*",
    "/chat/:path*",
    "/saved/:path*",
    "/weak-spots/:path*",
    "/weekly-plan/:path*",
    "/summary/:path*",
    "/onboarding/:path*",
  ],
};
