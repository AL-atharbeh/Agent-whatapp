import { prisma } from "@/lib/db";
import { noContent, parseId, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { loadConversation } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /conversations/:id/read — قراءة هذا المستخدم وحده.
 * قراءة موظف لا تُخفي العدّاد عن زميله، وإلا ظن أن أحداً تولّاها.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const c = await loadConversation(d.tenantId, parseId((await ctx.params).id));
  const now = new Date();

  await prisma.conversationRead.upsert({
    where: { userId_conversationId: { userId: d.userId, conversationId: c.id } },
    create: { userId: d.userId, conversationId: c.id, tenantId: d.tenantId, lastReadAt: now },
    update: { lastReadAt: now },
  });
  return noContent();
});
