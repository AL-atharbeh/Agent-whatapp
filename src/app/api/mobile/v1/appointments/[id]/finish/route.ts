import { z } from "zod";
import { finishAppointment } from "@/lib/appointments";
import { json, parseId, readBody, route } from "@/lib/mobile/http";
import { appointmentJson, requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  finalPrice: z.number().finite().min(0).max(10_000_000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

/**
 * POST /appointments/:id/finish — خلصت. بلا finalPrice ⇒ السعر المقترح
 * (آخر ما دفعه العميل لهذه الخدمة، وإلا الحد الأدنى).
 * الجسم اختياري كله؛ طلب بلا جسم مقبول.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const hasBody = (req.headers.get("content-length") ?? "0") !== "0" || req.headers.has("transfer-encoding");
  const b = hasBody ? await readBody(req, Body) : {};
  const a = await finishAppointment(d.tenantId, id, { finalPrice: b.finalPrice, notes: b.notes });
  return json({ appointment: await appointmentJson(d.tenantId, a) });
});
