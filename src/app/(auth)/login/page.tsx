import Link from "next/link";
import { login } from "../actions";
import { Mark, Wordmark } from "@/components/brand";
import { Reveal } from "@/components/motion";
import { SubmitButton } from "@/components/pending";

export const dynamic = "force-dynamic";
export const metadata = { title: "تسجيل الدخول" };

/** الدقائق من الرابط — رقم صغير فقط، فالرابط يُنسَخ ويُعدَّل باليد. */
const waitMinutes = (v?: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 15 ? n : 15;
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; registered?: string; wait?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="narrow">
      <Reveal>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <Mark size={64} />
          <div style={{ marginTop: 16, marginBottom: 6 }}>
            <Wordmark />
          </div>
          <p className="sub" style={{ margin: 0 }}>
            موظفك الذي لا ينام
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
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
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
              />
            </label>

            {sp.error && (
              <p className="hint" style={{ color: "var(--danger)", marginBottom: 16 }}>
                {sp.error === "rate"
                  ? `محاولات دخول كثيرة — جرّب بعد ${waitMinutes(sp.wait)} دقيقة.`
                  : "البريد أو كلمة السر غير صحيحة."}
              </p>
            )}

            <SubmitButton className="block lg">
              دخول
            </SubmitButton>
          </form>
        </div>

        <p className="sub" style={{ textAlign: "center", marginTop: 22 }}>
          ما عندك حساب؟ <Link href="/signup">أنشئ متجرك مجاناً</Link>
        </p>
      </Reveal>
    </main>
  );
}
