import { z } from "zod";
import type { Channel, Customer } from "@prisma/client";
import { prisma } from "../db";
import type { TenantContext } from "../tenancy";
import type { AgentTool, RunState } from "./tools";
import {
  AppointmentError,
  bookAppointment,
  cancelAppointment,
  completeIdentity,
  confirmAppointment,
  estimateMinutes,
  findSlots,
  formatLocal,
  getAppointment,
  listServices,
  listStaff,
  addDays,
  minutesOf,
  parseLocal,
  rescheduleAppointment,
  sourceOfChannel,
  toLocal,
  upcomingFor,
  upsertCustomerFromContact,
} from "../appointments";

/**
 * أدوات الحجز للوكيل — تُبنى فقط لمتجر فعّل وحدة المواعيد (انظر tools.ts).
 *
 * العميل **دائماً** صاحب المحادثة: لا أداة تقبل معرّف عميل من النموذج. ولو
 * «هلوس» النموذج معرّف موعد لعميل آخر، تجده الأداة لغير صاحب المحادثة
 * فتردّه كغير موجود — فلا يُلغي عميلٌ موعد غيره بجملة ذكية.
 *
 * الأوقات بصيغة «YYYY-MM-DD HH:MM» بتوقيت المتجر في الاتجاهين: النموذج يخطئ
 * في تحويل المناطق الزمنية، وخطأ ثلاث ساعات هنا موعدٌ في غير وقته.
 *
 * الأوصاف قصيرة عمداً: كل تعريف أداة يُرسَل مع كل رسالة.
 */

function defineTool<S extends z.ZodType>(t: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): AgentTool {
  return t as unknown as AgentTool;
}

const ID = z.string().min(1).max(64);
const LOCAL = z.string().describe("YYYY-MM-DD HH:MM بتوقيت المتجر");
const out = (o: unknown) => JSON.stringify(o);

function failure(err: unknown) {
  if (err instanceof AppointmentError) {
    return out({
      ok: false,
      code: err.code,
      reason:
        err.code === "SLOT_TAKEN"
          ? "الوقت لم يعد متاحاً. استدعِ find_slots واقترح غيره."
          : err.message,
    });
  }
  console.error("[agent] أداة مواعيد:", err);
  return out({ ok: false, reason: "تعذّر الآن. اعرض التحويل لموظف." });
}

/**
 * «اليوم/أمس/بكرا…» للتاريخ محسوباً هنا لا في النموذج.
 *
 * من تاريخ خام يحسب النموذج اليوم بنفسه ويخطئ، خاصة حين يحمل تاريخ
 * المحادثة «بكرا» من رسالة الأمس: قال عن صبغة انتهت قبل ساعة إنها
 * «بكرا ولسّا ما صارت».
 */
function dayWord(date: string, today: string): string {
  if (date === today) return "اليوم";
  if (date === addDays(today, -1)) return "أمس";
  if (date === addDays(today, 1)) return "بكرا";
  if (date === addDays(today, 2)) return "بعد بكرا";
  return date < today ? "سابقاً" : "لاحقاً";
}

/** دقائق اليوم من «YYYY-MM-DD HH:MM» */
const minutesOfLocal = (local: string) => minutesOf(local.slice(11));

export function buildAppointmentTools(args: {
  tenant: TenantContext;
  channel: Channel;
  externalUserId: string;
  state: RunState;
}): AgentTool[] {
  const { tenant, channel, externalUserId, state } = args;
  const source = sourceOfChannel(channel);
  if (!source) return [];
  const tz = tenant.timezone;

  const log = (name: string, input: unknown, summary: string) =>
    state.toolCalls.push({ name, input, summary });

  // العميل يُحمَّل مرة في الدورة: أغلب الأدوات تحتاجه، ولا داعي لجولة لكل واحدة
  let me: Promise<Customer> | null = null;
  const customer = () => (me ??= upsertCustomerFromContact(tenant.id, { channel, externalUserId }));

  /** موعد لهذا العميل وحده — غيره يُعامل كغير موجود */
  const mine = async (id: string) => {
    const c = await customer();
    const a = await getAppointment(tenant.id, id);
    if (a.customerId !== c.id) throw new AppointmentError("NOT_FOUND", "الموعد غير موجود");
    return a;
  };

  const today = () => toLocal(new Date(), tz).date;

  const brief = (a: Awaited<ReturnType<typeof getAppointment>>) => ({
    id: a.id,
    day: dayWord(a.local.date, today()),
    service: a.service.name,
    with: a.staff.name,
    start: `${a.local.date} ${a.local.time}`,
    minutes: a.plannedMinutes,
    status: a.status,
  });

  const listServicesTool = defineTool({
    name: "list_services",
    description: "الخدمات بأسعارها ومدتها لهذا العميل، والفريق ومن يقدّم ماذا.",
    schema: z.object({}),
    run: async () => {
      try {
        const [c, services, team] = await Promise.all([customer(), listServices(tenant.id), listStaff(tenant.id)]);
        const minutes = await Promise.all(
          services.map((s) => estimateMinutes(tenant.id, { serviceId: s.id, customerId: c.id })),
        );
        log("list_services", {}, `${services.length} خدمة`);
        return out({
          customer_name: c.name,
          customer_phone_known: !!c.phone,
          preferred_staff_id: c.preferredStaffId,
          services: services.map((s, i) => ({
            id: s.id,
            name: s.name,
            price_from: s.priceMin,
            price_to: s.priceMax,
            minutes: minutes[i].minutes,
          })),
          team: team.map((t) => ({ id: t.id, name: t.name, service_ids: t.serviceIds })),
          currency: tenant.currency,
        });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const findSlotsTool = defineTool({
    name: "find_slots",
    description:
      "حتى ٦ أوقات متاحة لخدمة في يوم. staff_id اختياري. إن طلب العميل ساعة بعينها فمرّرها في time لتعود الأوقات الأقرب لها، وrequested_available يقول إن كانت هي نفسها متاحة.",
    schema: z.object({
      service_id: ID,
      date: z.string().describe("YYYY-MM-DD"),
      time: z.string().optional().describe("HH:MM بتوقيت المتجر"),
      staff_id: ID.optional(),
      day_part: z.enum(["morning", "afternoon", "evening"]).optional(),
    }),
    run: async (input) => {
      try {
        const c = await customer();
        const slots = await findSlots(tenant.id, {
          serviceId: input.service_id,
          date: input.date,
          staffId: input.staff_id,
          customerId: c.id,
          dayPart: input.day_part,
          near: input.time,
          limitPerStaff: 6,
        });
        // المفضّل لدى العميل أولاً، ثم الأبكر — دون أن يحتكر المفضّل القائمة
        const pref = c.preferredStaffId;
        const ordered = pref
          ? [...slots.filter((s) => s.staffId === pref).slice(0, 3), ...slots.filter((s) => s.staffId !== pref)]
          : slots;
        // مع وقت مطلوب: الأقرب له عبر الفريق كله، لا الأبكر — ثم يُعرض بترتيب الوقت
        const gap = (s: (typeof slots)[number]) =>
          input.time ? Math.abs(minutesOfLocal(s.local) - minutesOf(input.time)) : 0;
        const picked = (input.time ? [...ordered].sort((a, b) => gap(a) - gap(b)) : ordered)
          .slice(0, 6)
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
        log("find_slots", input, `${picked.length} وقت`);
        if (picked.length === 0) {
          return out({ found: 0, note: "لا أوقات متاحة في هذا اليوم. اقترح يوماً آخر." });
        }
        return out({
          found: picked.length,
          ...(input.time ? { requested_available: picked.some((s) => gap(s) === 0) } : {}),
          slots: picked.map((s) => ({
            staff_id: s.staffId,
            staff_name: s.staffName,
            start: s.local,
            minutes: s.minutes,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const book = defineTool({
    name: "book_appointment",
    description: "يحجز. فقط بعد «نعم» صريحة من العميل على الخدمة والوقت ومقدّم الخدمة.",
    schema: z.object({
      service_id: ID,
      staff_id: ID,
      start: LOCAL,
      for_name: z.string().max(60).optional().describe("اسم الشخص إن كان الحجز لغير صاحب المحادثة"),
      customer_name: z.string().max(60).optional().describe("اسم العميل نفسه إن لم يكن معروفاً"),
      customer_phone: z.string().max(30).optional().describe("رقم هاتف العميل إن لم يكن معروفاً"),
    }),
    run: async (input) => {
      try {
        const startAt = parseLocal(input.start, tz);
        if (!startAt) return out({ ok: false, reason: "صيغة الوقت YYYY-MM-DD HH:MM" });
        let c = await customer();

        // موعد بلا اسم ولا رقم لا يعرف الفريق من صاحبه ولا كيف يصله.
        // المكالمة من رقم مخفي (أو من المتصفح) لا رقم لها، فيُسأل عنه
        const missing = [
          !c.name && !input.customer_name?.trim() ? "الاسم" : null,
          !c.phone && channel === "VOICE" && !input.customer_phone?.trim() ? "رقم الهاتف" : null,
        ].filter(Boolean);
        if (missing.length) {
          return out({
            ok: false,
            code: "NEED_DETAILS",
            reason: `اسأل العميل عن ${missing.join(" و")} ثم أعد الحجز ممرّراً customer_name وcustomer_phone.`,
          });
        }
        if (input.customer_name?.trim() || input.customer_phone?.trim()) {
          c = await completeIdentity(tenant.id, c, { name: input.customer_name, phone: input.customer_phone });
        }
        const a = await bookAppointment(tenant.id, {
          customerId: c.id,
          serviceId: input.service_id,
          staffId: input.staff_id,
          startAt,
          source,
          // يظهر في بطاقة الموعد فيعرف الفريق من القادم فعلاً
          notes: input.for_name?.trim() ? `الحجز لـ ${input.for_name.trim()}` : null,
        });
        log("book_appointment", input, "تم الحجز");
        return out({ ok: true, appointment: brief(a), note: "أعد تأكيد التفاصيل للعميل." });
      } catch (err) {
        log("book_appointment", input, "فشل الحجز");
        return failure(err);
      }
    },
  });

  const myAppointments = defineTool({
    name: "my_appointments",
    description: "مواعيد العميل القادمة.",
    schema: z.object({}),
    run: async () => {
      try {
        const c = await customer();
        const list = await upcomingFor(tenant.id, c.id);
        log("my_appointments", {}, `${list.length} موعد`);
        return out({ appointments: list.map(brief) });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const confirm = defineTool({
    name: "confirm_appointment",
    description: "يؤكّد موعداً للعميل (ردّه على التذكير بـ«تأكيد»).",
    schema: z.object({ id: ID }),
    run: async (input) => {
      try {
        await mine(input.id);
        const a = await confirmAppointment(tenant.id, input.id);
        log("confirm_appointment", input, "تأكيد");
        return out({ ok: true, appointment: brief(a) });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const cancel = defineTool({
    name: "cancel_appointment",
    description: "يلغي موعداً للعميل. فقط بعد «نعم» صريحة.",
    schema: z.object({ id: ID }),
    run: async (input) => {
      try {
        await mine(input.id);
        const a = await cancelAppointment(tenant.id, input.id);
        log("cancel_appointment", input, "إلغاء");
        return out({ ok: true, appointment: brief(a) });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const reschedule = defineTool({
    name: "reschedule_appointment",
    description: "ينقل موعداً لوقت آخر (من find_slots). فقط بعد «نعم» صريحة.",
    schema: z.object({ id: ID, start: LOCAL, staff_id: ID.optional() }),
    run: async (input) => {
      try {
        const startAt = parseLocal(input.start, tz);
        if (!startAt) return out({ ok: false, reason: "صيغة الوقت YYYY-MM-DD HH:MM" });
        await mine(input.id);
        const a = await rescheduleAppointment(tenant.id, input.id, { startAt, staffId: input.staff_id });
        log("reschedule_appointment", input, "نقل");
        return out({ ok: true, appointment: brief(a) });
      } catch (err) {
        return failure(err);
      }
    },
  });

  const history = defineTool({
    name: "my_history",
    description: "آخر زيارات العميل: الخدمة، التاريخ، مقدّم الخدمة، ملاحظات الزيارة.",
    schema: z.object({}),
    run: async () => {
      try {
        const c = await customer();
        const rows = await prisma.appointment.findMany({
          where: { tenantId: tenant.id, customerId: c.id, status: "DONE" },
          orderBy: { finishedAt: "desc" },
          take: 5,
          select: {
            startAt: true,
            notes: true,
            service: { select: { name: true } },
            staff: { select: { name: true } },
          },
        });
        log("my_history", {}, `${rows.length} زيارة`);
        return out({
          visits: rows.map((r) => ({
            service: r.service.name,
            // بالساعة لا باليوم وحده: «موعد ٣:١٥» في رسالة سابقة يجب أن يُطابَق بزيارته
            start: formatLocal(r.startAt, tz),
            day: dayWord(toLocal(r.startAt, tz).date, today()),
            with: r.staff.name,
            notes: r.notes,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  });

  return [listServicesTool, findSlotsTool, book, myAppointments, confirm, cancel, reschedule, history];
}
