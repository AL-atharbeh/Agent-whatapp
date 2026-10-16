import { z } from "zod";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";
import { ApiError, MOBILE_CHANNELS, json, readQuery, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { decodeCursor, encodeCursor } from "@/lib/mobile/cursor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

/**
 * GET /leads — العملاء المحتملون، الأحدث أولاً.
 *
 * الاسم والرقم يُكمَّلان من المحادثة كما في صفحة الويب: أكثر من يبدي نية
 * شراء لا يقولهما للوكيل، وقائمة بلا اسم ولا رقم لا يُعاد منها الاتصال.
 */
export const GET = route(async (req) => {
  const d = await requireDevice(req);
  const q = readQuery(req, Query);

  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) throw new ApiError("INVALID_INPUT", "مؤشّر الصفحة غير صالح");

  const rows = await prisma.lead.findMany({
    where: {
      tenantId: d.tenantId,
      channel: { in: [...MOBILE_CHANNELS] },
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.at } },
              { createdAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });

  const page = rows.slice(0, q.limit);
  const tail = page[page.length - 1];
  const nextCursor =
    rows.length > q.limit && tail ? encodeCursor({ at: tail.createdAt, id: tail.id }) : null;

  const keys = page
    .filter((l) => l.externalUserId)
    .map((l) => ({ channel: l.channel, externalUserId: l.externalUserId! }));
  const convos = keys.length
    ? await prisma.conversation.findMany({
        where: { tenantId: d.tenantId, OR: keys },
        select: { channel: true, externalUserId: true, customerName: true },
      })
    : [];
  const nameOf = new Map(
    convos.map((c) => [`${c.channel}:${c.externalUserId}`, displayName(c.customerName)]),
  );

  return json({
    items: page.map((l) => ({
      id: l.id,
      name: l.name ?? nameOf.get(`${l.channel}:${l.externalUserId}`) ?? null,
      // ما قاله العميل أولاً — هو ما اختاره للتواصل. وإلا رقم واتساب الذي راسلنا منه
      phone:
        l.phone ??
        (l.channel === "WHATSAPP" && l.externalUserId ? `+${l.externalUserId}` : null),
      channel: l.channel,
      interest: l.interest,
      notes: l.notes,
      at: l.createdAt.toISOString(),
    })),
    nextCursor,
  });
});
