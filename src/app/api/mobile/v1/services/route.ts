import { z } from "zod";
import { createService, listServices, serviceFields } from "@/lib/appointments";
import { json, readBody, readQuery, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /services — الخدمات المفعّلة. `?all=1` يضمّ الموقوفة لشاشة الإدارة:
 * خدمة أُوقفت يجب أن تبقى ظاهرة هناك وإلا لا سبيل لإعادة تفعيلها من الجوال.
 */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, z.object({ all: z.enum(["0", "1"]).optional() }));
  return json({ items: await listServices(d.tenantId, { includeInactive: q.all === "1" }) });
});

/** POST /services — { name, category?, priceMin, priceMax?, defaultMinutes, processing…?, rebookAfterDays? } */
export const POST = route(async (req) => {
  const d = await requireAppointments(req);
  const b = await readBody(req, serviceFields);
  return json({ service: await createService(d.tenantId, b) }, 201);
});
