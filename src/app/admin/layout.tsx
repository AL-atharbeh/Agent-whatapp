import Link from "next/link";
import { requireAdmin, currentUser } from "@/lib/session";
import { logout } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const user = await currentUser();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/admin" className="brand">
            <span className="brand-mark">و</span>
            وكيل
            <span className="pill" style={{ marginInlineStart: 4 }}>
              لوحة المنصة
            </span>
          </Link>
          <div className="topbar-actions">
            <span>{user?.email}</span>
            <form action={logout}>
              <button type="submit" className="ghost" style={{ padding: "5px 12px" }}>
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
