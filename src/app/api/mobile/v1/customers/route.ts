import { z } from "zod";
import { createCustomer, customerFields, searchCustomers, toCustomerView } from "@/lib/appointments";
import { json, readBody, readQuery, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /customers?q= — بحث بالاسم أو الرقم؛ فارغ ⇒ الأحدث زيارة. */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, Query);
  const rows = await searchCustomers(d.tenantId, q.q, q.limit);
  return json({ items: rows.map(toCustomerView) });
});

/**
 * POST /customers — رقم موجود ⇒ نفس العميل (200، existed: true) بفراغاته
 * معبّأة، لا خطأ: غالباً راسل من قبل فأُنشئ تلقائياً.
 */
export const POST = route(async (req) => {
  const d = await requireAppointments(req);
  const b = await readBody(req, customerFields);
  const r = await createCustomer(d.tenantId, b);
  return json({ customer: toCustomerView(r.customer), existed: r.existed }, r.existed ? 200 : 201);
});
