import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/auth/login", "/auth/register", "/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const token = req.cookies.get("oc_token")?.value;

  if (!isPublic && !token) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
