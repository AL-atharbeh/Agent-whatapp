import { requireOwnTenant } from "@/lib/session";
import SettingsForm from "@/app/admin/[slug]/settings/form";

export const dynamic = "force-dynamic";

/**
 * بيانات المتجر — نفس نموذج لوحة الإدارة، بوضع portal يخفي إعدادات المنصة.
 * الـ slug يأتي من الجلسة لا من الرابط، فالوصول لمتجر آخر مستحيل.
 */
export default async function Business() {
  const { tenant } = await requireOwnTenant();
  return (
    <>
      <h1>بيانات متجرك</h1>
      <p className="sub">كل ما تكتبه هنا يصبح معرفة وكيلك فوراً.</p>
      <SettingsForm slug={tenant.slug} portal />
    </>
  );
}
