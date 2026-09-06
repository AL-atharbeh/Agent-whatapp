import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chatOnce } from "../src/lib/pipeline";
import { prisma } from "../src/lib/db";

/**
 * محادثة تجريبية مع وكيل عميل معيّن من الطرفية — بدون واتساب ولا Meta.
 *   npm run chat dhahab
 */

const slug = process.argv[2];

async function main() {
  if (!slug) {
    const tenants = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    console.log("حدّد العميل:  npm run chat <slug>\n\nالمتاح:");
    tenants.forEach((t) => console.log(`  ${t.slug.padEnd(10)} ${t.name}`));
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`لا يوجد عميل بالمعرّف "${slug}"`);
    return;
  }

  const sessionId = `cli-${Date.now()}`;
  console.log(`\n💬 محادثة مع وكيل: ${tenant.name} (${tenant.agentName})`);
  console.log("   اكتب رسالتك، أو /خروج للإنهاء\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  for (;;) {
    const text = (await rl.question("أنت: ")).trim();
    if (!text) continue;
    if (text === "/خروج" || text === "/exit") break;

    const t0 = Date.now();
    const res = await chatOnce({ tenantSlug: slug, sessionId, text });
    if ("error" in res) {
      console.error(res.error);
      continue;
    }

    console.log(`\n${tenant.agentName}: ${res.reply}\n`);

    const calls = res.toolCalls as { name: string; summary: string }[];
    if (calls.length) {
      console.log(`   ⚙️  ${calls.map((c) => `${c.name}(${c.summary})`).join("، ")}`);
    }
    const u = res.usage as Record<string, number>;
    console.log(
      `   📊 ${res.provider} · ${Date.now() - t0}ms · إدخال ${u.input_tokens} · ` +
        `كاش ${u.cache_read_input_tokens} · إخراج ${u.output_tokens}\n`,
    );
  }

  rl.close();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
