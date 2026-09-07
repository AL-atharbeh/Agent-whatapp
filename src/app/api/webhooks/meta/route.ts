import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseWebhook, verifySignature } from "@/lib/channels/meta";
import { handleInbound } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * الويبهوك المشترك — رابط واحد لكل العملاء.
 *
 *   https://<domain>/api/webhooks/meta
 *
 * يُستخدم عندما تستضيف عملاءك على تطبيق Meta واحد تملكه أنت (نموذج SaaS).
 * تطبيق Meta يسمح بعنوان استدعاء واحد فقط، لذلك لا يمكن استخدام الرابط
 * المخصص لكل عميل (/[tenantSlug]) في هذه الحالة.
 *
 * تحديد العميل يتم من `phone_number_id` الوارد في الرسالة نفسها — وهو فريد
 * على مستوى المنصة بقيد @@unique([channel, externalId])، فلا يمكن لرقم واحد
 * أن يعود لعميلين. العزل بعدها يتكفّل به pipeline كالمعتاد.
 *
 * التوقيع يُتحقّق منه بسرّ تطبيق المنصة (META_APP_SECRET) لأن كل العملاء
 * على نفس التطبيق. أما العميل الذي يملك تطبيق Meta خاصاً به فيستخدم
 * الرابط المخصص /api/webhooks/meta/<slug> بسرّه هو.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_VERIFY_TOKEN;
  if (!expected) {
    console.error("[webhook] META_VERIFY_TOKEN غير مضبوط");
    return new NextResponse("Server Misconfigured", { status: 500 });
  }

  if (mode !== "subscribe" || token !== expected) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge ?? "", { status: 200 });
}

export async function POST(req: Request) {
  const raw = await req.text(); // الجسم الخام مطلوب للتوقيع

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[webhook] META_APP_SECRET غير مضبوط");
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

  // تشخيص: رسالة من حساب غير مربوط بأي عميل تُسجَّل بوضوح بدل أن تختفي صامتة
  after(async () => {
    for (const msg of messages) {
      try {
        const known = await prisma.channelAccount.findUnique({
          where: {
            channel_externalId: { channel: msg.channel, externalId: msg.accountExternalId },
          },
          select: { id: true },
        });
        if (!known) {
          console.warn(
            `[webhook] حساب غير مربوط: ${msg.channel} ${msg.accountExternalId} — ` +
              `أضفه في لوحة التحكم تحت تبويب القنوات`,
          );
          continue;
        }
        await handleInbound(msg);
      } catch (err) {
        console.error("[webhook] خطأ في المعالجة:", err);
      }
    }
  });

  return NextResponse.json({ received: messages.length });
}
