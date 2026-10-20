import { listStaff } from "@/lib/appointments";
import { json, route } from "@/lib/mobile/http";
import { requireAppointments, staffJson } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /staff — الفريق المفعّل، بلا بايتات الصور (لها مسارها المخبّأ). */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  return json({ items: (await listStaff(d.tenantId)).map(staffJson) });
});
