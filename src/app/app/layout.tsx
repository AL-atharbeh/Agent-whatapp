import Link from "next/link";
import { requireOwnTenant } from "@/lib/session";
import { logout } from "../(auth)/actions";
import PortalTabs from "./tabs";

export const dynamic = "force-dynamic";

/**
 * بوابة العميل.
 *
 * لا تستقبل tenantSlug من الرابط إطلاقاً — المتجر يُشتق من الجلسة الموقّعة.
 * هذا يجعل الوصول لمتجر آخر مستحيلاً بتغيير الرابط.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireOwnTenant();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/app" className="brand">
            <span className="brand-mark">و</span>
            وكيل
          </Link>
          <div className="topbar-actions">
            <span>{tenant.name}</span>
            <form action={logout}>
              <button type="submit" className="ghost" style={{ padding: "5px 12px" }}>
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="wide">
        {tenant.status !== "ACTIVE" && (
          <div className="alert warn">
            <strong>متجرك قيد التفعيل.</strong> جهّز بياناتك وكتالوجك الآن — وسنفعّل الوكيل
            على قنواتك بعد تأكيد الاشتراك. تقدر تجرّبه في «التجربة» قبل التفعيل.
          </div>
        )}

        <PortalTabs />
        {children}
      </main>
    </>
  );
}
