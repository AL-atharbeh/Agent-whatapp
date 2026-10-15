import { Footer } from "@/components/footer";

/**
 * صفحات قانونية عامة — مطلوبة لنشر تطبيق Meta.
 * خارج حماية middleware عمداً: مراجعو Meta يفتحونها بدون تسجيل دخول.
 *
 * والتذييل هنا كذلك: من يفتح «سياسة الخصوصية» يبحث غالباً عن «حذف
 * البيانات» بعدها، ولا رابط بينهما كان يعني العودة للخلف والبحث من جديد.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main style={{ maxWidth: 760 }}>{children}</main>
      <Footer />
    </>
  );
}
