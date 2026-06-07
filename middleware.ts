import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, verifyAuthCookieValue } from "@/lib/auth";

function isPublicPath(pathname: string) {
  if (pathname === "/login" || pathname === "/api/login") return true;
  if (pathname === "/favicon.ico" || pathname === "/icon.svg") return true;
  if (pathname.startsWith("/_next/")) return true;
  return /\.(?:css|js|map|png|jpg|jpeg|gif|webp|svg|ico|txt|woff|woff2)$/i.test(pathname);
}

function loginUrl(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next !== "/") url.searchParams.set("next", next);
  return url;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const authenticated = await verifyAuthCookieValue(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Please enter the Writing Journal password." }, { status: 401 });
  }

  return NextResponse.redirect(loginUrl(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
