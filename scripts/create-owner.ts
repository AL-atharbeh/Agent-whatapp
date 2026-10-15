import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";
import { hashPassword, isValidEmail } from "../src/lib/auth";
import { askNewPassword, toAscii } from "./prompt";

/**
 * ينشئ حساب دخول لصاحب متجر (TENANT_OWNER).
 *
 *   npm run owner
 *
 * المتجر يعمل بلا حساب — الرسائل تصل والوكيل يرد — فيسهل أن يُطلَق متجر
 * ولا ينتبه أحد أن صاحبه لا يملك باباً يدخل منه. يراسلنا ليسأل عن محادثة،
 * فنفتحها نحن بدلاً عنه، وتصير اللوحة التي بُنيت له لوحةً نشغّلها عنه.
 *
 * و`tenantId` هنا ليس حقلاً إدارياً: عليه يقوم العزل كله. حساب صاحب متجر
 * بلا متجر يرى لا شيء، وحساب بمتجر خاطئ يرى متجر غيره — فنربطه هنا
 * باختيار صريح من قائمة، لا بكتابة معرّف يُخطَأ فيه حرف.
 */

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const close = () => rl.close();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      _count: { select: { users: true } },
    },
  });

  if (tenants.length === 0) {
    console.error("\n⚠️  لا يوجد متاجر — أنشئ متجراً من اللوحة أولاً\n");
    close();
    return;
  }

  console.log("\nالمتاجر:");
  tenants.forEach((t, i) => {
    const owners = t._count.users;
    console.log(
      `  ${i + 1}) ${t.name}  (${t.slug})  —  ` +
        (owners ? `${owners} حساب` : "⚠️  بلا حساب دخول"),
    );
  });

  const pick = (await rl.question("\nاكتب رقم المتجر من القائمة فوق: ")).trim();
  const idx = Number(toAscii(pick));
  const tenant =
    Number.isInteger(idx) && idx >= 1 && idx <= tenants.length
      ? tenants[idx - 1]
      : tenants.find((t) => t.slug.toLowerCase() === pick.toLowerCase());

  if (!tenant) {
    console.error("\n❌ اختيار غير صالح — لم يُنشأ شيء\n");
    close();
    return;
  }

  const email = (await rl.question("البريد الإلكتروني للدخول: ")).trim().toLowerCase();
  if (!isValidEmail(email)) {
    console.error("\n❌ بريد غير صالح — لم يُنشأ شيء\n");
    close();
    return;
  }

  // البريد مفتاح فريد على مستوى المنصة كلها، لا داخل المتجر
  const taken = await prisma.user.findUnique({
    where: { email },
    select: { role: true, tenant: { select: { name: true } } },
  });
  if (taken) {
    const where =
      taken.role === "PLATFORM_ADMIN" ? "مالك المنصة" : `متجر ${taken.tenant?.name}`;
    console.error(`\n❌ البريد مسجَّل مسبقاً (${where}) — لم يُنشأ شيء`);
    console.error("   لتغيير كلمة سره: npm run password\n");
    close();
    return;
  }

  const name = (await rl.question("اسم صاحب الحساب: ")).trim() || null;
  close();

  console.log(`\nحساب جديد لـ ${tenant.name}. الكتابة مخفيّة وتظهر كنجوم.\n`);
  const password = await askNewPassword();
  if (!password) {
    console.error("\n❌ محاولات كثيرة — لم يُنشأ شيء\n");
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "TENANT_OWNER",
      tenantId: tenant.id,
    },
  });

  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  console.log(`\n✅ أُنشئ حساب ${email} لمتجر ${tenant.name}`);
  console.log(`   الدخول: ${base}/login`);
  console.log(`   يرى متجره وحده — لا متاجر غيره ولا إعدادات المنصة.\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
