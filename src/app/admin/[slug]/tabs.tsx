"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "الإعدادات والبيانات" },
  { href: "/billing", label: "الاشتراك" },
  { href: "/products", label: "المنتجات" },
  { href: "/faqs", label: "الأسئلة الشائعة" },
  { href: "/data", label: "البيانات الحيّة" },
  { href: "/channels", label: "القنوات" },
  { href: "/conversations", label: "المحادثات" },
  { href: "/leads", label: "العملاء المحتملون" },
];

// تبويب المواعيد لمتجر فعّل الوحدة وحده — غيره لا يرى أثراً لها
const APPOINTMENTS = { href: "/appointments", label: "المواعيد" };

export default function Tabs({ slug, appointments = false }: { slug: string; appointments?: boolean }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  const tabs = appointments ? [...TABS.slice(0, 1), APPOINTMENTS, ...TABS.slice(1)] : TABS;

  return (
    <nav className="tabs">
      {tabs.map((t) => {
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
