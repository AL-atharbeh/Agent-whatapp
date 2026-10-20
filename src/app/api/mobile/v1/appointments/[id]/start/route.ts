import { startAppointment } from "@/lib/appointments";
import { json, parseId, route } from "@/lib/mobile/http";
import { appointmentJson, requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /appointments/:id/start — بدأت — ويُفحص التأخير المتسلسل بعد الرد. */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const a = await startAppointment(d.tenantId, parseId((await ctx.params).id));
  return json({ appointment: await appointmentJson(d.tenantId, a) });
});
