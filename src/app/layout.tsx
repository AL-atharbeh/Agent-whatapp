import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Orbitron } from "next/font/google";
import "./globals.css";

/**
 * خطّان فقط:
 *  - IBM Plex Sans Arabic للواجهة كلها — عربي محترف بأوزان كاملة، ولاتينيته متناسقة.
 *  - Orbitron لكلمة HADER وحدها — هندسي عريض يطابق روح اللوجو، ولا يُستخدم لغيرها.
 */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-mark",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "حاضر — موظف ذكاء اصطناعي يرد على عملائك ٢٤/٧",
    template: "%s — حاضر",
  },
  description:
    "حاضر يرد على عملاء متجرك في واتساب وماسنجر وانستقرام بمعرفة بزنسك أنت: الأسعار، المخزون، السياسات. بلا اختراع، وبتحويل ذكي لموظف عند الحاجة.",
  applicationName: "HADER",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} ${orbitron.variable}`}>
      <body>
        <div className="bg-fx" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
