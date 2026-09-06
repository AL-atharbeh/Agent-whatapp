import { prisma } from "../src/lib/db";
import { tenantScope } from "../src/lib/tenancy";

/** إثبات عملي أن نطاق كل عميل لا يرى إلا بياناته. */

async function main() {
  const gold = await prisma.tenant.findUniqueOrThrow({ where: { slug: "dhahab" } });
  const clothes = await prisma.tenant.findUniqueOrThrow({ where: { slug: "azyaa" } });
  const rest = await prisma.tenant.findUniqueOrThrow({ where: { slug: "shawaya" } });

  const cases: [string, string, string][] = [
    // [اسم العميل, slug, ما نبحث عنه من بيانات عميل آخر]
    ["مجوهرات الأثري", gold.id, "فستان"],
    ["أزياء لمار", clothes.id, "خاتم ذهب"],
    ["مشاوي أبو سامر", rest.id, "عباية"],
  ];

  console.log("\n═══ اختبار التسريب بين العملاء ═══\n");

  let leaks = 0;
  for (const [name, id, foreignQuery] of cases) {
    const scope = tenantScope(id);
    const own = await scope.searchProducts("");
    const foreign = await scope.searchProducts(foreignQuery);

    const leaked = foreign.length > 0;
    if (leaked) leaks++;

    console.log(`${name}`);
    console.log(`  منتجاته الخاصة: ${own.length}`);
    console.log(
      `  بحث عن "${foreignQuery}" (منتج عميل آخر): ${foreign.length} نتيجة ` +
        `${leaked ? "❌ تسريب!" : "✅ صفر — لا تسريب"}`,
    );
    console.log();
  }

  // اختبار ثانٍ: محاولة قراءة منتج عميل آخر بمعرّفه الصريح
  const clothesProduct = await prisma.product.findFirstOrThrow({
    where: { tenantId: clothes.id },
  });
  const stolen = await tenantScope(gold.id).getProduct(clothesProduct.id);
  console.log("محاولة قراءة منتج «أزياء لمار» بمعرّفه المباشر من نطاق محل الذهب:");
  console.log(`  النتيجة: ${stolen === null ? "null ✅ مرفوض" : "❌ تسرّب!"}`);
  if (stolen) leaks++;

  // اختبار ثالث: المحادثات
  const goldConvos = await prisma.conversation.count({ where: { tenantId: gold.id } });
  const allConvos = await prisma.conversation.count();
  console.log(`\nالمحادثات: محل الذهب يرى ${goldConvos} من أصل ${allConvos} في المنصة.`);

  console.log(
    `\n═══ النتيجة: ${leaks === 0 ? "✅ صفر تسريبات" : `❌ ${leaks} تسريب`} ═══\n`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
