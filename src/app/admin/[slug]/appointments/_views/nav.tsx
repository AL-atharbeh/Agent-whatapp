"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "", label: "اليوم" },
  { href: "/services", label: "الخدمات" },
  { href: "/team", label: "الفريق" },
  { href: "/customers", label: "العملاء" },
  { href: "/reports", label: "التقارير" },
];

/** تبويبات قسم المواعيد — نفس شكل التبويبات العلوية، بمسار البوابة الحالية. */
export default function AppointmentsNav({ base }: { base: string }) {
  const pathname = usePathname();
  return (
    <nav className="tabs" style={{ marginBottom: 20 }}>
      {SECTIONS.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={t.href} href={href} className={active ? "active" : ""}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
