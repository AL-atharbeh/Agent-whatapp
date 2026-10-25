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
 * وVapi يقبل الوارد على الجذع من عناوين بواباته فقط: فتُسجَّل نطاقات Meta
 * (AS32934) كلها بوابات واردة. القائمة من وثيقة Meta للمكالمات وتتغيّر نادراً:
 *   whois -h whois.radb.net -- '-i origin AS32934' | grep ^route | awk '{print $2}' | grep -v ':' | cidrmerge
 */

const META_PREFIXES = [
  "31.13.24.0/21", "31.13.64.0/18", "45.64.40.0/22", "57.141.0.0/21", "57.141.8.0/22",
  "57.141.12.0/23", "57.144.0.0/14", "66.220.144.0/20", "69.63.176.0/20", "69.171.224.0/19",
  "74.119.76.0/22", "102.132.96.0/20", "103.4.96.0/22", "129.134.0.0/16", "147.75.208.0/20",
  "157.240.0.0/16", "163.70.128.0/17", "163.77.128.0/17", "173.252.64.0/18", "179.60.192.0/22",
  "185.60.216.0/22", "185.89.216.0/22", "204.15.20.0/22",
];

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
    gateways: META_PREFIXES.map((p) => {
      const [ip, mask] = p.split("/");
      return { ip, netmask: Number(mask), inboundEnabled: true, outboundEnabled: false };
    }),
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
