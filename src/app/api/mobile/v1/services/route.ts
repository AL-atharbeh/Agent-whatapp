import { listServices } from "@/lib/appointments";
import { json, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /services — الخدمات المفعّلة. */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  return json({ items: await listServices(d.tenantId) });
});
