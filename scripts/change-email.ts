import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";
import { isValidEmail } from "../src/lib/auth";
import { toAscii } from "./prompt";

/**
 * يغيّر إيميل الدخول لحساب — حين يُسلَّم متجر جرّبناه نحن لصاحبه.
 *
 *   npm run email
 *
 * يُخرج أجهزة الجوال المسجّلة بالإيميل القديم: الحساب صار لشخص آخر، وجوال
 * من جرّبه قبله يجب ألّا يبقى يقرأ محادثات المتجر.
 */

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log("\nالحسابات المسجّلة:");
  users.forEach((u, i) => {
    const role = u.role === "PLATFORM_ADMIN" ? "مالك المنصة" : `متجر: ${u.tenant?.name ?? "—"}`;
    console.log(`  ${i + 1}) ${u.email}  —  ${role}`);
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const pick = (await rl.question("\nاكتب رقم الحساب من القائمة فوق: ")).trim();
    const idx = Number(toAscii(pick));
    const user = Number.isInteger(idx) && idx >= 1 && idx <= users.length ? users[idx - 1] : null;
    if (!user) return console.error("\n❌ اختيار غير صالح — لم يتغيّر شيء\n");

    const email = (await rl.question(`الإيميل الجديد بدل ${user.email}: `)).trim().toLowerCase();
    if (!isValidEmail(email)) return console.error("\n❌ إيميل غير صالح — لم يتغيّر شيء\n");
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return console.error("\n❌ هذا الإيميل مسجّل لحساب آخر — لم يتغيّر شيء\n");
    }

    const [, revoked] = await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { email } }),
      prisma.deviceSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), pushToken: null },
      }),
    ]);
    console.log(`\n✅ ${user.email} ← ${email}`);
    console.log(`   أُخرج ${revoked.count} جهاز جوال — يلزمه دخول بالإيميل الجديد`);
    console.log("   الآن غيّر كلمة السر: npm run password\n");
  } finally {
    rl.close();
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
