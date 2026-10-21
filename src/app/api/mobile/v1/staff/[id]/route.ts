import { staffPatch, updateStaff } from "@/lib/appointments";
import { json, parseId, readBody, route } from "@/lib/mobile/http";
import { requireAppointments, staffJson } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /staff/:id — أي حقل من حقول الإنشاء؛ serviceIds يستبدل القائمة كلها. */
export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const b = await readBody(req, staffPatch);
  return json({ staff: staffJson(await updateStaff(d.tenantId, id, b)) });
});
