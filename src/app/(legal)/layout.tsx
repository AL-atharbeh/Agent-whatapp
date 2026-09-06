/**
 * صفحات قانونية عامة — مطلوبة لنشر تطبيق Meta.
 * خارج حماية middleware عمداً: مراجعو Meta يفتحونها بدون تسجيل دخول.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 760 }}>{children}</main>;
}
