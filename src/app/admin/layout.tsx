import Link from "next/link";
import { requireAdmin, currentUser } from "@/lib/session";
import { logout } from "../(auth)/actions";
import { Logo } from "@/components/brand";
import { SubmitButton } from "@/components/pending";
import { Footer } from "@/components/footer";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const user = await currentUser();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/admin" className="logo">
            <Logo size={30} />
            <span className="pill">المنصة</span>
          </Link>
          <div className="topbar-actions">
            <Link href="/admin/plans">الباقات</Link>
            <span style={{ color: "var(--text-3)" }}>{user?.email}</span>
            <form action={logout}>
              <SubmitButton className="ghost" style={{ padding: "6px 14px" }}>
                خروج
              </SubmitButton>
            </form>
          </div>
        </div>
      </header>
      {children}
      <Footer />
    </>
  );
}
