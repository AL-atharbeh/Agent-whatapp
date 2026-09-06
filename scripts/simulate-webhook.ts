import crypto from "node:crypto";
import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto";

/**
 * يحاكي رسالة واتساب واردة من Meta — بنفس شكل الـ payload ونفس التوقيع.
 *
 * الفائدة: يفصل بين "هل نظامي يعمل؟" و"هل Meta ترسل؟". إن نجح هذا السكربت
 * فكل شيء من الويبهوك إلى الوكيل إلى قاعدة البيانات سليم، وأي مشكلة متبقية
 * تكون في تسليم Meta وحدها.
 *
 *   npx tsx --env-file=.env scripts/simulate-webhook.ts <slug> "<الرسالة>"
 */

const slug = process.argv[2] ?? "shahad";
const text = process.argv[3] ?? "مرحبا";
const BASE = process.env.SIMULATE_BASE_URL ?? "https://agent-whatapp.vercel.app";

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { channels: { where: { channel: "WHATSAPP" } } },
  });
  if (!tenant) return console.error(`لا يوجد متجر بالمعرّف "${slug}"`);

  const account = tenant.channels[0];
  if (!account) return console.error("لا توجد قناة واتساب مربوطة لهذا المتجر");
  if (!account.appSecretEnc) return console.error("App Secret غير محفوظ في القناة");

  const appSecret = decrypt(account.appSecretEnc);
  const from = "962776719225";
  const messageId = `wamid.SIM${Date.now()}`;

  // نفس بنية payload واتساب الحقيقية
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "4140770986215477",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551985528",
                phone_number_id: account.externalId,
              },
              contacts: [{ profile: { name: "أحمد" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const raw = JSON.stringify(payload);
  const signature =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");

  const url = `${BASE}/api/webhooks/meta/${slug}`;
  console.log(`\n📤 إرسال رسالة محاكاة إلى ${url}`);
  console.log(`   من: +${from}   النص: "${text}"\n`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body: raw,
  });

  console.log(`   استجابة الويبهوك: ${res.status} ${await res.text()}`);
  if (res.status !== 200) {
    console.error("\n❌ الويبهوك رفض الطلب — تحقّق من App Secret المحفوظ في اللوحة.\n");
    return;
  }

  console.log("\n⏳ انتظار معالجة الوكيل (٤٥ ثانية كحد أقصى)...\n");

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const convo = await prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalUserId: {
          tenantId: tenant.id,
          channel: "WHATSAPP",
          externalUserId: from,
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    const agentReply = convo?.messages.find(
      (m) => m.role === "AGENT" && m.createdAt.getTime() > Date.now() - 120_000,
    );

    if (agentReply) {
      console.log("═".repeat(60));
      console.log("✅ نجح! النظام كامل يعمل.\n");
      for (const m of convo!.messages.slice(-4)) {
        console.log(`${m.role === "USER" ? "👤 العميل" : "🤖 الوكيل"}: ${m.text}`);
        const tools = (m.toolCalls ?? []) as { name: string; summary: string }[];
        if (Array.isArray(tools) && tools.length) {
          console.log(`   ⚙️  ${tools.map((t) => `${t.name}(${t.summary})`).join(" | ")}`);
        }
      }
      console.log("═".repeat(60));
      console.log(
        "\nالمعنى: الويبهوك والتوقيع والعزل والوكيل وقاعدة البيانات — كلها سليمة.",
      );
      console.log("المتبقي فقط: أن تسلّم Meta الرسائل الحقيقية.\n");
      return;
    }
  }

  console.log("⚠️ وصلت الرسالة لكن لم يُسجَّل رد بعد. راجع سجلات Vercel.\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
