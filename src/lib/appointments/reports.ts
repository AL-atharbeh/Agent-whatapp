import { prisma } from "../db";
import { invalid } from "./errors";
import { dayBounds, isDateStr } from "./time";
import { loadApptTenant } from "./tenant";

/**
 * تقارير المواعيد لفترة — دخل الفريق وعمولته، الغياب، أكثر الخدمات، والوقت
 * الذي وفّره النظام.
 *
 * هنا لا في الصفحة: الجوال سيطلب الأرقام نفسها لاحقاً، وحسابان للعمولة في
 * مكانين يختلفان يوماً في التقريب فيظهر لصاحب النشاط رقمان لنفس الشهر.
 */

export type StaffReport = {
  staffId: string;
  name: string;
  visits: number;
  revenue: number;
  commissionPercent: number | null;
  commission: number;
};

export type ServiceReport = { serviceId: string; name: string; visits: number; revenue: number };

export type AppointmentReport = {
  from: string;
  to: string;
  visits: number;
  revenue: number;
  noShows: number;
  cancelled: number;
  /** الغياب من المواعيد التي كان يُنتظر حضورها (منتهية + غياب) — لا من كل ما حُجز */
  noShowRate: number;
  /**
   * الوقت الذي وفّره النظام بالدقائق: مجموع (المدة الافتراضية − المدة المحجوزة)
   * حين حجز المقدِّر أقصر من الثابت القديم. هو الوقت الذي كان سيُحجز فارغاً.
   */
  minutesSaved: number;
  staff: StaffReport[];
  topServices: ServiceReport[];
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** من بداية `from` إلى نهاية `to` (شاملة) بتوقيت المتجر. */
export async function appointmentReport(
  tenantId: string,
  from: string,
  to: string,
): Promise<AppointmentReport> {
  if (!isDateStr(from) || !isDateStr(to) || from > to) throw invalid("فترة غير صالحة");
  const t = await loadApptTenant(tenantId);
  const start = dayBounds(from, t.timezone).start;
  const end = dayBounds(to, t.timezone).end;

  const [rows, staff] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        tenantId,
        startAt: { gte: start, lt: end },
        status: { in: ["DONE", "NO_SHOW", "CANCELLED"] },
      },
      select: {
        status: true,
        staffId: true,
        serviceId: true,
        finalPrice: true,
        plannedMinutes: true,
        service: { select: { name: true, defaultMinutes: true } },
      },
    }),
    prisma.staff.findMany({
      where: { tenantId },
      select: { id: true, name: true, commissionPercent: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const done = rows.filter((r) => r.status === "DONE");
  const noShows = rows.filter((r) => r.status === "NO_SHOW").length;
  const price = (r: (typeof rows)[number]) => (r.finalPrice == null ? 0 : Number(r.finalPrice));

  const byStaff = new Map<string, { visits: number; revenue: number }>();
  const byService = new Map<string, ServiceReport>();
  let minutesSaved = 0;
  for (const r of done) {
    const s = byStaff.get(r.staffId) ?? { visits: 0, revenue: 0 };
    s.visits++;
    s.revenue += price(r);
    byStaff.set(r.staffId, s);

    const v = byService.get(r.serviceId) ?? { serviceId: r.serviceId, name: r.service.name, visits: 0, revenue: 0 };
    v.visits++;
    v.revenue += price(r);
    byService.set(r.serviceId, v);

    minutesSaved += Math.max(0, r.service.defaultMinutes - r.plannedMinutes);
  }

  return {
    from,
    to,
    visits: done.length,
    revenue: round2(done.reduce((a, r) => a + price(r), 0)),
    noShows,
    cancelled: rows.filter((r) => r.status === "CANCELLED").length,
    noShowRate: done.length + noShows ? round2(noShows / (done.length + noShows)) : 0,
    minutesSaved,
    staff: staff
      .map((m) => {
        const s = byStaff.get(m.id) ?? { visits: 0, revenue: 0 };
        const pct = m.commissionPercent == null ? null : Number(m.commissionPercent);
        return {
          staffId: m.id,
          name: m.name,
          visits: s.visits,
          revenue: round2(s.revenue),
          commissionPercent: pct,
          commission: round2(pct == null ? 0 : (s.revenue * pct) / 100),
        };
      })
      .filter((m) => m.visits > 0 || m.commissionPercent != null),
    topServices: [...byService.values()]
      .map((v) => ({ ...v, revenue: round2(v.revenue) }))
      .sort((a, b) => b.visits - a.visits || b.revenue - a.revenue)
      .slice(0, 10),
  };
}
