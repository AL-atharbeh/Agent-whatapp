import Link from "next/link";
import { signup } from "../actions";
import { BUSINESS_TYPES } from "@/app/admin/types";
import { Mark, Wordmark } from "@/components/brand";
import { Reveal } from "@/components/motion";

export const dynamic = "force-dynamic";
export const metadata = { title: "إنشاء حساب" };

const ERRORS: Record<string, string> = {
  missing: "املأ كل الحقول المطلوبة.",
  email: "البريد الإلكتروني غير صالح.",
  weak: "كلمة السر يجب ألا تقل عن ٨ أحرف.",
  exists: "هذا البريد مسجَّل مسبقاً — سجّل الدخول بدل ذلك.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="narrow" style={{ maxWidth: 540 }}>
      <Reveal>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <Mark size={64} />
          <div style={{ marginTop: 16, marginBottom: 6 }}>
            <Wordmark />
          </div>
          <p className="sub" style={{ margin: 0 }}>
            دقيقتان، ويبدأ حاضر بالرد على عملائك
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        {sp.error && (
          <div className="alert danger">
            {ERRORS[sp.error] ?? "تعذّر إنشاء الحساب."}
          </div>
        )}

        <div className="card pad-lg raised">
          <form action={signup}>
            <h3>عن نشاطك التجاري</h3>

            <label>
              <span>اسم المتجر / النشاط *</span>
              <input
                type="text"
                name="businessName"
                required
                autoFocus
                placeholder="مجوهرات الأثري"
              />
            </label>

            <div className="grid2">
              <label>
                <span>نوع النشاط</span>
                <select name="businessType" defaultValue="other">
                  {BUSINESS_TYPES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>هاتف المتجر</span>
                <input type="text" name="phone" placeholder="+962 7 ..." />
              </label>
            </div>

            <h3 style={{ marginTop: 22 }}>حسابك</h3>

            <label>
              <span>اسمك *</span>
              <input type="text" name="name" required placeholder="أحمد" />
            </label>

            <label>
              <span>البريد الإلكتروني *</span>
              <input
                type="email"
                name="email"
                required
                dir="ltr"
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>

            <label>
              <span>كلمة السر * (٨ أحرف على الأقل)</span>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>

            <button type="submit" className="block lg">
              إنشاء الحساب
            </button>

            <p
              className="hint"
              style={{ textAlign: "center", margin: "14px 0 0" }}
            >
              بإنشاء الحساب أنت توافق على{" "}
              <Link href="/terms">شروط الاستخدام</Link> و{" "}
              <Link href="/privacy">سياسة الخصوصية</Link>
            </p>
          </form>
        </div>

        <p className="sub" style={{ textAlign: "center", marginTop: 22 }}>
          عندك حساب؟ <Link href="/login">سجّل الدخول</Link>
        </p>
      </Reveal>
    </main>
  );
}
