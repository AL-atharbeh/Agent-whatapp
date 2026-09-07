import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";
import { hashPassword, isValidEmail } from "../src/lib/auth";

/**
 * ينشئ حساب مالك المنصة (PLATFORM_ADMIN) — أو يربط الحسابات القائمة بمتاجرها.
 *
 *   npx tsx --env-file=.env scripts/create-admin.ts
 */

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  const existing = await prisma.user.count({ where: { role: "PLATFORM_ADMIN" } });
  if (existing > 0) {
    const admins = await prisma.user.findMany({
      where: { role: "PLATFORM_ADMIN" },
      select: { email: true },
    });
    console.log(`\nيوجد ${existing} حساب مالك منصة: ${admins.map((a) => a.email).join(", ")}`);
    const more = (await rl.question("أنشئ حساباً إضافياً؟ (y/N) ")).trim().toLowerCase();
    if (more !== "y") {
      rl.close();
      return;
    }
  }

  const email = (await rl.question("البريد الإلكتروني: ")).trim().toLowerCase();
  if (!isValidEmail(email)) {
    console.error("بريد غير صالح");
    rl.close();
    return;
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    console.error("هذا البريد مسجَّل مسبقاً");
    rl.close();
    return;
  }

  const name = (await rl.question("الاسم: ")).trim() || "المالك";
  const password = (await rl.question("كلمة السر (٨ أحرف على الأقل): ")).trim();
  rl.close();

  if (password.length < 8) {
    console.error("كلمة السر قصيرة جداً");
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "PLATFORM_ADMIN",
    },
  });

  console.log(`\n✅ أُنشئ حساب مالك المنصة: ${email}`);
  console.log("   سجّل الدخول من /login\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
