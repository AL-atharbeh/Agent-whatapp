import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";

/**
 * يفرّغ بيانات التجربة من متجر قبل أن يستلمه صاحبه: المواعيد والعملاء
 * والمحادثات برسائلها والعملاء المحتملين.
 *
 *   npm run clear:data -- <slug>
 *
 * الخدمات والفريق والإعدادات والمنتجات والأسئلة والقنوات تبقى. نسخة احتياطية تُكتب أولاً في
 * backups/ (خارج git)، فخطأ في اختيار المتجر يُصلَح ولا يُفقَد.
 */

async function main() {
  const slug = process.argv[2];
  if (!slug) return console.error("الاستعمال: npm run clear:data -- <slug>");
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!t) return console.error(`❌ لا متجر بالمعرّف ${slug}`);

  const [appointments, customers, contacts, conversations, leads] = await Promise.all([
    prisma.appointment.findMany({ where: { tenantId: t.id } }),
    prisma.customer.findMany({ where: { tenantId: t.id } }),
    prisma.customerContact.findMany({ where: { tenantId: t.id } }),
    prisma.conversation.findMany({ where: { tenantId: t.id }, include: { messages: true } }),
    prisma.lead.findMany({ where: { tenantId: t.id } }),
  ]);
  console.log(
    `\n${t.name}: ${appointments.length} موعد · ${customers.length} عميل · ` +
      `${conversations.length} محادثة · ${leads.length} عميل محتمل`,
  );
  for (const c of customers) console.log(`  • ${c.name ?? "بلا اسم"} ${c.phone ?? ""}`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ok = (await rl.question(`\nللمسح اكتب معرّف المتجر (${slug}): `)).trim();
  rl.close();
  if (ok !== slug) return console.error("\n❌ لم يُمسح شيء\n");

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}-trial-data-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ appointments, customers, contacts, conversations, leads }, null, 1));

  // المواعيد أولاً: العميل محميّ من الحذف ما دام له موعد (Restrict)
  // الرسائل تُحذف مع محادثتها (Cascade)
  const [a, , c, conv, l] = await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { tenantId: t.id } }),
    prisma.customerContact.deleteMany({ where: { tenantId: t.id } }),
    prisma.customer.deleteMany({ where: { tenantId: t.id } }),
    prisma.conversation.deleteMany({ where: { tenantId: t.id } }),
    prisma.lead.deleteMany({ where: { tenantId: t.id } }),
  ]);
  console.log(`\n✅ مُسح ${a.count} موعد · ${c.count} عميل · ${conv.count} محادثة · ${l.count} عميل محتمل`);
  console.log(`   النسخة الاحتياطية: ${path.relative(process.cwd(), file)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
