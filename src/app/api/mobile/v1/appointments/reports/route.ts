import { z } from "zod";
import { appointmentReport } from "@/lib/appointments";
import { json, readQuery, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /appointments/reports?from=YYYY-MM-DD&to=YYYY-MM-DD — نفس أرقام لوحة
 * التقارير من نفس الدالة: حسابان للعمولة يختلفان يوماً في التقريب.
 */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, z.object({ from: date, to: date }));
  return json({ report: await appointmentReport(d.tenantId, q.from, q.to) });
});
