import { servicePatch, updateService } from "@/lib/appointments";
import { json, parseId, readBody, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /services/:id — أي حقل من حقول الإنشاء، و`active: false` يوقفها بلا حذف سجلّها. */
export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const b = await readBody(req, servicePatch);
  return json({ service: await updateService(d.tenantId, id, b) });
});
