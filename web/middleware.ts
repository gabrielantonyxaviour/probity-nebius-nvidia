import { NextResponse, type NextRequest } from "next/server";

// Every page under /app needs a session. Without one the visitor goes to sign-in and comes back afterwards.
// This checks only that a session cookie is present; the engine validates the session on every API call.
const SESSION_COOKIES = ["__Secure-probity.session_token", "probity.session_token"];

export function middleware(req: NextRequest) {
  if (SESSION_COOKIES.some((n) => req.cookies.has(n))) return NextResponse.next();
  const to = new URL("/signin", req.url);
  to.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(to);
}

export const config = { matcher: ["/app", "/app/:path*"] };
