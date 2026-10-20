import { customerFields, customerProfile, toCustomerView, updateCustomer } from "@/lib/appointments";
import { json, parseId, readBody, route } from "@/lib/mobile/http";
import { appointmentJson, requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /customers/:id — الملف الكامل: الزيارات، المدد المتعلَّمة، القادم. */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const p = await customerProfile(d.tenantId, parseId((await ctx.params).id));
  return json({
    ...p,
    upcoming: await Promise.all(p.upcoming.map((a) => appointmentJson(d.tenantId, a))),
  });
});

/** PATCH /customers/:id — { name?, phone?, notes?, preferredStaffId? } */
export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const b = await readBody(req, customerFields);
  return json({ customer: toCustomerView(await updateCustomer(d.tenantId, id, b)) });
});
