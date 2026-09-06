import { prisma } from "../src/lib/db";
import { buildSystemPrompt } from "../src/lib/agent/prompt";
import { loadTenantBySlug } from "../src/lib/tenancy";

/**
 * يعرض بالضبط من أين يستمد وكيل عميل معيّن معلوماته.
 *   npx tsx --env-file=.env scripts/show-source.ts azyaa
 *   npx tsx --env-file=.env scripts/show-source.ts azyaa --prompt   (لعرض التعليمات كاملة)
 */

const slug = process.argv[2] ?? "azyaa";
const showPrompt = process.argv.includes("--prompt");

async function main() {
  const tenant = await loadTenantBySlug(slug);
  if (!tenant) {
    console.error(`لا يوجد عميل بالمعرّف "${slug}"`);
    return;
  }

  const products = await prisma.product.findMany({ where: { tenantId: tenant.id } });
  const p = tenant.profile;
  const f = (v: string | null | undefined) => v ?? "❌ فارغ — لذلك الوكيل يقول إنه لا يملكها";

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${tenant.name}  (${slug})`);
  console.log(`${"═".repeat(64)}`);

  console.log("\n【 ملف البزنس 】 يُحقن في تعليمات النظام — جدول BusinessProfile\n");
  console.log("  العنوان     :", f(p?.address));
  console.log("  الهاتف      :", f(p?.phone));
  console.log("  الموقع      :", f(p?.websiteUrl));
  console.log("  الدوام      :", f(p?.workingHours));
  console.log("  التوصيل     :", f(p?.deliveryPolicy));
  console.log("  الاسترجاع   :", f(p?.returnPolicy));
  console.log("  الدفع       :", f(p?.paymentMethods));

  console.log("\n【 الكتالوج 】 تجيبه أداة search_catalog — جدول Product\n");
  for (const x of products) {
    console.log(
      `  • ${x.name} — ${x.price ?? "بلا سعر"} ${tenant.currency} — ` +
        `${x.inStock ? "متوفر" : "غير متوفر"}`,
    );
  }

  console.log("\n【 الأسئلة الشائعة 】 تُحقن في التعليمات — جدول Faq\n");
  if (tenant.faqs.length === 0) console.log("  (لا يوجد)");
  for (const x of tenant.faqs) console.log(`  • ${x.question}`);

  console.log("\n【 مصادر البيانات الحيّة 】 تجيبها أداة get_live_data — جدول DataSource\n");
  if (tenant.dataSources.length === 0) console.log("  (لا يوجد)");
  for (const x of tenant.dataSources) {
    console.log(`  • ${x.key}: ${JSON.stringify(x.value)}  (آخر تحديث: ${x.valueAt})`);
  }

  if (showPrompt) {
    console.log(`\n${"═".repeat(64)}`);
    console.log("  التعليمات الكاملة المُرسلة للنموذج:");
    console.log(`${"═".repeat(64)}\n`);
    console.log(buildSystemPrompt(tenant));
  } else {
    console.log("\n(أضف --prompt لعرض التعليمات الكاملة التي يقرأها النموذج)\n");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
