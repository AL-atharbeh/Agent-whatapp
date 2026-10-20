import { z } from "zod";
import { getAppointment, rescheduleAppointment } from "@/lib/appointments";
import { idParam, json, parseId, readBody, route } from "@/lib/mobile/http";
import { appointmentJson, requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /appointments/:id */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const a = await getAppointment(d.tenantId, parseId((await ctx.params).id));
  return json({ appointment: await appointmentJson(d.tenantId, a) });
});

const Body = z.object({
  startAt: z.iso.datetime({ offset: true }).optional(),
  staffId: idParam.optional(),
  plannedMinutes: z.number().int().min(5).max(720).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

/** PATCH /appointments/:id — نقل أو تعديل المدة أو ملاحظات الزيارة. */
export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const b = await readBody(req, Body);
  const a = await rescheduleAppointment(d.tenantId, id, {
    startAt: b.startAt ? new Date(b.startAt) : undefined,
    staffId: b.staffId,
    plannedMinutes: b.plannedMinutes,
    notes: b.notes,
  });
  return json({ appointment: await appointmentJson(d.tenantId, a) });
});
