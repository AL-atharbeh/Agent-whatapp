import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, MOBILE_CHANNELS, json, readQuery, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { decodeCursor, encodeCursor } from "@/lib/mobile/cursor";
import { toItems } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  channel: z.enum(MOBILE_CHANNELS).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

// ٢٠٠ لا ٥٠: يوم مزدحم بعد عطل في الوكيل يحوّل العشرات، والمحوّلة التي لا
// تظهر في المثبّتة لا تظهر أبداً — فهي خارج ترقيم items عمداً.
const PINNED_MAX = 200;
const ORDER: Prisma.ConversationOrderByWithRelationInput[] = [
  { lastMessageAt: "desc" },
  { id: "desc" },
];

/**
 * GET /conversations — المحوّلة لموظف مثبّتة فوق، والباقي بترقيم.
 *
 * المثبّتة في الصفحة الأولى فقط: هي ما ينتظر إنساناً الآن، ولو وُزّعت على
 * الصفحات لضاعت محادثة معلّقة في الصفحة الثالثة لا يصلها أحد بالتمرير.
 */
export const GET = route(async (req) => {
  const d = await requireDevice(req);
  const q = readQuery(req, Query);

  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) throw new ApiError("INVALID_INPUT", "مؤشّر الصفحة غير صالح");

  const channel = q.channel ? q.channel : { in: [...MOBILE_CHANNELS] };

  const [pinned, rows] = await Promise.all([
    cursor
      ? Promise.resolve([])
      : prisma.conversation.findMany({
          where: { tenantId: d.tenantId, channel, status: "HUMAN" },
          orderBy: ORDER,
          take: PINNED_MAX,
        }),
    prisma.conversation.findMany({
      where: {
        tenantId: d.tenantId,
        channel,
        status: { in: ["BOT", "CLOSED"] },
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: cursor.at } },
                { lastMessageAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: ORDER,
      take: q.limit + 1,
    }),
  ]);

  const page = rows.slice(0, q.limit);
  const tail = page[page.length - 1];
  const nextCursor =
    rows.length > q.limit && tail ? encodeCursor({ at: tail.lastMessageAt, id: tail.id }) : null;

  // دفعة واحدة للمجموعتين: نفس عدد الاستعلامات مهما كبرت الصفحة
  const all = await toItems(d, [...pinned, ...page]);

  return json({
    pinned: all.slice(0, pinned.length),
    items: all.slice(pinned.length),
    nextCursor,
  });
});
