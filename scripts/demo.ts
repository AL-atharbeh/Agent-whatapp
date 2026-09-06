import { chatOnce } from "../src/lib/pipeline";
import { prisma } from "../src/lib/db";

/**
 * عرض حيّ: نفس المحرك يخدم بزنسين مختلفين تماماً، وكل واحد لا يعرف الآخر.
 * شغّله بـ: npx tsx --env-file=.env scripts/demo.ts
 */

const SCRIPT: { slug: string; label: string; turns: string[] }[] = [
  {
    slug: "dhahab",
    label: "🏅 مجوهرات الأثري (محل ذهب)",
    turns: [
      "مرحبا، كم سعر جرام الذهب اليوم؟",
      "بدي خاتم عيار 21، كم بكلفني؟",
      "بدي خصم 20 دينار عليه",
    ],
  },
  {
    slug: "azyaa",
    label: "👗 أزياء لمار (محل ملابس)",
    turns: [
      "السلام عليكم، عندكم فستان ازرق؟",
      "متوفر مقاس M؟ وكم التوصيل لإربد؟",
      "طيب كم سعر جرام الذهب عندكم اليوم؟",
    ],
  },
];

async function main() {
  for (const block of SCRIPT) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: block.slug } });
    if (!tenant) continue;

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${block.label}`);
    console.log(`${"═".repeat(70)}\n`);

    const sessionId = `demo-${block.slug}-${Date.now()}`;

    for (const text of block.turns) {
      console.log(`👤 العميل: ${text}`);
      const t0 = Date.now();
      const res = await chatOnce({ tenantSlug: block.slug, sessionId, text });

      if ("error" in res) {
        console.log(`❌ ${res.error}\n`);
        continue;
      }

      console.log(`🤖 ${tenant.agentName}: ${res.reply}`);

      const calls = res.toolCalls as { name: string; summary: string }[];
      if (calls.length) {
        console.log(`   ⚙️  ${calls.map((c) => `${c.name} → ${c.summary}`).join(" | ")}`);
      }
      const u = res.usage as Record<string, number>;
      console.log(
        `   📊 ${res.provider} · ${Date.now() - t0}ms · ` +
          `إدخال ${u.input_tokens} · إخراج ${u.output_tokens}\n`,
      );
    }
  }

  console.log(`${"═".repeat(70)}`);
  console.log("  لاحظ: السؤال الأخير في كل بزنس مقصود —");
  console.log("  محل الذهب رُفض طلب الخصم، ومحل الملابس لا يعرف شيئاً عن الذهب.");
  console.log(`${"═".repeat(70)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
