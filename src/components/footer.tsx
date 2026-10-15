import Link from "next/link";

/**
 * تذييل الصفحات الداخلية.
 *
 * الصفحات القانونية كانت موجودة ومنشورة — Meta تطلبها للموافقة على التطبيق —
 * لكن لا رابط إليها من داخل اللوحة. فصارت صفحات تُكتَب لمراجع خارجي ولا
 * يصلها من تسري عليه: صاحب المتجر يوقّع على شروط عند التسجيل ثم لا يجد
 * سبيلاً لقراءتها ثانيةً، وحذف البيانات حقٌّ لا باب له.
 *
 * ولأنها التزام لا زينة، تظهر في اللوحتين معاً — لوحة المنصة وبوابة العميل.
 */

const LINKS = [
  { href: "/privacy", label: "سياسة الخصوصية" },
  { href: "/terms", label: "شروط الاستخدام" },
  { href: "/data-deletion", label: "حذف البيانات" },
];

export function Footer() {
  return (
    <footer
      style={{
        borderBlockStart: "1px solid var(--border)",
        marginBlockStart: 48,
        padding: "22px 22px 36px",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px 22px",
          fontSize: 12.5,
          color: "var(--text-3)",
        }}
      >
        <nav style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={{ color: "var(--text-2)" }}>
              {l.label}
            </Link>
          ))}
        </nav>

        <span>
          حاضر · HADER — © {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
