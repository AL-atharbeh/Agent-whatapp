import { tenantScope } from "@/lib/tenancy";
import { json, parseId, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { loadConversation, toItem1 } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /conversations/:id/takeover — الموظف يُسكت الوكيل ويتولّاها.
 * المحوّلة أصلاً تبقى على سببها: هو ما يشرح لماذا احتاجت إنساناً.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  let c = await loadConversation(d.tenantId, parseId((await ctx.params).id));
  if (c.status !== "HUMAN") {
    c = await tenantScope(d.tenantId).handoff(c.id, "استلام يدوي من التطبيق");
  }
  return json({ conversation: await toItem1(d, c) });
});
