import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, authCookieOptions, createAuthCookieValue } from "@/lib/auth";

function safeRedirectPath(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/login")) return "/";
  return next;
}

function loginRedirect(request: Request, reason: "invalid" | "config", next: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

function constantTimeEqual(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    result |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return result === 0;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const next = safeRedirectPath(form.get("next"));
  const expected = process.env.WRITING_JOURNAL_PASSWORD;

  if (!expected) {
    console.error("WRITING_JOURNAL_PASSWORD is not configured");
    return loginRedirect(request, "config", next);
  }

  if (!constantTimeEqual(password, expected)) {
    return loginRedirect(request, "invalid", next);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(AUTH_COOKIE_NAME, await createAuthCookieValue(), authCookieOptions());
  return response;
}

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
