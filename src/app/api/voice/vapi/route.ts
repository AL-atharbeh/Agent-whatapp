import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { planAllowsChannel } from "@/lib/plans";
import { assistantOverrides, normalizeE164, voiceSettingsOf } from "@/lib/voice/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * نقطة «Server URL» لمنصة المكالمات (Vapi) — تحدّد لكل مكالمة أي متجر يرد.
 *
 *   POST /api/voice/vapi        x-hader-secret: ${VAPI_SERVER_SECRET}
 *
 * عند assistant-request نجد المتجر من الرقم المطلوب ونعيد المساعد المشترك
 * (VAPI_ASSISTANT_ID) بصوت المتجر وجملته الأولى ورابط وكيله. بقية رسائل
 * المنصة (تقارير نهاية المكالمة…) تُقبل بلا عمل.
 *
 * المهلة عند Vapi ٧٫٥ ثانية للمكالمة كلها: استعلام واحد بفهرس فريد، بلا
 * نداءات خارجية.
 */

function authorized(req: Request): boolean {
  const secret = process.env.VAPI_SERVER_SECRET;
  if (!secret) return false;
  const got = req.headers.get("x-hader-secret") ?? "";
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(h(got), h(secret));
}

/** ما تقوله المنصة للمتصل حين لا نعرف المتجر أو لا يحق له — جملة لا خط ميت. */
const UNAVAILABLE = "عذراً، الخدمة غير متاحة على هذا الرقم حالياً.";

type Msg = {
  type?: string;
  phoneNumber?: { id?: string; number?: string };
  call?: { phoneNumberId?: string; phoneNumber?: { id?: string; number?: string } };
};

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let message: Msg = {};
  try {
    message = ((await req.json()) as { message?: Msg }).message ?? {};
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (message.type !== "assistant-request") return Response.json({});

  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!assistantId) {
    console.error("[voice] VAPI_ASSISTANT_ID غير مضبوط");
    return Response.json({ error: UNAVAILABLE });
  }

  const number = normalizeE164(message.phoneNumber?.number ?? message.call?.phoneNumber?.number);
  const phoneId = message.phoneNumber?.id ?? message.call?.phoneNumberId ?? message.call?.phoneNumber?.id;

  const select = {
    slug: true, name: true, agentName: true, status: true, subscription: true, plan: true,
    voiceSettings: true,
  } as const;
  let tenant = number ? await prisma.tenant.findUnique({ where: { voicePhone: number }, select }) : null;
  if (!tenant && phoneId) {
    // عناوين SIP بلا رقم E.164 تُطابَق بمعرّف رقمها في Vapi
    tenant = await prisma.tenant.findFirst({
      where: { voiceSettings: { path: ["vapiPhoneNumberId"], equals: phoneId } },
      select,
    });
  }

  if (!tenant) {
    console.warn(`[voice] مكالمة لرقم غير مربوط بمتجر: ${number ?? phoneId ?? "؟"}`);
    return Response.json({ error: UNAVAILABLE });
  }
  if (tenant.status !== "ACTIVE" || tenant.subscription !== "ACTIVE" || !(await planAllowsChannel(tenant.plan, "VOICE"))) {
    console.warn(`[voice] مكالمة لمتجر بلا مكالمات فعّالة: ${tenant.slug}`);
    return Response.json({ error: UNAVAILABLE });
  }

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  return Response.json({
    assistantId,
    assistantOverrides: assistantOverrides(tenant, voiceSettingsOf(tenant.voiceSettings), base),
  });
}
