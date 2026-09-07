import type { Channel } from "@prisma/client";
import { prisma } from "./db";

/**
 * الباقات — تُقرأ من قاعدة البيانات ويديرها مالك المنصة من /admin/plans.
 *
 * كانت ثوابت في الكود، فكان تغيير سعر يتطلب نشراً جديداً. الآن تعديلها فوري.
 * الحدود المخزّنة هنا تُطبَّق فعلياً في pipeline ووقت التفعيل.
 */

export type Plan = {
  tier: string;
  name: string;
  tagline: string | null;
  monthlyPrice: number;
  channels: Channel[];
  maxRepliesPerDay: number;
  maxProducts: number;
  modelId: string;
  effort: string;
  features: string[];
  highlight: boolean;
  active: boolean;
  sortOrder: number;
};

type Row = Awaited<ReturnType<typeof prisma.plan.findMany>>[number];

const toPlan = (p: Row): Plan => ({
  tier: p.tier,
  name: p.name,
  tagline: p.tagline,
  monthlyPrice: Number(p.monthlyPrice),
  channels: p.channels as Channel[],
  maxRepliesPerDay: p.maxRepliesPerDay,
  maxProducts: p.maxProducts,
  modelId: p.modelId,
  effort: p.effort,
  features: p.features,
  highlight: p.highlight,
  active: p.active,
  sortOrder: p.sortOrder,
});

/** الباقات المعروضة للعملاء. */
export async function listPlans(includeInactive = false): Promise<Plan[]> {
  const rows = await prisma.plan.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { monthlyPrice: "asc" }],
  });
  return rows.map(toPlan);
}

export async function getPlan(tier: string | null | undefined): Promise<Plan | null> {
  if (!tier) return null;
  const row = await prisma.plan.findUnique({ where: { tier } });
  return row ? toPlan(row) : null;
}

/** هل تسمح باقة العميل بهذه القناة؟ بلا باقة: التجربة فقط. */
export async function planAllowsChannel(
  tier: string | null | undefined,
  channel: Channel,
): Promise<boolean> {
  if (!tier) return channel === "WEB";
  const plan = await getPlan(tier);
  if (!plan) return channel === "WEB";
  return plan.channels.includes(channel);
}

export const SUBSCRIPTION_LABEL: Record<string, { label: string; cls: string }> = {
  NONE: { label: "بلا اشتراك", cls: "" },
  REQUESTED: { label: "طلب اشتراك", cls: "warn" },
  ACTIVE: { label: "اشتراك نشط", cls: "ok" },
  EXPIRED: { label: "منتهٍ", cls: "danger" },
  CANCELLED: { label: "ملغى", cls: "danger" },
};

export const ALL_CHANNELS: { value: Channel; label: string }[] = [
  { value: "WHATSAPP", label: "واتساب" },
  { value: "MESSENGER", label: "ماسنجر" },
  { value: "INSTAGRAM", label: "انستقرام" },
  { value: "WEB", label: "التجربة (الويب)" },
];

export const MODELS = [
  { value: "claude-haiku-4-5", label: "Haiku — الأسرع والأوفر" },
  { value: "claude-sonnet-5", label: "Sonnet — متوازن" },
  { value: "claude-opus-5", label: "Opus — أعلى جودة" },
];
