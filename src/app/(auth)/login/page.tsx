import Link from "next/link";
import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; registered?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="narrow">
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div
          className="brand-mark"
          style={{ width: 44, height: 44, fontSize: 22, margin: "0 auto 14px" }}
        >
          و
        </div>
        <h1>وكيل</h1>
        <p className="sub" style={{ margin: 0 }}>
          وكيل ذكاء اصطناعي يرد على عملائك
        </p>
      </div>

      {sp.registered && (
        <div className="alert ok">تم إنشاء حسابك — سجّل الدخول للمتابعة.</div>
      )}

      <div className="card pad-lg raised">
        <form action={login}>
          <input type="hidden" name="next" value={sp.next ?? ""} />

          <label>
            <span>البريد الإلكتروني</span>
            <input
              type="email"
              name="email"
              required
              autoFocus
              autoComplete="email"
              dir="ltr"
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span>كلمة السر</span>
            <input type="password" name="password" required autoComplete="current-password" />
          </label>

          {sp.error && (
            <p className="hint" style={{ color: "var(--danger)" }}>
              البريد أو كلمة السر غير صحيحة.
            </p>
          )}

          <button type="submit" className="block">
            دخول
          </button>
        </form>
      </div>

      <p className="sub" style={{ textAlign: "center", marginTop: 20 }}>
        ما عندك حساب؟ <Link href="/signup">أنشئ متجرك مجاناً</Link>
      </p>
    </main>
  );
}
