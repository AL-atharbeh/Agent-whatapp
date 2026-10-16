import { approvedTemplates } from "@/lib/outbound";
import { json, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /templates — المعتمدة فقط، من Meta مباشرة. */
export const GET = route(async (req) => {
  const d = await requireDevice(req);
  return json({ items: await approvedTemplates(d.tenantId) });
});
