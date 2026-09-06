import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, createSession, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";

  const password = formData.get("password")?.toString() ?? "";
  const next = formData.get("next")?.toString() || "/admin";

  if (!(await checkPassword(password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const session = await createSession();
  (await cookies()).set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });

  // لا نعيد التوجيه إلا لمسار داخلي — يمنع الاستغلال عبر open redirect
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/admin");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; setup?: string }>;
}) {
  const sp = await searchParams;

  if (sp.setup === "1" || !isAuthConfigured()) {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>الإعداد غير مكتمل</h1>
        <div className="card">
          <p className="sub" style={{ marginTop: 0 }}>
            متغيّر <code>ADMIN_PASSWORD</code> غير مضبوط، فاللوحة مقفلة بالكامل حمايةً
            لبياناتك.
          </p>
          <p className="hint">
            أضفه في إعدادات النشر (Environment Variables) ثم أعد النشر. اختر كلمة سر قوية —
            هي الحاجز الوحيد بين الإنترنت وبيانات عملائك.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <h1>وكيل</h1>
      <p className="sub">لوحة التحكم — تسجيل الدخول</p>

      <div className="card">
        <form action={login}>
          <input type="hidden" name="next" value={sp.next ?? "/admin"} />
          <label>
            <span>كلمة السر</span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
            />
          </label>

          {sp.error && (
            <p className="hint" style={{ color: "#f87171" }}>
              كلمة السر غير صحيحة.
            </p>
          )}

          <button type="submit" style={{ width: "100%" }}>
            دخول
          </button>
        </form>
      </div>
    </main>
  );
}
