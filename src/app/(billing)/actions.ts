"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { authorizeTenant, requireAdmin, requireOwnTenant } from "@/lib/session";
import { PLANS, planOf, type PlanTier } from "@/lib/plans";

const s = (v: FormDataEntryValue | null) => v?.toString().trim() || null;

// ═══════════════════════════════════════════════════════════
//  من العميل: طلب باقة
// ═══════════════════════════════════════════════════════════

/**
 * يسجّل رغبة العميل في باقة. **لا يفعّل شيئاً** — التفعيل قرار مالك المنصة
 * بعد تأكيد الدفع. هذا يمنع أن يشغّل أحد الخدمة على حسابك بلا اشتراك.
 */
export async function requestPlan(formData: FormData) {
  const { tenant } = await requireOwnTenant();

  const tier = s(formData.get("plan")) as PlanTier | null;
  if (!tier || !(tier in PLANS)) throw new Error("باقة غير معروفة");

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      requestedPlan: tier,
      requestedAt: new Date(),
      // اشتراك نشط بالفعل ⇒ هذا طلب ترقية، لا نُسقط حالته
      subscription: tenant.subscription === "ACTIVE" ? "ACTIVE" : "REQUESTED",
    },
  });

  revalidatePath("/app/subscription");
  revalidatePath("/admin");
  redirect("/app/subscription?requested=1");
}

// ═══════════════════════════════════════════════════════════
//  من مالك المنصة: التفعيل والإدارة
// ═══════════════════════════════════════════════════════════

/** يفعّل الاشتراك ويطبّق حدود الباقة على المتجر فعلياً. */
export async function activateSubscription(formData: FormData) {
  await requireAdmin();

  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);

  const tier = (s(formData.get("plan")) ?? "") as PlanTier;
  const plan = planOf(tier);
  if (!plan) throw new Error("اختر باقة صالحة");

  const months = Number(s(formData.get("months")) ?? "1") || 1;
  const priceRaw = s(formData.get("monthlyPrice"));
  const monthlyPrice = priceRaw ? Number(priceRaw) : plan.monthlyPrice;

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      plan: tier,
      requestedPlan: null,
      subscription: "ACTIVE",
      status: "ACTIVE", // هنا فقط يبدأ الوكيل بالرد على القنوات
      monthlyPrice,
      activatedAt: new Date(),
      expiresAt,
      billingNote: s(formData.get("billingNote")),

      // حدود الباقة تُطبَّق على المتجر — لا تبقى وعداً تسويقياً
      maxRepliesPerDay: plan.maxRepliesPerDay,
      modelId: plan.modelId,
      effort: plan.effort,
    },
  });

  revalidatePath(`/admin/${slug}`);
  revalidatePath("/admin");
  revalidatePath("/app");
}

/** يوقف الاشتراك — الوكيل يصمت فوراً على كل القنوات. */
export async function suspendSubscription(formData: FormData) {
  await requireAdmin();

  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { subscription: "CANCELLED", status: "PAUSED" },
  });

  revalidatePath(`/admin/${slug}`);
  revalidatePath("/admin");
}

/** يمدّد اشتراكاً قائماً بعدد أشهر. */
export async function extendSubscription(formData: FormData) {
  await requireAdmin();

  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);
  const months = Number(s(formData.get("months")) ?? "1") || 1;

  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { expiresAt: true },
  });

  // نمدّد من تاريخ الانتهاء إن لم يمضِ، وإلا من اليوم
  const base = t.expiresAt && t.expiresAt > new Date() ? new Date(t.expiresAt) : new Date();
  base.setMonth(base.getMonth() + months);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { expiresAt: base, subscription: "ACTIVE", status: "ACTIVE" },
  });

  revalidatePath(`/admin/${slug}`);
  revalidatePath("/admin");
}
