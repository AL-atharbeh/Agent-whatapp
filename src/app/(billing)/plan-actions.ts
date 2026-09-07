"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/** إدارة الباقات — مالك المنصة وحده. */

const s = (v: FormDataEntryValue | null) => v?.toString().trim() || null;
const n = (v: FormDataEntryValue | null, d: number) => {
  const x = Number(s(v));
  return Number.isFinite(x) ? x : d;
};

function readPlan(formData: FormData) {
  const name = s(formData.get("name"));
  if (!name) throw new Error("اسم الباقة مطلوب");

  return {
    name,
    tagline: s(formData.get("tagline")),
    monthlyPrice: n(formData.get("monthlyPrice"), 0),
    channels: formData.getAll("channels").map(String),
    maxRepliesPerDay: n(formData.get("maxRepliesPerDay"), 200),
    maxProducts: n(formData.get("maxProducts"), 500),
    modelId: s(formData.get("modelId")) ?? "claude-sonnet-5",
    effort: s(formData.get("effort")) ?? "low",
    // ميزة لكل سطر — أسهل للكتابة من JSON
    features: (s(formData.get("features")) ?? "")
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean),
    highlight: formData.get("highlight") === "on",
    active: formData.get("active") === "on",
    sortOrder: n(formData.get("sortOrder"), 0),
  };
}

export async function savePlan(formData: FormData) {
  await requireAdmin();

  const id = s(formData.get("id"));
  const data = readPlan(formData);

  if (id) {
    await prisma.plan.update({ where: { id }, data });
  } else {
    const tier = s(formData.get("tier"));
    if (!tier || !/^[A-Z0-9_]{2,20}$/.test(tier)) {
      throw new Error("المعرّف يجب أن يكون حروفاً إنجليزية كبيرة وأرقاماً وشرطة سفلية");
    }
    if (await prisma.plan.findUnique({ where: { tier }, select: { id: true } })) {
      throw new Error("هذا المعرّف مستخدم من قبل");
    }
    await prisma.plan.create({ data: { tier, ...data } });
  }

  revalidatePath("/admin/plans");
  revalidatePath("/app/subscription");
}

export async function deletePlan(formData: FormData) {
  await requireAdmin();

  const id = s(formData.get("id"))!;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id } });

  // حذف باقة لها مشتركون يترك متاجرهم بلا حدود معروفة — نعطّلها بدل الحذف
  const subscribers = await prisma.tenant.count({ where: { plan: plan.tier } });
  if (subscribers > 0) {
    throw new Error(
      `لا يمكن حذف باقة عليها ${subscribers} مشترك. عطّلها بدل ذلك — تختفي من صفحة الباقات ويبقى المشتركون عليها.`,
    );
  }

  await prisma.plan.delete({ where: { id } });
  revalidatePath("/admin/plans");
}

/** يطبّق حدود الباقة على كل متاجرها — بعد تعديل الحدود. */
export async function syncPlanToTenants(formData: FormData) {
  await requireAdmin();

  const id = s(formData.get("id"))!;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id } });

  const { count } = await prisma.tenant.updateMany({
    where: { plan: plan.tier, subscription: "ACTIVE" },
    data: {
      maxRepliesPerDay: plan.maxRepliesPerDay,
      modelId: plan.modelId,
      effort: plan.effort,
    },
  });

  console.log(`[plans] طُبّقت حدود ${plan.tier} على ${count} متجر`);
  revalidatePath("/admin/plans");
}
