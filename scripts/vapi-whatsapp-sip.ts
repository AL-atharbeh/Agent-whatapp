import { resolve4 } from "node:dns/promises";
import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto";

/**
 * يوصل مكالمات واتساب متجر بمساعد Vapi عبر SIP.
 *
 *   VAPI_PRIVATE_KEY=… في .env (المفتاح الخاص من لوحة Vapi — لا يُلصق في محادثة)
 *   npm run vapi:whatsapp -- <slug> <اسم المساعد في Vapi>
 *
 * لماذا ليس «Free Vapi SIP»: Meta ترسل المكالمة إلى +<رقم المتجر>@<المضيف>،
 * ومعرّف Vapi SIP المجاني لا يقبل «+» — فلا يطابق شيئاً ويُرفض بصمت قبل أن
 * تُنشأ مكالمة. رقم «BYO» على جذع SIP يقبل الرقم كما ترسله Meta، ومضيفه خاص
 * به (<credential>.sip.vapi.ai).
 *
 * بوابات الجذع: عناوين مضيف SIP عند Meta (meta.vc) بأقنعة /24. نطاقات Meta
 * كلها (AS32934، ٢٣ نطاقاً من /14 إلى /23) أوسع من أن تُسجَّل: Vapi يرفض قناعاً
 * أقل من /24، وتفكيكها يعطي أكثر من ألفي بوابة.
 */

/** عناوين مضيف SIP عند Meta، كل واحد بشبكته /24. */
async function metaGateways(): Promise<string[]> {
  const ips = await resolve4("meta.vc");
  return [...new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".") + ".0"))];
}

const VAPI = "https://api.vapi.ai";
const GRAPH = "https://graph.facebook.com/v23.0";

async function vapi(method: string, path: string, body?: unknown) {
  const r = await fetch(`${VAPI}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Vapi ${method} ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const [slug, assistantName] = process.argv.slice(2);
  if (!slug || !assistantName) throw new Error("الاستعمال: npm run vapi:whatsapp -- <slug> <اسم المساعد>");
  if (!process.env.VAPI_PRIVATE_KEY) throw new Error("أضف VAPI_PRIVATE_KEY إلى .env (المفتاح الخاص من Vapi)");

  // ── رقم واتساب المتجر ورمزه ──
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true, name: true } });
  const wa = await prisma.channelAccount.findFirst({
    where: { tenantId: t.id, channel: "WHATSAPP", active: true, accessTokenEnc: { not: null } },
    select: { externalId: true, accessTokenEnc: true },
  });
  if (!wa) throw new Error("لا قناة واتساب مفعّلة لهذا المتجر");
  const token = decrypt(wa.accessTokenEnc!);
  const info = await (
    await fetch(`${GRAPH}/${wa.externalId}?fields=display_phone_number`, { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  const e164 = `+${String(info.display_phone_number ?? "").replace(/\D/g, "")}`;
  if (e164.length < 9) throw new Error(`تعذّر قراءة رقم واتساب: ${JSON.stringify(info)}`);
  console.log(`📞 رقم المتجر: ${e164}`);

  // ── المساعد ──
  const assistants: { id: string; name?: string }[] = await vapi("GET", "/assistant?limit=100");
  const assistant = assistants.find((a) => a.name?.trim().toLowerCase() === assistantName.trim().toLowerCase());
  if (!assistant) throw new Error(`لا مساعد باسم «${assistantName}». الموجود: ${assistants.map((a) => a.name).join("، ")}`);
  console.log(`🤖 المساعد: ${assistant.name} (${assistant.id})`);

  // ── الجذع: نطاقات Meta بوابات واردة فقط ──
  const credential = await vapi("POST", "/credential", {
    provider: "byo-sip-trunk",
    name: `whatsapp-${slug}`,
    gateways: (await metaGateways()).map((ip) => ({ ip, netmask: 24, inboundEnabled: true, outboundEnabled: false })),
  });
  const host = `${credential.id}.sip.vapi.ai`;
  console.log(`🔐 الجذع: ${credential.id}`);

  // ── الرقم على الجذع، بـ«+» كما ترسله Meta ──
  const phone = await vapi("POST", "/phone-number", {
    provider: "byo-phone-number",
    name: `WhatsApp ${t.name}`,
    number: e164,
    numberE164CheckEnabled: false,
    credentialId: credential.id,
    assistantId: assistant.id,
  });
  console.log(`☎️  رقم Vapi: ${phone.id}`);

  // ── واتساب يوجّه المكالمات لمضيف الجذع ──
  const r = await fetch(`${GRAPH}/${wa.externalId}/settings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      calling: {
        status: "ENABLED",
        call_icon_visibility: "DEFAULT",
        srtp_key_exchange_protocol: "SDES",
        sip: { status: "ENABLED", servers: [{ hostname: host, port: 5061 }] },
      },
    }),
  });
  const meta = await r.json();
  if (!r.ok) throw new Error(`Meta settings → ${r.status}: ${JSON.stringify(meta)}`);
  console.log(`✅ واتساب يوجّه المكالمات إلى ${host}`);
  console.log("\nاتصل الآن على واتساب المتجر من جوالك وراقب Logs ← Calls في Vapi.");
}

main()
  .catch((e) => {
    console.error("\n❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
