import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto";

/**
 * يشخّص ويصلح سبب عدم وصول رسائل واتساب الواردة.
 *
 * ضبط الويبهوك في لوحة التطبيق لا يكفي: يجب أيضاً **اشتراك التطبيق في حساب
 * واتساب التجاري (WABA)** عبر POST /{waba-id}/subscribed_apps. غياب هذا
 * الاشتراك هو السبب الكلاسيكي لأن يعمل الإرسال بينما لا يصل شيء.
 *
 *   npx tsx --env-file=.env scripts/fix-waba-subscription.ts <slug> [waba_id]
 */

const slug = process.argv[2] ?? "shahad";
const WABA = process.argv[3] ?? "4140770986215477";
const V = "v21.0";

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  const acc = await prisma.channelAccount.findFirstOrThrow({
    where: { tenantId: tenant.id, channel: "WHATSAPP" },
  });
  if (!acc.accessTokenEnc) return console.error("❌ لا يوجد Access Token محفوظ في اللوحة");

  const token = decrypt(acc.accessTokenEnc);
  const auth = { Authorization: `Bearer ${token}` };

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`https://graph.facebook.com/${V}/${path}`, {
      ...init,
      headers: { ...auth, ...(init?.headers ?? {}) },
    });
    return { status: res.status, body: await res.json() };
  };

  // ── ١) صلاحية التوكن ──
  console.log("\n═══ ١) التوكن ═══");
  const me = await call(
    `${acc.externalId}?fields=display_phone_number,verified_name,quality_rating`,
  );
  if (me.body.error) {
    console.error("❌", me.body.error.message);
    console.error("\n→ ولّد رمزاً جديداً واحفظه في اللوحة، ثم أعد تشغيل هذا السكربت.\n");
    return;
  }
  console.log("✅ صالح —", JSON.stringify(me.body));

  // ── ٢) اشتراك التطبيق في WABA ──
  console.log("\n═══ ٢) اشتراك التطبيق في حساب واتساب التجاري ═══");
  const subs = await call(`${WABA}/subscribed_apps`);
  const list = (subs.body.data ?? []) as { whatsapp_business_api_data?: { name?: string } }[];

  if (subs.body.error) {
    console.error("⚠️", subs.body.error.message);
  } else {
    console.log(
      list.length
        ? `المشتركون حالياً: ${list.map((a) => a.whatsapp_business_api_data?.name ?? "?").join(", ")}`
        : "لا يوجد أي تطبيق مشترك",
    );
  }

  // الاشتراك يتم دائماً: وجود تطبيق آخر مشترك (مثل تطبيق لوحة Meta الداخلي)
  // لا يعني أن تطبيقنا مشترك — والاشتراك لكل تطبيق على حدة.
  console.log("\n   جارٍ اشتراك تطبيقك (Shifra integration)...");
  const fix = await call(`${WABA}/subscribed_apps`, { method: "POST" });
  console.log(
    fix.body.success
      ? "   ✅ تم الاشتراك بنجاح — الرسائل الواردة ستصل لموقعك الآن"
      : `   ❌ فشل: ${JSON.stringify(fix.body)}`,
  );

  const after = await call(`${WABA}/subscribed_apps`);
  const names = ((after.body.data ?? []) as { whatsapp_business_api_data?: { name?: string } }[])
    .map((a) => a.whatsapp_business_api_data?.name ?? "?")
    .join(", ");
  console.log(`   المشتركون بعد الإصلاح: ${names}`);

  // ── ٣) عنوان الويبهوك المسجّل عند Meta ──
  console.log("\n═══ ٣) إعدادات الويبهوك عند Meta ═══");
  const wh = await call(`${WABA}?fields=id,name,message_template_namespace`);
  console.log(JSON.stringify(wh.body).slice(0, 300));

  console.log("\n═══ الخطوة التالية ═══");
  console.log("أرسل رسالة واتساب للرقم التجريبي، ثم افحص وصولها بـ:");
  console.log("  npx tsx --env-file=.env scripts/simulate-webhook.ts --check\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
