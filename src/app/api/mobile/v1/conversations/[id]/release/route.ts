import { prisma } from "@/lib/db";
import { json, parseId, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { loadConversation, toItem1 } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /conversations/:id/release — إعادتها للوكيل.
 * يمحو سبب التحويل: سبب قديم يبقى ظاهراً يوحي أنها ما زالت تحتاج موظفاً.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const c = await loadConversation(d.tenantId, parseId((await ctx.params).id));
  const updated = await prisma.conversation.update({
    where: { id: c.id, tenantId: d.tenantId },
    data: { status: "BOT", handoffReason: null, handoffAt: null },
  });
  return json({ conversation: await toItem1(d, updated) });
});
