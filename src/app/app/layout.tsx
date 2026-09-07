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
        {tenant.subscription !== "ACTIVE" && (
          <div className="alert warn">
            {tenant.subscription === "REQUESTED" ? (
              <>
                <strong>طلبك قيد المراجعة ⏳</strong> — سنتواصل معك لتأكيد الدفع، ثم يبدأ
                وكيلك بالرد على قنواتك. جهّز كتالوجك الآن حتى يكون جاهزاً لحظة التفعيل.
              </>
            ) : (
              <>
                <strong>متجرك بلا اشتراك بعد.</strong> جهّز بياناتك وكتالوجك، جرّب وكيلك
                مجاناً من «تجربة الوكيل» — ولما ترضى، اختر باقتك.
                <div style={{ marginTop: 10 }}>
                  <Link className="btn" href="/app/subscription">
                    شوف الباقات
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        <PortalTabs />
        {children}
      </main>
    </>
  );
}
