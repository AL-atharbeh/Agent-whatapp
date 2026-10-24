import { after } from "next/server";
import { prisma } from "../db";
import { beginAppointment, staffAppointments, toBusy, type AppointmentView } from "./booking";
import { delayDecision, templateVars, type DayAppt } from "./rules";
import { dayBounds, spokenTime, toLocal } from "./time";
import { loadApptTenant, type ApptTenant } from "./tenant";
import { TenantMessenger } from "./messaging";

/**
 * التأخير المتسلسل (القاعدة ٧): العميل التالي يعرف قبل أن يصل أنه سينتظر.
 *
 * يُفحص عند «بدأت» (البدء المتأخر هو لحظة اكتشاف التأخير) وفي مهمة الكنس.
 * delayNotifiedAt يُحجز قبل الإرسال بشرط أنه فارغ: الفحصان قد يتزامنان،
 * والعميل لا يجب أن يصله اعتذاران عن نفس التأخير.
 */
export async function checkStaffDelay(
  t: ApptTenant,
  staffId: string,
  now = new Date(),
  messenger = new TenantMessenger(t.id),
): Promise<"notified" | "none" | "skipped"> {
  const today = toLocal(now, t.timezone).date;
  const { start, end } = dayBounds(today, t.timezone);
  const rows = await staffAppointments(prisma, t.id, [staffId], start, end);
  const appts: DayAppt[] = rows.map((r) => ({ ...toBusy(r), id: r.id, delayNotifiedAt: r.delayNotifiedAt }));

  const d = delayDecision(appts, now, t.settings.delayNotifyMinutes);
  if (!d.notify) return "none";

  const claim = await prisma.appointment.updateMany({
    where: { id: d.appointmentId, tenantId: t.id, delayNotifiedAt: null, status: { in: ["BOOKED", "CONFIRMED"] } },
    data: { delayNotifiedAt: now },
  });
  if (claim.count === 0) return "none";

  const appt = await prisma.appointment.findFirst({
    where: { id: d.appointmentId, tenantId: t.id },
    select: {
      customerId: true,
      startAt: true,
      customer: { select: { name: true } },
      service: { select: { name: true } },
      staff: { select: { name: true } },
    },
  });
  if (!appt) return "none";

  const expected = toLocal(d.expectedStart, t.timezone).time;
  const local = toLocal(appt.startAt, t.timezone);
  const outcome = await messenger.send({
    customerId: appt.customerId,
    // نص محايد لا يفترض نوع النشاط: يصلح لعيادة ومركز صيانة وصالون
    text:
      `${appt.customer.name ? `أهلاً ${appt.customer.name}، ` : ""}نعتذر منك، عندنا تأخير حوالي ` +
      `${minutesPhrase(d.delayMinutes)} على موعدك (${appt.service.name} الساعة ${spokenTime(local.time)}). ` +
      `الوقت المتوقّع ${spokenTime(expected)}. شكراً لصبرك 🙏`,
    template: {
      name: t.settings.delayTemplate,
      vars: (n) =>
        templateVars(
          {
            customer: appt.customer.name ?? "",
            service: appt.service.name,
            time: expected,
            date: local.date,
            staff: appt.staff.name,
          },
          n,
        ),
    },
    now,
  });
  return outcome === "skipped" ? "skipped" : "notified";
}

/**
 * يجدول فحص التأخير بعد الرد ولا ينتظره: زرّ «بدأت» لا يجب أن ينتظر
 * نداء Meta. داخل طلب ⇒ after()، خارجه ⇒ بلا انتظار. ولا استثناء يصل للمنادي.
 */
export function scheduleDelayCheck(tenantId: string, staffId: string) {
  const task = async () => {
    try {
      const t = await loadApptTenant(tenantId);
      if (!t.appointmentsEnabled || t.status !== "ACTIVE") return;
      await checkStaffDelay(t, staffId);
    } catch (err) {
      console.error("[appointments] فشل فحص التأخير:", err);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/** «بدأت» + فحص التأخير المتسلسل (القاعدة ٥ و٧). */
export async function startAppointment(tenantId: string, id: string): Promise<AppointmentView> {
  const a = await beginAppointment(tenantId, id);
  scheduleDelayCheck(tenantId, a.staffId);
  return a;
}

/** «١٠ دقائق»، «٩٠ دقيقة» — العدد بأرقام المحادثة وتمييزه كما يُقال. */
function minutesPhrase(n: number): string {
  const digits = String(n).replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[Number(x)]);
  return `${digits} ${n >= 3 && n <= 10 ? "دقائق" : "دقيقة"}`;
}
