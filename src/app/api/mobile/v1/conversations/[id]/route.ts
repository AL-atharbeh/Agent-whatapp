import { json, parseId, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { loadConversation, toItem1 } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /conversations/:id */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const c = await loadConversation(d.tenantId, parseId((await ctx.params).id));
  return json({ conversation: await toItem1(d, c) });
});
