import {
  checkPassword,
  createSession,
  isAuthConfigured,
  verifySession,
} from "../src/lib/auth";

/** اختبار منطق المصادقة. شغّله بـ: npx tsx --env-file=.env scripts/test-auth.ts */

let failed = 0;
function check(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
}

async function main() {
  const pw = process.env.ADMIN_PASSWORD;
  console.log("\n═══ اختبار المصادقة ═══\n");

  check("الإعداد مكتمل", isAuthConfigured(), true);

  console.log("\nكلمة السر:");
  check("الكلمة الصحيحة تُقبل", await checkPassword(pw!), true);
  check("كلمة خاطئة تُرفض", await checkPassword("wrong-password"), false);
  check("كلمة فارغة تُرفض", await checkPassword(""), false);
  check("كلمة قريبة تُرفض", await checkPassword(pw! + "x"), false);

  console.log("\nالجلسة:");
  const session = await createSession();
  check("جلسة صحيحة تُقبل", await verifySession(session.value), true);
  check("توكن فارغ يُرفض", await verifySession(undefined), false);
  check("توكن عشوائي يُرفض", await verifySession("garbage"), false);

  // تلاعب بالتوقيع
  check("توقيع مزوّر يُرفض", await verifySession(session.value.slice(0, -3) + "AAA"), false);

  // تلاعب بتاريخ الانتهاء (تمديد الجلسة بدون توقيع صحيح)
  const [v, exp, sig] = session.value.split(".");
  const tampered = `${v}.${Number(exp) + 999999999}.${sig}`;
  check("تمديد الصلاحية يدوياً يُرفض", await verifySession(tampered), false);

  // جلسة منتهية بتوقيع صحيح — نبنيها بنفس آلية التوقيع
  console.log("\nالانتهاء:");
  const expiredPayload = `v1.${Date.now() - 1000}`;
  const { createHmac } = await import("node:crypto");
  const expiredSig = createHmac("sha256", process.env.ENCRYPTION_KEY!)
    .update(expiredPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  check(
    "جلسة منتهية تُرفض رغم صحة توقيعها",
    await verifySession(`${expiredPayload}.${expiredSig}`),
    false,
  );

  console.log(
    `\n═══ ${failed === 0 ? "✅ كل الاختبارات نجحت" : `❌ فشل ${failed} اختبار`} ═══\n`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
