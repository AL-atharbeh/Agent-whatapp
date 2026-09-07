import type { Channel } from "@prisma/client";

/**
 * الباقات — مصدر الحقيقة الوحيد.
 *
 * كل حد هنا يُطبَّق فعلياً في الكود (pipeline و tenancy)، لا مجرد نص تسويقي:
 * تجاوز سقف الرسائل يوقف الرد ويحوّل لموظف، وقناة خارج الباقة لا تُربط أصلاً.
 * تغيير الأسعار أو الحدود يتم من هذا الملف وحده.
 */

export type PlanTier = "STARTER" | "GROWTH" | "BUSINESS";

export type Plan = {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPrice: number; // بالدينار الأردني
  channels: Channel[];
  maxRepliesPerDay: number;
  maxProducts: number;
  modelId: string;
  effort: "low" | "medium" | "high";
  features: string[];
  highlight?: boolean;
};

export const PLANS: Record<PlanTier, Plan> = {
  STARTER: {
    tier: "STARTER",
    name: "البداية",
    tagline: "لمحل واحد يبدأ على الواتساب",
    monthlyPrice: 25,
    channels: ["WHATSAPP", "WEB"],
    maxRepliesPerDay: 100,
    maxProducts: 100,
    modelId: "claude-haiku-4-5",
    effort: "low",
    features: [
      "قناة واتساب",
      "١٠٠ رد يومياً",
      "١٠٠ منتج في الكتالوج",
      "أسئلة شائعة غير محدودة",
      "تحويل تلقائي لموظف",
      "سجل محادثات كامل",
    ],
  },

  GROWTH: {
    tier: "GROWTH",
    name: "النمو",
    tagline: "لمحل يبيع على كل القنوات",
    monthlyPrice: 55,
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    maxRepliesPerDay: 400,
    maxProducts: 1000,
    modelId: "claude-sonnet-5",
    effort: "low",
    features: [
      "واتساب + ماسنجر + انستقرام",
      "٤٠٠ رد يومياً",
      "١٠٠٠ منتج",
      "أسعار حيّة (سعر الذهب مثلاً)",
      "التقاط العملاء المحتملين",
      "ردود أدق وأسرع",
    ],
    highlight: true,
  },

  BUSINESS: {
    tier: "BUSINESS",
    name: "الأعمال",
    tagline: "لحجم عالٍ وردود بأعلى جودة",
    monthlyPrice: 120,
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    maxRepliesPerDay: 2000,
    maxProducts: 100_000,
    modelId: "claude-opus-5",
    effort: "medium",
    features: [
      "كل قنوات باقة النمو",
      "٢٠٠٠ رد يومياً",
      "منتجات بلا حد",
      "أعلى جودة ردود متاحة",
      "تعليمات مخصصة موسّعة",
      "دعم بأولوية",
    ],
  },
};

export const PLAN_LIST = Object.values(PLANS);

export const planOf = (tier: string | null | undefined): Plan | null =>
  tier && tier in PLANS ? PLANS[tier as PlanTier] : null;

/** هل تسمح باقة العميل بهذه القناة؟ */
export function planAllowsChannel(tier: string | null | undefined, channel: Channel): boolean {
  const p = planOf(tier);
  if (!p) return channel === "WEB"; // بلا باقة: التجربة فقط
  return p.channels.includes(channel);
}

export const SUBSCRIPTION_LABEL: Record<string, { label: string; cls: string }> = {
  NONE: { label: "بلا اشتراك", cls: "" },
  REQUESTED: { label: "طلب اشتراك", cls: "warn" },
  ACTIVE: { label: "اشتراك نشط", cls: "ok" },
  EXPIRED: { label: "منتهٍ", cls: "danger" },
  CANCELLED: { label: "ملغى", cls: "danger" },
};
