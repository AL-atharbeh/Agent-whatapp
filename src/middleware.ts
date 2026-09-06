import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthConfigured, verifySession } from "@/lib/auth";

/**
 * حارس اللوحة.
 *
 * محميّ: /admin و /playground و /api/chat
 *   — اللوحة لأنها تعدّل وتحذف، وصفحة التجربة لأنها تستهلك رصيد النموذج.
 *
 * مفتوح عمداً: /api/webhooks/* (تناديه Meta ولها تحققها الخاص بالتوقيع)
 *              /api/health (تشخيص النشر، لا يكشف أي قيمة)
 */

export async function middleware(req: NextRequest) {
  // بدون ADMIN_PASSWORD لا يمكن تسجيل الدخول أصلاً ⇒ نغلق بدل أن نفتح للجميع
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?setup=1", req.url));
  }

  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/playground/:path*", "/api/chat"],
};
