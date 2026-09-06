"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "الإعدادات والبيانات" },
  { href: "/products", label: "المنتجات" },
  { href: "/faqs", label: "الأسئلة الشائعة" },
  { href: "/data", label: "البيانات الحيّة" },
  { href: "/channels", label: "القنوات" },
  { href: "/conversations", label: "المحادثات" },
  { href: "/leads", label: "العملاء المحتملون" },
];

export default function Tabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;

  return (
    <nav className="tabs">
      {TABS.map((t) => {
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
