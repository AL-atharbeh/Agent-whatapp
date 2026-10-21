import { z } from "zod";
import { createStaff, listStaff, staffFields } from "@/lib/appointments";
import { json, readBody, readQuery, route } from "@/lib/mobile/http";
import { requireAppointments, staffJson } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /staff — الفريق المفعّل، بلا بايتات الصور (لها مسارها المخبّأ).
 * `?all=1` يضمّ الموقوفين لشاشة الإدارة.
 */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, z.object({ all: z.enum(["0", "1"]).optional() }));
  return json({ items: (await listStaff(d.tenantId, { includeInactive: q.all === "1" })).map(staffJson) });
});

/** POST /staff — { name, phone?, workingHours, commissionPercent?, serviceIds? } */
export const POST = route(async (req) => {
  const d = await requireAppointments(req);
  const b = await readBody(req, staffFields);
  return json({ staff: staffJson(await createStaff(d.tenantId, b)) }, 201);
});
