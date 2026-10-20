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

// تبويب المواعيد لمتجر فعّل الوحدة وحده — غيره لا يرى أثراً لها
const APPOINTMENTS = { href: "/appointments", label: "المواعيد" };

export default function PortalTabs({ appointments = false }: { appointments?: boolean }) {
  const pathname = usePathname();
  const tabs = appointments ? [...TABS.slice(0, 1), APPOINTMENTS, ...TABS.slice(1)] : TABS;

  return (
    <nav className="tabs">
      {tabs.map((t) => {
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
