"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "نظرة عامة" },
  { href: "/business", label: "بيانات المتجر" },
  { href: "/products", label: "المنتجات" },
  { href: "/faqs", label: "الأسئلة الشائعة" },
  { href: "/data", label: "الأسعار الحيّة" },
  { href: "/conversations", label: "المحادثات" },
  { href: "/leads", label: "العملاء المحتملون" },
  { href: "/try", label: "تجربة الوكيل" },
  { href: "/subscription", label: "الاشتراك" },
];

export default function PortalTabs() {
  const pathname = usePathname();

  return (
    <nav className="tabs">
      {TABS.map((t) => {
        const href = `/app${t.href}`;
        const active = t.href === "" ? pathname === "/app" : pathname.startsWith(href);
        return (
          <Link key={t.href} href={href} className={active ? "active" : ""}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
