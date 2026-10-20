import { z } from "zod";
import {
  bookAppointment,
  createCustomer,
  dayView,
  loadApptTenant,
  toLocal,
} from "@/lib/appointments";
import { idParam, json, readBody, readQuery, route } from "@/lib/mobile/http";
import { appointmentJson, requireAppointments, staffJson } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * GET /appointments?date=YYYY-MM-DD — يوم كامل: الفريق والخدمات والمواعيد.
 * بلا تاريخ ⇒ اليوم بتوقيت المتجر لا الجهاز: جوال مسافر لا يرى يوماً آخر.
 */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, Query);
  const date = q.date ?? toLocal(new Date(), (await loadApptTenant(d.tenantId)).timezone).date;
  const day = await dayView(d.tenantId, date);
  return json({
    ...day,
    staff: day.staff.map(staffJson),
    items: await Promise.all(day.items.map((a) => appointmentJson(d.tenantId, a))),
  });
});

const Body = z
  .object({
    serviceId: idParam,
    staffId: idParam,
    startAt: z.iso.datetime({ offset: true }),
    customerId: idParam.optional(),
    // عميل جديد حضوري/بالهاتف — يُنشأ أو يُدمج برقمه في نفس الطلب
    customer: z
      .object({ phone: z.string().trim().min(1).max(30), name: z.string().trim().max(80).optional() })
      .optional(),
    plannedMinutes: z.number().int().min(5).max(720).optional(),
    source: z.enum(["WALK_IN", "PHONE", "APP"]).default("APP"),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((b) => b.customerId || b.customer, "العميل مطلوب");

/** POST /appointments — حجز من التطبيق (حضوري/هاتف). */
export const POST = route(async (req) => {
  const d = await requireAppointments(req);
  const b = await readBody(req, Body);
  const customerId =
    b.customerId ??
    (await createCustomer(d.tenantId, { phone: b.customer!.phone, name: b.customer!.name ?? null })).customer.id;
  const a = await bookAppointment(d.tenantId, {
    customerId,
    serviceId: b.serviceId,
    staffId: b.staffId,
    startAt: new Date(b.startAt),
    source: b.source,
    plannedMinutes: b.plannedMinutes,
    notes: b.notes,
  });
  return json({ appointment: await appointmentJson(d.tenantId, a) }, 201);
});
