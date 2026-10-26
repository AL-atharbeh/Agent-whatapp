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
 * المكالمات في «الأعمال» وحدها: كلفتها بالدقيقة لا بالرسالة، وتُحتسب ردودها
 * من نفس السقف اليومي إلى أن يُبنى عدّاد دقائق.
 *
 *   npm run seed:plans
 */

const PLANS = [
  {
    tier: "STANDARD",
    name: "اساسي",
    tagline: "جرّب وكيلك على الواتساب",
    monthlyPrice: 19,
    channels: ["WHATSAPP"],
    modelId: "qwen/qwen3.8-27b",
    effort: "low",
    maxRepliesPerDay: 169,
    maxRepliesPerMinute: 20,
    maxProducts: 50,
    sortOrder: 1,
    highlight: false,
    features: [
      "قناة واتساب",
      "١٦٩ رد يومياً",
      "٥٠ منتج في الكتالوج",
      "يفهم الفويس ويرد عليه",
      "تحويل تلقائي لموظف عند الحاجة",
    ],
  },
  {
    tier: "GROWTH",
    name: "النمو",
    tagline: "لمتجر يرد على عملائه في كل مكان",
    monthlyPrice: 49,
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    modelId: "claude-haiku-5-5",
    effort: "low",
    maxRepliesPerDay: 300,
    maxRepliesPerMinute: 30,
    maxProducts: 200,
    sortOrder: 2,
    highlight: true,
    features: [
      "واتساب وماسنجر وانستقرام وموقعك",
      "٣٠٠ رد يومياً",
      "٢٠٠ منتج في الكتالوج",
      "ذكاء Claude — عربية أدق",
      "حجز المواعيد وتذكير العملاء تلقائياً",
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
    channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB", "VOICE"],
    modelId: "claude-haiku-5-5",
    effort: "low",
    maxRepliesPerDay: 400,
    maxRepliesPerMinute: 60,
    maxProducts: 500,
    sortOrder: 3,
    highlight: false,
    features: [
      "كل القنوات",
      "يرد على المكالمات الهاتفية بصوت تختاره",
      "٤٠٠ رد يومياً",
      "٥٠٠ منتج في الكتالوج",
      "ذكاء Claude — عربية أدق",
      "حجز المواعيد وتذكير العملاء تلقائياً",
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
    "claude-haiku-5-5": 0.001,
    "claude-sonnet-5-5": 0.012,
    "claude-opus-5-5": 0.024,
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
