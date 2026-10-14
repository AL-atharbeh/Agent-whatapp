import { prisma } from "../src/lib/db";

/**
 * باقات الإطلاق.
 *
 * السقوف ليست أرقاماً تسويقية: كل سقف محسوب على نقطة التعادل لنموذج تلك
 * الباقة، بحيث يبقى الهامش موجباً حتى لو استنفد العميل باقته بالكامل.
 *
 * كلفة الرد المقاسة (٢٥٠٠ توكن دخل + ٢٠٠ خرج):
 *   Groq   مجاني      ·  Haiku  $0.0035  ·  Sonnet $0.007  ·  Opus $0.0175
 *
 * المكالمات مستبعَدة من الجميع عمداً: كلفتها بالدقيقة لا بالرسالة، ولا يوجد
 * عدّاد دقائق بعد. بيعُها قبل بناء العدّاد هو بيع حدٍّ لا نستطيع فرضه.
 *
 *   npm run seed:plans
 */

const PLANS = [
  {
    tier: "STARTER",
    name: "البداية",
    tagline: "لمحل واحد يبدأ على الواتساب",
    monthlyPrice: 19,
    channels: ["WHATSAPP", "WEB"],
    modelId: "qwen/qwen3.8-27b",
    effort: "low",
    maxRepliesPerDay: 150,
    maxRepliesPerMinute: 15,
    maxProducts: 100,
    sortOrder: 1,
    highlight: false,
    features: [
      "قناة واتساب",
      "١٥٠ رد يومياً",
      "١٠٠ منتج في الكتالوج",
      "يفهم الفويس ويرد عليه",
      "تحويل تلقائي لموظف عند الحاجة",
      "ساحة تجربة قبل التشغيل",
    ],
  },
  {
    tier: "GROWTH",
    name: "النمو",
    tagline: "لمتجر يرد على عملائه في كل مكان",
    monthlyPrice: 49,
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    modelId: "claude-haiku-4-5",
    effort: "low",
    maxRepliesPerDay: 300,
    maxRepliesPerMinute: 30,
    maxProducts: 1000,
    sortOrder: 2,
    highlight: true,
    features: [
      "واتساب وماسنجر وانستقرام",
      "٣٠٠ رد يومياً",
      "١٠٠٠ منتج في الكتالوج",
      "ذكاء Claude — عربية أدق",
      "يفهم الفويس ويرد عليه",
      "أسعار حيّة تتحدّث يومياً",
      "سجل كامل للمحادثات والعملاء المحتملين",
    ],
  },
  {
    tier: "BUSINESS",
    name: "الأعمال",
    tagline: "لمتجر كبير أو عدة فروع",
    monthlyPrice: 99,
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    modelId: "claude-sonnet-5",
    effort: "low",
    maxRepliesPerDay: 400,
    maxRepliesPerMinute: 60,
    maxProducts: 10000,
    sortOrder: 3,
    highlight: false,
    features: [
      "كل القنوات",
      "٤٠٠ رد يومياً",
      "١٠٠٠٠ منتج في الكتالوج",
      "ذكاء Claude Sonnet — الأعلى جودة",
      "يفهم الفويس ويرد عليه",
      "أسعار حيّة ومصادر بيانات خارجية",
      "تعليمات خاصة مفصّلة للوكيل",
      "دعم أولوية",
    ],
  },
];

async function main() {
  for (const p of PLANS) {
    await prisma.plan.upsert({
      where: { tier: p.tier },
      create: { ...p, active: true },
      update: { ...p, active: true },
    });
    console.log(`  ✅ ${p.name.padEnd(8)} ${p.tier.padEnd(9)} ${p.monthlyPrice} د/شهر`);
  }

  console.log("\n═══ التحقق من الهوامش عند السقف الكامل ═══");
  const COST: Record<string, number> = {
    "qwen/qwen3.8-27b": 0,
    "openai/gpt-oss-120b": 0,
    "claude-haiku-4-5": 0.0035,
    "claude-sonnet-5": 0.007,
    "claude-opus-5": 0.0175,
  };
  const USD_TO_JOD = 0.71;

  for (const p of PLANS) {
    const monthlyMax = p.maxRepliesPerDay * 30;
    const costJod = monthlyMax * (COST[p.modelId] ?? 0) * USD_TO_JOD;
    const margin = p.monthlyPrice - costJod;
    const pct = Math.round((margin / p.monthlyPrice) * 100);
    console.log(
      `  ${p.name.padEnd(8)} ${monthlyMax} رد شهرياً · كلفة ${costJod.toFixed(1)} د · ` +
        `هامش ${margin.toFixed(1)} د (${pct}%) ${margin > 0 ? "✅" : "❌ خسارة"}`,
    );
  }

  console.log();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("خطأ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
