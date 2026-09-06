import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "وكيل — لوحة التحكم",
  description: "وكيل ذكاء اصطناعي لخدمة عملاء البزنسات",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
