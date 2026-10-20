import { z } from "zod";
import { estimateMinutes, findSlots } from "@/lib/appointments";
import { idParam, json, readQuery, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  serviceId: idParam,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: idParam.optional(),
  customerId: idParam.optional(),
});

/**
 * GET /appointments/slots — الأوقات المتاحة، ومدة كل منها لهذا العميل.
 * `estimate` أعلى الرد هو تقدير مقدّم الخدمة المطلوب (أو العميل وحده إن لم
 * يُحدَّد مقدّم)؛ وكل وقت يحمل مدته هو لأن المقدِّر يختلف بين أفراد الفريق.
 */
export const GET = route(async (req) => {
  const d = await requireAppointments(req);
  const q = readQuery(req, Query);
  const [slots, estimate] = await Promise.all([
    findSlots(d.tenantId, q),
    estimateMinutes(d.tenantId, q),
  ]);
  return json({
    date: q.date,
    estimate,
    slots: slots.map((s) => ({
      startAt: s.startAt.toISOString(),
      local: s.local,
      staffId: s.staffId,
      staffName: s.staffName,
      minutes: s.minutes,
      basis: s.estimate.basis,
    })),
  });
});
