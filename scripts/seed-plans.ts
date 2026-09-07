import { prisma } from "../src/lib/db";

/** يبذر الباقات الافتراضية الثلاث. آمن للتكرار — لا يمس باقة موجودة. */

const PLANS = [
  {
    tier: "STARTER", name: "البداية", tagline: "لمحل واحد يبدأ على الواتساب",
    monthlyPrice: 25, channels: ["WHATSAPP", "WEB"],
    maxRepliesPerDay: 100, maxProducts: 100,
    modelId: "claude-haiku-4-5", effort: "low", sortOrder: 1, highlight: false,
    features: ["قناة واتساب", "١٠٠ رد يومياً", "١٠٠ منتج في الكتالوج",
      "أسئلة شائعة غير محدودة", "تحويل تلقائي لموظف", "سجل محادثات كامل"],
  },
  {
    tier: "GROWTH", name: "النمو", tagline: "لمحل يبيع على كل القنوات",
    monthlyPrice: 55, channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    maxRepliesPerDay: 400, maxProducts: 1000,
    modelId: "claude-sonnet-5", effort: "low", sortOrder: 2, highlight: true,
    features: ["واتساب + ماسنجر + انستقرام", "٤٠٠ رد يومياً", "١٠٠٠ منتج",
      "أسعار حيّة (سعر الذهب مثلاً)", "التقاط العملاء المحتملين", "ردود أدق وأسرع"],
  },
  {
    tier: "BUSINESS", name: "الأعمال", tagline: "لحجم عالٍ وردود بأعلى جودة",
    monthlyPrice: 120, channels: ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"],
    maxRepliesPerDay: 2000, maxProducts: 100000,
    modelId: "claude-opus-5", effort: "medium", sortOrder: 3, highlight: false,
    features: ["كل قنوات باقة النمو", "٢٠٠٠ رد يومياً", "منتجات بلا حد",
      "أعلى جودة ردود متاحة", "تعليمات مخصصة موسّعة", "دعم بأولوية"],
  },
];

async function main() {
  for (const p of PLANS) {
    const existing = await prisma.plan.findUnique({ where: { tier: p.tier } });
    if (existing) { console.log(`  ⏭  ${p.name} موجودة — تُركت كما هي`); continue; }
    await prisma.plan.create({ data: p });
    console.log(`  ✅ ${p.name} — ${p.monthlyPrice} د/شهر`);
  }
  console.log(`\nعدّلها من: /admin/plans\n`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
