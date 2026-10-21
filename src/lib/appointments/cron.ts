import { prisma } from "../db";
import { addDays, dayBounds, toLocal } from "./time";
import { isAutoNoShow, rebookDue, reminderDue, templateVars, REBOOK_GRACE_DAYS } from "./rules";
import { loadApptTenant, type ApptTenant } from "./tenant";
import { TenantMessenger } from "./messaging";
import { checkStaffDelay } from "./delay";

/**
 * مهمة الكنس (القاعدة ٨) — تذكير، غياب تلقائي، تأخير، عودة.
 *
 * آمنة للتكرار: تُستدعى يومياً من Vercel وكل ٥ دقائق من خدمة خارجية، وقد
 * تتداخل دورتان. كل إرسال يُحجز بختم وقته (reminderSentAt…) بشرط أنه فارغ
 * قبل أن نكلّم Meta، فالدورة الثانية لا تجد ما ترسله. أي فشل يُسجَّل
 * ويُتخطّى: متجر واحد معطوب لا يوقف تذكيرات البقية.
 *
 * «مرة على الأكثر» لا «مرة على الأقل»: رسالة فُقدت أهون من تذكير مكرّر
 * يصل العميل ثلاث مرات فيحظر الرقم.
 */

export type TenantCronResult = {
  tenantId: string;
  noShows: number;
  delays: number;
  reminders: number;
  rebooks: number;
  errors: string[];
};

const DAY = 86400_000;

/** المتاجر المفعّلة وحدها — متجر بلا الوحدة لا يكلّف المهمة استعلاماً واحداً. */
export async function runAppointmentsCron(now = new Date()): Promise<TenantCronResult[]> {
  const tenants = await prisma.tenant.findMany({
    where: { appointmentsEnabled: true, status: "ACTIVE" },
    select: { id: true },
  });
  const out: TenantCronResult[] = [];
  for (const { id } of tenants) {
    try {
      out.push(await runForTenant(await loadApptTenant(id), now));
    } catch (err) {
      console.error(`[appointments] فشل كنس المتجر ${id}:`, err);
      out.push({ tenantId: id, noShows: 0, delays: 0, reminders: 0, rebooks: 0, errors: ["tenant"] });
    }
  }
  return out;
}

async function step(r: TenantCronResult, name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[appointments] ${name} — ${r.tenantId}:`, err);
    r.errors.push(name);
  }
}

export async function runForTenant(t: ApptTenant, now: Date): Promise<TenantCronResult> {
  const r: TenantCronResult = { tenantId: t.id, noShows: 0, delays: 0, reminders: 0, rebooks: 0, errors: [] };
  const messenger = new TenantMessenger(t.id);
  const s = t.settings;

  // ── الغياب التلقائي — قبل التأخير: موعد غاب صاحبه لا يؤخّر من بعده ──
  await step(r, "noShow", async () => {
    const rows = await prisma.appointment.findMany({
      where: {
        tenantId: t.id,
        status: { in: ["BOOKED", "CONFIRMED"] },
        // نافذة أسبوع: أقدم من ذلك فاته الكنس لعطل، ولا يُغيَّب بأثر رجعي بعيد
        startAt: { lt: now, gte: new Date(now.getTime() - 7 * DAY) },
      },
      select: { id: true, status: true, startAt: true, plannedMinutes: true, customerId: true },
    });
    for (const a of rows.filter((x) => isAutoNoShow(x, now, s.autoNoShowMinutes))) {
      const done = await prisma.$transaction(async (tx) => {
        const res = await tx.appointment.updateMany({
          where: { id: a.id, tenantId: t.id, status: a.status },
          data: { status: "NO_SHOW" },
        });
        if (res.count === 0) return false;
        await tx.customer.updateMany({
          where: { id: a.customerId, tenantId: t.id },
          data: { noShowCount: { increment: 1 } },
        });
        return true;
      });
      if (done) r.noShows++;
    }
  });

  // ── التأخير — لكل مقدّم خدمة عنده موعد حيّ اليوم ──
  await step(r, "delay", async () => {
    const { start, end } = dayBounds(toLocal(now, t.timezone).date, t.timezone);
    const staff = await prisma.appointment.findMany({
      where: {
        tenantId: t.id,
        status: { in: ["BOOKED", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { gte: new Date(start.getTime() - DAY), lt: end },
      },
      select: { staffId: true },
      distinct: ["staffId"],
    });
    for (const { staffId } of staff) {
      if ((await checkStaffDelay(t, staffId, now, messenger)) === "notified") r.delays++;
    }
  });

  // ── التذكير بمواعيد الغد ──
  // نص حرّ إن كانت نافذة العميل مفتوحة، وإلا القالب. كان التذكير كله يُتخطّى
  // بلا قالب مضبوط — فلا يصل شيء حتى لمن راسل المتجر قبل ساعات ونافذته مفتوحة.
  await step(r, "reminder", async () => {
    const local = toLocal(now, t.timezone);
    if (!reminderDue(local.minutes, s.reminderHour)) return;
    const { start, end } = dayBounds(addDays(local.date, 1), t.timezone);
    const rows = await prisma.appointment.findMany({
      where: { tenantId: t.id, status: "BOOKED", reminderSentAt: null, startAt: { gte: start, lt: end } },
      select: {
        id: true,
        customerId: true,
        startAt: true,
        notes: true,
        customer: { select: { name: true } },
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
      orderBy: { startAt: "asc" },
    });

    // رسالة واحدة لكل عميل بكل مواعيده: ثلاث رسائل متتالية لنفس الشخص إزعاج
    const byCustomer = new Map<string, typeof rows>();
    for (const a of rows) byCustomer.set(a.customerId, [...(byCustomer.get(a.customerId) ?? []), a]);

    for (const [customerId, list] of byCustomer) {
      const claimed: typeof rows = [];
      for (const a of list) {
        const c = await prisma.appointment.updateMany({
          where: { id: a.id, tenantId: t.id, reminderSentAt: null, status: "BOOKED" },
          data: { reminderSentAt: now },
        });
        if (c.count === 1) claimed.push(a);
      }
      if (claimed.length === 0) continue;

      const first = claimed[0];
      const l = toLocal(first.startAt, t.timezone);
      const line = (a: (typeof rows)[number]) =>
        `${toLocal(a.startAt, t.timezone).time} — ${a.service.name} مع ${a.staff.name}` +
        (a.notes?.startsWith("الحجز لـ") ? ` (${a.notes})` : "");
      const name = first.customer.name;
      const text =
        `${name ? `أهلاً ${name}، ` : ""}` +
        (claimed.length === 1
          ? `تذكير بموعدك بكرا: ${line(first)}.`
          : `تذكير بمواعيدك بكرا:\n${claimed.map((a) => `• ${line(a)}`).join("\n")}`) +
        `\nللتأكيد ردّ «تأكيد»، ولو بدك تلغي أو تأجّل خبّرنا.`;

      const outcome = await messenger.send({
        customerId,
        text,
        template: {
          name: s.reminderTemplate,
          vars: (n) =>
            templateVars(
              { customer: name ?? "", service: first.service.name, time: l.time, date: l.date, staff: first.staff.name },
              n,
            ),
        },
        now,
      });
      if (outcome === "sent" || outcome === "unknown") r.reminders += claimed.length;
      // لا نافذة ولا قالب: يُعاد الحجز فتُحاوَل الدورة القادمة (قالب ضُبط، أو راسل العميل)
      if (outcome === "skipped") {
        await prisma.appointment.updateMany({
          where: { id: { in: claimed.map((a) => a.id) }, tenantId: t.id, reminderSentAt: now },
          data: { reminderSentAt: null },
        });
      }
    }
  });

  // ── العودة ──
  await step(r, "rebook", async () => {
    const services = await prisma.service.findMany({
      where: { tenantId: t.id, rebookAfterDays: { not: null } },
      select: { id: true, rebookAfterDays: true },
    });
    if (services.length === 0) return;
    const maxDays = Math.max(...services.map((x) => x.rebookAfterDays!));
    const rows = await prisma.appointment.findMany({
      where: {
        tenantId: t.id,
        status: "DONE",
        rebookSentAt: null,
        serviceId: { in: services.map((x) => x.id) },
        finishedAt: { gte: new Date(now.getTime() - (maxDays + REBOOK_GRACE_DAYS) * DAY) },
      },
      select: {
        id: true,
        customerId: true,
        serviceId: true,
        finishedAt: true,
        rebookSentAt: true,
        customer: { select: { name: true } },
        service: { select: { name: true, rebookAfterDays: true } },
        staff: { select: { name: true } },
      },
    });
    if (rows.length === 0) return;

    const customerIds = [...new Set(rows.map((x) => x.customerId))];
    const [upcoming, visits] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          tenantId: t.id,
          customerId: { in: customerIds },
          status: { in: ["BOOKED", "CONFIRMED"] },
          startAt: { gte: now },
        },
        select: { customerId: true },
        distinct: ["customerId"],
      }),
      prisma.appointment.findMany({
        where: { tenantId: t.id, customerId: { in: customerIds }, status: "DONE" },
        select: { customerId: true, serviceId: true, finishedAt: true },
      }),
    ]);
    const hasUpcoming = new Set(upcoming.map((x) => x.customerId));

    for (const a of rows) {
      const due = rebookDue({
        finishedAt: a.finishedAt!,
        rebookAfterDays: a.service.rebookAfterDays,
        rebookSentAt: a.rebookSentAt,
        hasUpcoming: hasUpcoming.has(a.customerId),
        hasLaterVisitSameService: visits.some(
          (v) =>
            v.customerId === a.customerId &&
            v.serviceId === a.serviceId &&
            v.finishedAt != null &&
            v.finishedAt > a.finishedAt!,
        ),
        now,
      });
      if (!due) continue;
      const claim = await prisma.appointment.updateMany({
        where: { id: a.id, tenantId: t.id, rebookSentAt: null },
        data: { rebookSentAt: now },
      });
      if (claim.count === 0) continue;
      const l = toLocal(a.finishedAt!, t.timezone);
      const outcome = await messenger.send({
        customerId: a.customerId,
        text:
          `${a.customer.name ? `أهلاً ${a.customer.name}، ` : ""}صار وقت ${a.service.name} من جديد 🙂 ` +
          `آخر مرة كانت بتاريخ ${l.date} مع ${a.staff.name}. ` +
          `بتحب نحجزلك موعد؟ قلّنا اليوم والوقت اللي بناسبك.`,
        template: {
          name: s.rebookTemplate,
          vars: (n) =>
            templateVars(
              { customer: a.customer.name ?? "", service: a.service.name, time: l.time, date: l.date, staff: a.staff.name },
              n,
            ),
        },
        now,
      });
      if (outcome === "sent" || outcome === "unknown") r.rebooks++;
      if (outcome === "skipped") {
        await prisma.appointment.updateMany({
          where: { id: a.id, tenantId: t.id, rebookSentAt: now },
          data: { rebookSentAt: null },
        });
      }
    }
  });

  return r;
}
