import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/auth";

/**
 * توجيه وحماية المسارات.
 *
 *   /admin  → مالك المنصة فقط
 *   /app    → صاحب المتجر (ومالك المنصة يُحوَّل للوحته)
 *   /login و /signup → عامة، وتحوّل المسجَّل دخوله للوحته
 *
 * مفتوح عمداً: /api/webhooks/* (تناديه Meta بتوقيعها الخاص) و /api/health
 * والصفحات القانونية (يفتحها مراجعو Meta بلا حساب).
 *
 * ⚠️ هذا الحارس للمسارات فقط. server actions تُفحص في lib/session.ts.
 */

const PUBLIC = ["/login", "/signup", "/privacy", "/terms", "/data-deletion"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    // مسجَّل دخوله بالفعل ⇒ لا داعي لصفحة الدخول
    if (session && (pathname === "/login" || pathname === "/signup")) {
      const home = session.role === "PLATFORM_ADMIN" ? "/admin" : "/app";
      return NextResponse.redirect(new URL(home, req.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && session.role !== "PLATFORM_ADMIN") {
    return NextResponse.redirect(new URL("/app", req.url));
  }

  if (pathname.startsWith("/app") && session.role === "PLATFORM_ADMIN") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/app/:path*",
    "/playground/:path*",
    "/api/chat",
    "/login",
    "/signup",
  ],
};
