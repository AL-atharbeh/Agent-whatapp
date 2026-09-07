import { prisma } from "../src/lib/db";
import { decrypt, encrypt } from "../src/lib/crypto";

/**
 * يجلب "رمز الصفحة" (Page Access Token) ويخزّنه لقنوات ماسنجر وانستقرام.
 *
 * ⚠️ فخّ آخر لا تشرحه واجهة Meta: ماسنجر لا يقبل رمز مستخدم النظام مباشرة —
 * يحتاج رمزاً مشتقاً خاصاً بالصفحة، يُجلب من GET /me/accounts. استخدام رمز
 * مستخدم النظام يعطي "Invalid OAuth 2.0 Access Token" بلا تفسير.
 *
 * السكربت يستخرج رمز مستخدم النظام من قناة واتساب المخزّنة، يستبدل به رمز
 * الصفحة، ثم يشترك التطبيق في الصفحة.
 *
 *   npx tsx --env-file=.env scripts/fix-page-token.ts <slug>
 */

const slug = process.argv[2] ?? "shahad";
const V = process.env.META_GRAPH_VERSION ?? "v21.0";

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  const accounts = await prisma.channelAccount.findMany({ where: { tenantId: tenant.id } });

  // رمز مستخدم النظام محفوظ في قناة واتساب — منه نشتق رموز الصفحات
  const source = accounts.find((a) => a.channel === "WHATSAPP" && a.accessTokenEnc);
  if (!source?.accessTokenEnc) {
    return console.error("❌ لا يوجد رمز مستخدم نظام محفوظ في قناة واتساب");
  }
  const systemToken = decrypt(source.accessTokenEnc);

  console.log("\n═══ جلب رموز الصفحات ═══\n");
  const res = await fetch(`https://graph.facebook.com/${V}/me/accounts?access_token=${systemToken}`);
  const body = await res.json();
  if (body.error) return console.error("❌", body.error.message);

  const pages = (body.data ?? []) as { id: string; name: string; access_token: string }[];
  if (pages.length === 0) return console.error("❌ لا توجد صفحات متاحة لهذا الرمز");

  for (const p of pages) console.log(`  وُجدت صفحة: ${p.name} (${p.id})`);

  const targets = accounts.filter((a) => a.channel === "MESSENGER" || a.channel === "INSTAGRAM");
  if (targets.length === 0) return console.log("\nلا توجد قنوات ماسنجر/انستقرام مربوطة.");

  for (const acc of targets) {
    console.log(`\n── ${acc.channel} — ${acc.externalId}`);

    // انستقرام يُدار عبر الصفحة المرتبطة به، فنستخدم رمز الصفحة نفسه
    const page =
      pages.find((p) => p.id === acc.externalId) ?? (pages.length === 1 ? pages[0] : undefined);
    if (!page) {
      console.log("   ⚠️ لم أجد صفحة مطابقة — حدّد الرمز يدوياً");
      continue;
    }

    await prisma.channelAccount.update({
      where: { id: acc.id },
      data: { accessTokenEnc: encrypt(page.access_token) },
    });
    console.log(`   ✅ خُزّن رمز صفحة "${page.name}" (مشفّراً)`);

    // الاشتراك: الحقول تُحدَّد صراحةً للصفحات
    const sub = await fetch(
      `https://graph.facebook.com/${V}/${page.id}/subscribed_apps` +
        `?subscribed_fields=messages,messaging_postbacks&access_token=${page.access_token}`,
      { method: "POST" },
    );
    const subBody = await sub.json();

    if (subBody.success) {
      await prisma.channelAccount.update({
        where: { id: acc.id },
        data: { subscribedAt: new Date() },
      });
      console.log("   ✅ اشترك التطبيق في الصفحة — الرسائل الواردة ستصل الآن");
    } else {
      console.log(`   ❌ فشل الاشتراك: ${subBody.error?.message ?? JSON.stringify(subBody)}`);
    }
  }

  console.log("\n═══ التالي ═══");
  console.log("أرسل رسالة للصفحة من ماسنجر، ثم تحقّق من تبويب المحادثات في اللوحة.\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
