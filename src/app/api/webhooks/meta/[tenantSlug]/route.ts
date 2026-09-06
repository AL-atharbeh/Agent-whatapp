import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseWebhook, verifySignature } from "@/lib/channels/meta";
import { handleInbound } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ويبهوك Meta — رابط منفصل لكل عميل:
 *   https://<domain>/api/webhooks/meta/<tenantSlug>
 *
 * لماذا رابط لكل عميل بدل رابط واحد مشترك؟
 *  - كل عميل يسجّل تطبيق Meta الخاص به بمفاتيحه هو.
 *  - التوقيع يُتحقّق منه بـ app secret الخاص بذاك العميل تحديداً.
 *  - وحتى بعد ذلك، نتأكد أن phone_number_id الوارد يعود فعلاً لهذا العميل
 *    (دفاع متعدد الطبقات — طبقة العزل في tenancy.ts هي الأخيرة).
 */

type Ctx = { params: Promise<{ tenantSlug: string }> };

// ── التحقق عند ربط الويبهوك في لوحة Meta ──
export async function GET(req: Request, ctx: Ctx) {
  const { tenantSlug } = await ctx.params;
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const account = await prisma.channelAccount.findFirst({
    where: { tenant: { slug: tenantSlug }, verifyToken: token, active: true },
    select: { id: true },
  });

  if (!account) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge ?? "", { status: 200 });
}

// ── استقبال الرسائل ──
export async function POST(req: Request, ctx: Ctx) {
  const { tenantSlug } = await ctx.params;
  const raw = await req.text(); // الجسم الخام مطلوب للتوقيع — لا تستخدم req.json() هنا

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, status: true, channels: { select: { appSecretEnc: true } } },
  });
  if (!tenant) return new NextResponse("Not Found", { status: 404 });

  // سر التطبيق: الخاص بالعميل إن وُجد، وإلا سر المنصة الافتراضي
  const tenantSecret = tenant.channels.find((c) => c.appSecretEnc)?.appSecretEnc;
  const appSecret = tenantSecret ? decrypt(tenantSecret) : process.env.META_APP_SECRET;

  if (!appSecret) {
    console.error("[webhook] لا يوجد app secret لـ", tenantSlug);
    return new NextResponse("Server Misconfigured", { status: 500 });
  }

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const messages = parseWebhook(body);

  // Meta تتوقع 200 خلال ثوانٍ وإلا تعيد الإرسال. المعالجة (التي قد تستغرق
  // ثوانٍ مع نداء النموذج) تكمل بعد إرجاع الاستجابة.
  after(async () => {
    for (const msg of messages) {
      try {
        await handleInbound(msg);
      } catch (err) {
        console.error("[webhook] خطأ في المعالجة:", err);
      }
    }
  });

  return NextResponse.json({ received: messages.length });
}
