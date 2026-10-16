import { prisma } from "@/lib/db";
import { MOBILE_CHANNELS, json, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /inbox/summary — أرقام الأشرطة الثلاثة وبصمة التغيير.
 *
 * يسألها التطبيق كل ٨ ثوانٍ لكل جهاز في المقدّمة، فهي أكثر نقطة تُنادى:
 * ثلاثة استعلامات مجمّعة على فهارس، لا شيء يمر على الرسائل واحدة واحدة.
 */
export const GET = route(async (req) => {
  const d = await requireDevice(req);

  const [handoffs, unread, lastMsg, lastConvo] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["channel"],
      where: { tenantId: d.tenantId, status: "HUMAN", channel: { in: [...MOBILE_CHANNELS] } },
      _count: { _all: true },
    }),
    // غير مقروءة = كتب العميل بعد آخر قراءة لهذا المستخدم. lastInboundAt
    // يكفي للمقارنة فلا نعدّ الرسائل — العدد المطلوب محادثات لا رسائل.
    // وPrisma لا يقارن عموداً بعمود من جدول آخر، فالاستعلام خام.
    prisma.$queryRaw<{ channel: string; n: number }[]>`
      SELECT c.channel::text AS channel, COUNT(*)::int AS n
      FROM "Conversation" c
      LEFT JOIN "ConversationRead" r
        ON r."conversationId" = c.id AND r."userId" = ${d.userId}
      WHERE c."tenantId" = ${d.tenantId}
        AND c.channel IN ('WHATSAPP', 'INSTAGRAM', 'MESSENGER')
        AND c."lastInboundAt" IS NOT NULL
        AND c."lastInboundAt" > COALESCE(r."lastReadAt", ${d.inboxBaselineAt})
      GROUP BY c.channel`,
    prisma.message.aggregate({
      where: { tenantId: d.tenantId },
      _max: { createdAt: true },
    }),
    // التحويل والاستلام والإعادة أحداث بلا رسالة — بدونها لا يعلم جوال
    // الزميل أن المحادثة انمسكت، فيردّ عليها اثنان
    prisma.conversation.aggregate({
      where: { tenantId: d.tenantId },
      _max: { updatedAt: true },
    }),
  ]);

  const h = new Map(handoffs.map((r) => [r.channel as string, r._count._all]));
  const u = new Map(unread.map((r) => [r.channel, Number(r.n)]));

  return json({
    // القنوات الثلاث دائماً، صفراً إن لم يكن فيها شيء — التطبيق يرسم
    // الأشرطة من هذه القائمة، وغياب قناة يُخفي شريطها.
    channels: MOBILE_CHANNELS.map((channel) => ({
      channel,
      unread: u.get(channel) ?? 0,
      handoff: h.get(channel) ?? 0,
    })),
    version: String(
      Math.max(
        lastMsg._max.createdAt?.getTime() ?? 0,
        lastConvo._max.updatedAt?.getTime() ?? 0,
      ),
    ),
  });
});
