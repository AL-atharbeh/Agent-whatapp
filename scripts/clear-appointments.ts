import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";

/**
 * يمسح مواعيد متجر وعملاءه — بعد التجربة وقبل أن يستلمه صاحبه.
 *
 *   npm run clear:appointments -- <slug>
 *
 * الخدمات والفريق والإعدادات والمحادثات تبقى. نسخة احتياطية تُكتب أولاً في
 * backups/ (خارج git)، فخطأ في اختيار المتجر يُصلَح ولا يُفقَد.
 */

async function main() {
  const slug = process.argv[2];
  if (!slug) return console.error("الاستعمال: npm run clear:appointments -- <slug>");
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!t) return console.error(`❌ لا متجر بالمعرّف ${slug}`);

  const [appointments, customers, contacts] = await Promise.all([
    prisma.appointment.findMany({ where: { tenantId: t.id } }),
    prisma.customer.findMany({ where: { tenantId: t.id } }),
    prisma.customerContact.findMany({ where: { tenantId: t.id } }),
  ]);
  console.log(`\n${t.name}: ${appointments.length} موعد · ${customers.length} عميل`);
  for (const c of customers) console.log(`  • ${c.name ?? "بلا اسم"} ${c.phone ?? ""}`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ok = (await rl.question(`\nللمسح اكتب معرّف المتجر (${slug}): `)).trim();
  rl.close();
  if (ok !== slug) return console.error("\n❌ لم يُمسح شيء\n");

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}-appointments-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ appointments, customers, contacts }, null, 1));

  // المواعيد أولاً: العميل محميّ من الحذف ما دام له موعد (Restrict)
  const [a, , c] = await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { tenantId: t.id } }),
    prisma.customerContact.deleteMany({ where: { tenantId: t.id } }),
    prisma.customer.deleteMany({ where: { tenantId: t.id } }),
  ]);
  console.log(`\n✅ مُسح ${a.count} موعد و ${c.count} عميل`);
  console.log(`   النسخة الاحتياطية: ${path.relative(process.cwd(), file)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
