import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { askNewPassword, toAscii } from "./prompt";

/**
 * يعيد تعيين كلمة سر أي حساب — مالك منصة أو صاحب متجر.
 *
 *   npm run password
 *
 * كلمات السر مخزَّنة كهاش PBKDF2 باتجاه واحد، فالقديمة غير قابلة للقراءة؛
 * المتاح هو الاستبدال فقط.
 */

const MIN = 8;

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    console.error("\n⚠️  لا يوجد حسابات — أنشئ حساباً بـ: npm run admin\n");
    return;
  }

  console.log("\nالحسابات المسجّلة:");
  users.forEach((u, i) => {
    const role =
      u.role === "PLATFORM_ADMIN" ? "مالك المنصة" : `متجر: ${u.tenant?.name ?? "—"}`;
    console.log(`  ${i + 1}) ${u.email}  —  ${role}`);
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const pick = (await rl.question("\nاكتب رقم الحساب من القائمة فوق: ")).trim();
  rl.close();

  const idx = Number(toAscii(pick));
  const user =
    Number.isInteger(idx) && idx >= 1 && idx <= users.length
      ? users[idx - 1]
      : users.find((u) => u.email.toLowerCase() === pick.toLowerCase());

  if (!user) {
    console.error("\n❌ اختيار غير صالح — لم يتغيّر شيء\n");
    return;
  }

  console.log(`\nتغيير كلمة سر: ${user.email}`);
  console.log(`الشرط: ${MIN} أحرف فأكثر. الكتابة مخفيّة وتظهر كنجوم.\n`);

  const password = await askNewPassword(MIN);
  if (!password) {
    console.error("\n❌ محاولات كثيرة — لم يتغيّر شيء\n");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`\n✅ تغيّرت كلمة سر ${user.email}`);
  console.log(`   سجّل الدخول: ${process.env.APP_BASE_URL ?? "http://localhost:3000"}/login\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
