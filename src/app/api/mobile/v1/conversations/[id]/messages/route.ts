import { z } from "zod";
import { prisma } from "@/lib/db";
import { sendHumanReply } from "@/lib/outbound";
import {
  ApiError,
  MOBILE_CHANNELS,
  clientIdSchema,
  idParam,
  json,
  parseId,
  readBody,
  readQuery,
  route,
} from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { loadConversation, toItem1, toMessageItem } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  before: idParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /conversations/:id/messages — صفحة من الأقدم للأحدث.
 *
 * نجلب تنازلياً ونقلب: «آخر خمسين» تعني الأحدث، والعرض يحتاجها بترتيب
 * القراءة. و`before` معرّف رسالة لا وقت — الجهاز لا يحسب أوقاتاً بساعته.
 */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const convo = await loadConversation(d.tenantId, parseId((await ctx.params).id));
  const q = readQuery(req, Query);

  let older = {};
  if (q.before) {
    const anchor = await prisma.message.findFirst({
      where: { id: q.before, tenantId: d.tenantId, conversationId: convo.id },
      select: { id: true, createdAt: true },
    });
    if (!anchor) throw new ApiError("INVALID_INPUT", "الرسالة المرجعية غير موجودة في هذه المحادثة");
    older = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    };
  }

  const rows = await prisma.message.findMany({
    where: { tenantId: d.tenantId, conversationId: convo.id, ...older },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });

  return json({
    items: rows.slice(0, q.limit).reverse().map(toMessageItem),
    hasMore: rows.length > q.limit,
  });
});

const Body = z.object({
  text: z
    .string()
    .trim()
    .refine((v) => {
      const n = Array.from(v).length;
      return n >= 1 && n <= 4096;
    }),
  // إلزامي: بلا معرّف لا حجز، وإعادة محاولة بعد انقطاع تصل العميل مرتين
  clientId: clientIdSchema,
});

/**
 * POST /conversations/:id/messages — رد الموظف.
 *
 * الترتيب في lib/outbound: حجز clientId ← نافذة ← Meta ← تخزين واستلام
 * وإغلاق الحجز في معاملة. رفض Meta الصريح ⇒ 502 SEND_FAILED (الإعادة آمنة)،
 * وبلا جواب أكيد ⇒ 409 DELIVERY_UNKNOWN (لا إعادة) — ولا شيء في السجل.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const id = parseId((await ctx.params).id);
  const body = await readBody(req, Body);

  const sent = await sendHumanReply({
    tenantId: d.tenantId,
    conversationId: id,
    text: body.text,
    clientId: body.clientId,
    channels: MOBILE_CHANNELS,
    claim: { reason: "ردّ موظف من التطبيق" },
  });

  return json(
    {
      message: toMessageItem(sent.message),
      conversation: await toItem1(d, sent.conversation),
    },
    201,
  );
});
