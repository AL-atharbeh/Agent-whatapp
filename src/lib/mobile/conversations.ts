import type { Device } from "./auth";
import type { Conversation, Message } from "@prisma/client";
import { prisma } from "../db";
import { displayId, displayName } from "../display";
import { replyWindow, type ReplyWindow } from "./window";
import { ApiError, MOBILE_CHANNELS } from "./http";

/**
 * تحويل صفوف المحادثات إلى كائنات العقد — بعدد ثابت من الاستعلامات.
 *
 * القائمة تحتاج لكل محادثة آخر رسالة وعدّاد غير مقروء. استعلامٌ لكل محادثة
 * يعني ٨٠ جولة إلى القاعدة لصفحة واحدة — على قاعدة بعيدة ثوانٍ أمام شاشة
 * فارغة. فنجمعها: استعلام لآخر الرسائل كلها، وواحد للقراءات، وواحد للعدّ.
 */

export type ConversationItem = {
  id: string;
  channel: Conversation["channel"];
  customerName: string | null;
  externalUserId: string;
  displayId: string;
  status: Conversation["status"];
  handoffReason: string | null;
  lastMessage: { text: string; role: Message["role"]; at: string } | null;
  unreadCount: number;
  window: ReplyWindow;
};

export type MessageItem = {
  id: string;
  role: Message["role"];
  text: string;
  at: string;
  clientId: string | null;
};

export const toMessageItem = (m: Message): MessageItem => ({
  id: m.id,
  role: m.role,
  text: m.text,
  at: m.createdAt.toISOString(),
  clientId: m.clientId,
});

// معاينة لا نص كامل: رسالة من ٤٠٠٠ حرف × ٨٠ محادثة تجعل القائمة نصف ميغا
// تُنزَّل كل مرة على شبكة جوال. النص الكامل في شاشة المحادثة.
const PREVIEW_CHARS = 280;

type LastRow = { conversationId: string; role: Message["role"]; text: string; createdAt: Date };

/** ما يلزم من الجهاز لبناء عناصر القائمة — المتجر، والقارئ، وبداية قراءته. */
type Reader = Pick<Device, "tenantId" | "userId" | "inboxBaselineAt">;

export async function toItems(d: Reader, convos: Conversation[]): Promise<ConversationItem[]> {
  if (convos.length === 0) return [];
  const { tenantId, userId, inboxBaselineAt: baseline } = d;
  const ids = convos.map((c) => c.id);

  const [lasts, reads] = await Promise.all([
    // LATERAL: رسالة واحدة لكل محادثة عبر فهرس (conversationId, createdAt).
    // include بـ take:1 في Prisma يجلب رسائل المحادثات كلها ويقصّها في
    // الذاكرة — آلاف الصفوف لنحتاج منها ثمانين.
    prisma.$queryRaw<LastRow[]>`
      SELECT c.id AS "conversationId", m.role::text AS role,
             left(m.text, ${PREVIEW_CHARS}) AS text, m."createdAt" AS "createdAt"
      FROM unnest(${ids}::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT role, text, "createdAt" FROM "Message"
        WHERE "conversationId" = c.id AND "tenantId" = ${tenantId}
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 1
      ) m`,
    prisma.conversationRead.findMany({
      where: { userId, tenantId, conversationId: { in: ids } },
      select: { conversationId: true, lastReadAt: true },
    }),
  ]);

  const readAt = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  // لا داعي لعدّ محادثة لم يكتب فيها العميل بعد آخر قراءة — lastInboundAt
  // يجيب بلا استعلام، فلا يُعدّ إلا ما فيه جديد فعلاً.
  const maybeUnread = convos.filter((c) => {
    if (!c.lastInboundAt) return false;
    // لم يقرأها قط ⇒ نقارن بأول دخوله لا بالصفر، وإلا كان كل تاريخها جديداً
    return c.lastInboundAt > (readAt.get(c.id) ?? baseline);
  });

  const counts = maybeUnread.length
    ? await prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          tenantId,
          role: "USER",
          OR: maybeUnread.map((c) => ({
            conversationId: c.id,
            createdAt: { gt: readAt.get(c.id) ?? baseline },
          })),
        },
        _count: { _all: true },
      })
    : [];

  const lastOf = new Map(lasts.map((l) => [l.conversationId, l]));
  const unreadOf = new Map(counts.map((c) => [c.conversationId, c._count._all]));
  const now = new Date();

  return convos.map((c) => toItem(c, lastOf.get(c.id) ?? null, unreadOf.get(c.id) ?? 0, now));
}

function toItem(c: Conversation, last: LastRow | null, unread: number, now: Date): ConversationItem {
  return {
    id: c.id,
    channel: c.channel,
    customerName: displayName(c.customerName),
    externalUserId: c.externalUserId,
    displayId: displayId(c.channel, c.externalUserId),
    status: c.status,
    handoffReason: c.handoffReason,
    lastMessage: last
      ? { text: last.text, role: last.role, at: new Date(last.createdAt).toISOString() }
      : null,
    unreadCount: unread,
    window: replyWindow(c.lastInboundAt, now),
  };
}

export async function toItem1(d: Reader, c: Conversation) {
  const [item] = await toItems(d, [c]);
  return item;
}

/**
 * محادثة لهذا المتجر وفي قنوات الجوال، أو 404.
 *
 * محادثة متجر آخر و«غير موجودة» ردّ واحد: 403 هنا تخبر من يخمّن المعرّفات
 * أنه أصاب معرّفاً حقيقياً.
 */
export async function loadConversation(tenantId: string, id: string): Promise<Conversation> {
  const c = await prisma.conversation.findFirst({
    where: { id, tenantId, channel: { in: [...MOBILE_CHANNELS] } },
  });
  if (!c) throw new ApiError("NOT_FOUND", "المحادثة غير موجودة");
  return c;
}

