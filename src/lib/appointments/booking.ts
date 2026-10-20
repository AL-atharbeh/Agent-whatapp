import { Prisma, type AppointmentSource, type Channel } from "@prisma/client";
import { prisma } from "../db";
import { AppointmentError, invalid, notFound } from "./errors";
import {
  CUSTOMER_SAMPLES,
  STAFF_SAMPLES,
  actualMinutesOf,
  busyIntervals,
  canTransition,
  estimateFrom,
  fits,
  parseWorkingHours,
  processingGap,
  slotsIn,
  spanOf,
  withinWindows,
  workingWindows,
  type Action,
  type BusySource,
  type Estimate,
  type Interval,
  type Processing,
} from "./rules";
import { dayBounds, formatLocal, isDateStr, toLocal } from "./time";
import { loadApptTenant, type ApptTenant } from "./tenant";
import { listServices, listStaff, type ServiceView, type StaffView } from "./catalog";

/**
 * الحجز ودورة الموعد — كل ما يكتب في Appointment يمر من هنا.
 *
 * اللوحة والجوال والوكيل والمهام المجدولة تستدعي نفس الدوال: قاعدة واحدة
 * للتداخل والانتقالات، بدل أربع نسخ تختلف في حالة حدّية واحدة فيُحجز نفس
 * الوقت مرتين.
 */

const MIN = 60_000;
const ACTIVE_STATUSES = ["BOOKED", "CONFIRMED", "IN_PROGRESS", "DONE"] as const;

// ═══════════════════════════════════════════════════════════
//  العرض
// ═══════════════════════════════════════════════════════════

const apptInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  staff: { select: { id: true, name: true } },
  service: {
    select: {
      id: true,
      name: true,
      category: true,
      priceMin: true,
      priceMax: true,
      defaultMinutes: true,
      processingAfterMinutes: true,
      processingMinutes: true,
      rebookAfterDays: true,
      active: true,
    },
  },
} as const;
type ApptRow = Prisma.AppointmentGetPayload<{ include: typeof apptInclude }>;

export type AppointmentView = {
  id: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  customer: { id: string; name: string | null; phone: string | null };
  staff: { id: string; name: string };
  service: {
    id: string;
    name: string;
    category: string | null;
    priceMin: number;
    priceMax: number | null;
    defaultMinutes: number;
    processingAfterMinutes: number;
    processingMinutes: number;
  };
  startAt: string;
  endAt: string;
  /** بتوقيت المتجر — للعرض دون أن يحسب الجهاز التوقيت بساعته */
  local: { date: string; time: string };
  plannedMinutes: number;
  /** فترة الانتظار داخل الخدمة إن وُجدت — تُرسم مخطّطة في اليوم */
  processing: { startAt: string; endAt: string } | null;
  status: ApptRow["status"];
  source: ApptRow["source"];
  startedAt: string | null;
  finishedAt: string | null;
  actualMinutes: number | null;
  finalPrice: number | null;
  notes: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;
const procOf = (s: { processingAfterMinutes: number; processingMinutes: number }): Processing => ({
  afterMinutes: s.processingAfterMinutes,
  minutes: s.processingMinutes,
});

export function toAppointmentView(a: ApptRow, tz: string, now = new Date()): AppointmentView {
  const span = spanOf(toBusy(a), now) ?? {
    start: a.startAt,
    end: new Date(a.startAt.getTime() + a.plannedMinutes * MIN),
  };
  const gap = processingGap(span, procOf(a.service));
  const l = toLocal(a.startAt, tz);
  return {
    id: a.id,
    customerId: a.customerId,
    staffId: a.staffId,
    serviceId: a.serviceId,
    customer: a.customer,
    staff: a.staff,
    service: {
      id: a.service.id,
      name: a.service.name,
      category: a.service.category,
      priceMin: Number(a.service.priceMin),
      priceMax: a.service.priceMax == null ? null : Number(a.service.priceMax),
      defaultMinutes: a.service.defaultMinutes,
      processingAfterMinutes: a.service.processingAfterMinutes,
      processingMinutes: a.service.processingMinutes,
    },
    startAt: a.startAt.toISOString(),
    endAt: new Date(a.startAt.getTime() + a.plannedMinutes * MIN).toISOString(),
    local: { date: l.date, time: l.time },
    plannedMinutes: a.plannedMinutes,
    processing: gap ? { startAt: gap.start.toISOString(), endAt: gap.end.toISOString() } : null,
    status: a.status,
    source: a.source,
    startedAt: iso(a.startedAt),
    finishedAt: iso(a.finishedAt),
    actualMinutes: a.actualMinutes,
    finalPrice: a.finalPrice == null ? null : Number(a.finalPrice),
    notes: a.notes,
    confirmedAt: iso(a.confirmedAt),
    cancelledAt: iso(a.cancelledAt),
  };
}

function toBusy(a: {
  status: ApptRow["status"];
  startAt: Date;
  plannedMinutes: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  service: { processingAfterMinutes: number; processingMinutes: number };
  id?: string;
}): BusySource {
  return {
    id: a.id,
    status: a.status,
    startAt: a.startAt,
    plannedMinutes: a.plannedMinutes,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    processing: procOf(a.service),
  };
}

async function loadAppointment(tenantId: string, id: string): Promise<ApptRow> {
  const a = await prisma.appointment.findFirst({ where: { id, tenantId }, include: apptInclude });
  if (!a) throw notFound("الموعد");
  return a;
}

export async function getAppointment(tenantId: string, id: string): Promise<AppointmentView> {
  const t = await loadApptTenant(tenantId);
  return toAppointmentView(await loadAppointment(tenantId, id), t.timezone);
}

// ═══════════════════════════════════════════════════════════
//  ١. المقدِّر
// ═══════════════════════════════════════════════════════════

/** عيّنات المدة الفعلية — الأحدث أولاً، من الزيارات المكتملة وحدها. */
async function samples(where: Prisma.AppointmentWhereInput, take: number): Promise<number[]> {
  const rows = await prisma.appointment.findMany({
    where: { ...where, status: "DONE", actualMinutes: { not: null } },
    select: { actualMinutes: true },
    orderBy: { finishedAt: "desc" },
    take,
  });
  return rows.map((r) => r.actualMinutes!);
}

/**
 * مدة هذا الموعد لهذا العميل: تاريخه هو ⇐ تاريخ مقدّم الخدمة ⇐ الافتراضي.
 * بلا staffId ⇒ يتخطّى المستوى الثاني (لا مقدّم بعينه بعد).
 */
export async function estimateMinutes(
  tenantId: string,
  args: { serviceId: string; staffId?: string | null; customerId?: string | null },
): Promise<Estimate> {
  const service = await prisma.service.findFirst({
    where: { id: args.serviceId, tenantId },
    select: { defaultMinutes: true },
  });
  if (!service) throw notFound("الخدمة");
  const [c, s] = await Promise.all([
    args.customerId
      ? samples({ tenantId, serviceId: args.serviceId, customerId: args.customerId }, CUSTOMER_SAMPLES)
      : Promise.resolve([]),
    args.staffId
      ? samples({ tenantId, serviceId: args.serviceId, staffId: args.staffId }, STAFF_SAMPLES)
      : Promise.resolve([]),
  ]);
  return estimateFrom(c, s, service.defaultMinutes);
}

// ═══════════════════════════════════════════════════════════
//  ٢–٣. الانشغال والأوقات
// ═══════════════════════════════════════════════════════════

/**
 * مواعيد مقدّمي خدمة تمسّ فترة — بنافذة خلفية يوم كامل: جلسة بدأت أمس
 * مساءً وما زالت جارية تشغل صباح اليوم، واستعلام «ما بدأ اليوم» لا يراها.
 */
async function staffAppointments(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  staffIds: string[],
  from: Date,
  to: Date,
  excludeId?: string,
) {
  return db.appointment.findMany({
    where: {
      tenantId,
      staffId: { in: staffIds },
      status: { in: [...ACTIVE_STATUSES] },
      startAt: { gte: new Date(from.getTime() - 86400_000), lt: to },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      staffId: true,
      status: true,
      startAt: true,
      plannedMinutes: true,
      startedAt: true,
      finishedAt: true,
      delayNotifiedAt: true,
      customerId: true,
      service: { select: { processingAfterMinutes: true, processingMinutes: true } },
    },
  });
}

export type Slot = {
  staffId: string;
  staffName: string;
  startAt: Date;
  /** «YYYY-MM-DD HH:MM» بتوقيت المتجر */
  local: string;
  minutes: number;
  estimate: Estimate;
};

export type DayPart = "morning" | "afternoon" | "evening";

/** صباحاً قبل ١٢، بعد الظهر ١٢–١٧، مساءً من ١٧ — بتوقيت المتجر. */
export function inDayPart(localMinutes: number, part: DayPart): boolean {
  if (part === "morning") return localMinutes < 12 * 60;
  if (part === "afternoon") return localMinutes >= 12 * 60 && localMinutes < 17 * 60;
  return localMinutes >= 17 * 60;
}

/**
 * الأوقات المتاحة لخدمة في يوم محلّي، لكل مقدّم خدمة يقدّمها.
 *
 * المدة تُقدَّر لكل مقدّم خدمة على حدة: العميل نفسه قد يحتاج ٤٠ دقيقة مع
 * أحدهم و٢٥ مع آخر أسرع — والوقت المقترح يجب أن يتّسع للمدة الحقيقية.
 */
export async function findSlots(
  tenantId: string,
  args: {
    serviceId: string;
    date: string;
    staffId?: string | null;
    customerId?: string | null;
    dayPart?: DayPart | null;
    limitPerStaff?: number;
    now?: Date;
  },
): Promise<Slot[]> {
  if (!isDateStr(args.date)) throw invalid("التاريخ بصيغة YYYY-MM-DD");
  const t = await loadApptTenant(tenantId);
  const now = args.now ?? new Date();

  const service = await prisma.service.findFirst({
    where: { id: args.serviceId, tenantId, active: true },
    select: { id: true, defaultMinutes: true, processingAfterMinutes: true, processingMinutes: true },
  });
  if (!service) throw notFound("الخدمة");

  const staff = await prisma.staff.findMany({
    where: {
      tenantId,
      active: true,
      services: { some: { serviceId: service.id } },
      ...(args.staffId ? { id: args.staffId } : {}),
    },
    select: { id: true, name: true, workingHours: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (args.staffId && staff.length === 0) throw notFound("مقدّم الخدمة");
  if (staff.length === 0) return [];

  const { start, end } = dayBounds(args.date, t.timezone);
  const [appts, customerSamples, staffSamples] = await Promise.all([
    staffAppointments(prisma, tenantId, staff.map((s) => s.id), start, end),
    args.customerId
      ? samples({ tenantId, serviceId: service.id, customerId: args.customerId }, CUSTOMER_SAMPLES)
      : Promise.resolve([]),
    Promise.all(
      staff.map((s) => samples({ tenantId, serviceId: service.id, staffId: s.id }, STAFF_SAMPLES)),
    ),
  ]);

  const out: Slot[] = [];
  staff.forEach((s, i) => {
    const estimate = estimateFrom(customerSamples, staffSamples[i], service.defaultMinutes);
    const windows = workingWindows(parseWorkingHours(s.workingHours), args.date, t.timezone);
    const busy = busyIntervals(
      appts.filter((a) => a.staffId === s.id).map(toBusy),
      now,
      t.settings.bufferMinutes,
    );
    const starts = slotsIn({
      windows,
      busy,
      minutes: estimate.minutes,
      processing: procOf(service),
      bufferMinutes: t.settings.bufferMinutes,
      stepMinutes: t.settings.slotStepMinutes,
      now,
    })
      .filter((d) => !args.dayPart || inDayPart(toLocal(d, t.timezone).minutes, args.dayPart))
      .slice(0, args.limitPerStaff ?? 1000);
    for (const d of starts) {
      out.push({
        staffId: s.id,
        staffName: s.name,
        startAt: d,
        local: formatLocal(d, t.timezone),
        minutes: estimate.minutes,
        estimate,
      });
    }
  });
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export type DayView = {
  date: string;
  timezone: string;
  staff: StaffView[];
  services: ServiceView[];
  items: AppointmentView[];
};

/** يوم كامل: الفريق والخدمات والمواعيد التي تبدأ فيه (بكل حالاتها). */
export async function dayView(tenantId: string, date: string): Promise<DayView> {
  if (!isDateStr(date)) throw invalid("التاريخ بصيغة YYYY-MM-DD");
  const t = await loadApptTenant(tenantId);
  const { start, end } = dayBounds(date, t.timezone);
  const [staff, services, rows] = await Promise.all([
    listStaff(tenantId),
    listServices(tenantId),
    prisma.appointment.findMany({
      where: { tenantId, startAt: { gte: start, lt: end } },
      include: apptInclude,
      orderBy: { startAt: "asc" },
    }),
  ]);
  const now = new Date();
  return {
    date,
    timezone: t.timezone,
    staff,
    services,
    items: rows.map((r) => toAppointmentView(r, t.timezone, now)),
  };
}

// ═══════════════════════════════════════════════════════════
//  ٤. الحجز بلا تضارب
// ═══════════════════════════════════════════════════════════

/**
 * يقفل صف مقدّم الخدمة حتى نهاية المعاملة.
 *
 * محادثتا واتساب تحجزان نفس الوقت في نفس اللحظة: كلتاهما تفحص التداخل
 * فتجده فارغاً، وكلتاهما تُنشئ. القفل يجعل الثانية تنتظر الأولى ثم تفحص
 * فترى موعدها — فيرجع لها SLOT_TAKEN بدل عميلين في نفس الوقت مع نفس مقدّم الخدمة.
 */
async function lockStaff(tx: Prisma.TransactionClient, tenantId: string, staffId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Staff" WHERE id = ${staffId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("مقدّم الخدمة");
}

const SLOT_TAKEN = () =>
  new AppointmentError("SLOT_TAKEN", "هذا الوقت لم يعد متاحاً — اختر وقتاً آخر");

async function assertFree(
  tx: Prisma.TransactionClient,
  t: ApptTenant,
  staffId: string,
  start: Date,
  minutes: number,
  processing: Processing,
  excludeId?: string,
) {
  const end = new Date(start.getTime() + minutes * MIN);
  const others = await staffAppointments(tx, t.id, [staffId], start, end, excludeId);
  const busy = busyIntervals(others.map(toBusy), new Date(), t.settings.bufferMinutes);
  if (!fits({ start, minutes, processing }, busy, t.settings.bufferMinutes)) throw SLOT_TAKEN();
}

// تسامح بسيط مع «الآن»: حجز حضوري يُدخَل بعد أن جلس العميل بدقائق
const PAST_GRACE_MS = 15 * MIN;
const AGENT_SOURCES: AppointmentSource[] = ["WHATSAPP", "INSTAGRAM", "MESSENGER"];

export function sourceOfChannel(channel: Channel): AppointmentSource | null {
  return channel === "WHATSAPP" || channel === "INSTAGRAM" || channel === "MESSENGER" ? channel : null;
}

export type BookInput = {
  customerId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  source: AppointmentSource;
  plannedMinutes?: number | null;
  notes?: string | null;
};

/**
 * يحجز موعداً. الحجز من الوكيل يُلزَم بالدوام؛ من الفريق (حضوري، هاتف،
 * لوحة، تطبيق) لا — صاحب النشاط قد يستقبل عميلاً بعد الدوام عن قصد،
 * والوكيل لا يملك هذا القرار.
 */
export async function bookAppointment(tenantId: string, input: BookInput): Promise<AppointmentView> {
  const t = await loadApptTenant(tenantId);
  const now = new Date();
  if (Number.isNaN(input.startAt.getTime())) throw invalid("وقت غير صالح");
  if (input.startAt.getTime() < now.getTime() - PAST_GRACE_MS) throw invalid("لا يمكن الحجز في وقت مضى");

  const [service, staff, customer] = await Promise.all([
    prisma.service.findFirst({
      where: { id: input.serviceId, tenantId, active: true },
      select: { id: true, defaultMinutes: true, processingAfterMinutes: true, processingMinutes: true },
    }),
    prisma.staff.findFirst({
      where: { id: input.staffId, tenantId, active: true },
      select: { id: true, workingHours: true, services: { where: { serviceId: input.serviceId } } },
    }),
    prisma.customer.findFirst({ where: { id: input.customerId, tenantId }, select: { id: true } }),
  ]);
  if (!service) throw notFound("الخدمة");
  if (!staff) throw notFound("مقدّم الخدمة");
  if (!customer) throw notFound("العميل");
  if (staff.services.length === 0) throw invalid("مقدّم الخدمة هذا لا يقدّم هذه الخدمة");

  const minutes =
    input.plannedMinutes ??
    (await estimateMinutes(tenantId, {
      serviceId: service.id,
      staffId: staff.id,
      customerId: customer.id,
    })).minutes;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) throw invalid("مدة غير صالحة");

  if (AGENT_SOURCES.includes(input.source)) {
    const local = toLocal(input.startAt, t.timezone);
    const windows = workingWindows(parseWorkingHours(staff.workingHours), local.date, t.timezone);
    if (!withinWindows(input.startAt, minutes, windows)) throw SLOT_TAKEN();
  }

  const row = await prisma.$transaction(
    async (tx) => {
      await lockStaff(tx, tenantId, staff.id);
      await assertFree(tx, t, staff.id, input.startAt, minutes, procOf(service));
      return tx.appointment.create({
        data: {
          tenantId,
          customerId: customer.id,
          staffId: staff.id,
          serviceId: service.id,
          startAt: input.startAt,
          plannedMinutes: minutes,
          source: input.source,
          notes: input.notes?.trim() || null,
        },
        include: apptInclude,
      });
    },
    { timeout: 15_000 },
  );
  return toAppointmentView(row, t.timezone);
}

// ═══════════════════════════════════════════════════════════
//  ٥. دورة الموعد
// ═══════════════════════════════════════════════════════════

const STATUS_AR: Record<string, string> = {
  BOOKED: "محجوز",
  CONFIRMED: "مؤكَّد",
  IN_PROGRESS: "جارٍ",
  DONE: "منتهٍ",
  CANCELLED: "ملغى",
  NO_SHOW: "غياب",
};

function assertCan(action: Action, a: { status: ApptRow["status"] }) {
  if (!canTransition(action, a.status)) {
    throw invalid(`لا يمكن هذا الإجراء على موعد ${STATUS_AR[a.status] ?? a.status}`);
  }
}

/**
 * تحديث بشرط الحالة التي رأيناها: إجراءان متزامنان (زرّان من جهازين)
 * لا يطبّقان انتقالين متناقضين — الثاني يجد الحالة تغيّرت فيُرفض.
 */
async function transition(
  tenantId: string,
  a: ApptRow,
  data: Prisma.AppointmentUpdateManyMutationInput,
  customer?: Prisma.CustomerUpdateManyMutationInput,
) {
  // تفاعلية لا دفعة: عدّاد الزيارات أو الغياب يُزاد فقط إن طُبّق الانتقال
  // فعلاً — وإلا زاد مرتين لزرّين متزامنين والموعد انتقل مرة واحدة.
  await prisma.$transaction(async (tx) => {
    const res = await tx.appointment.updateMany({
      where: { id: a.id, tenantId, status: a.status },
      data,
    });
    if (res.count === 0) throw invalid("تغيّرت حالة الموعد للتو — حدّث الصفحة");
    if (customer) {
      await tx.customer.updateMany({ where: { id: a.customerId, tenantId }, data: customer });
    }
  });
}

async function view(tenantId: string, id: string) {
  const t = await loadApptTenant(tenantId);
  return toAppointmentView(await loadAppointment(tenantId, id), t.timezone);
}

export async function confirmAppointment(tenantId: string, id: string): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  assertCan("confirm", a);
  // مؤكَّد أصلاً ⇒ لا شيء: «تأكيد» مكرّرة من العميل ليست خطأ
  if (a.status === "BOOKED") await transition(tenantId, a, { status: "CONFIRMED", confirmedAt: new Date() });
  return view(tenantId, id);
}

/**
 * بدأت. يُعيد الموعد، ومعه مقدّم الخدمة ليفحص المنادي التأخير المتسلسل
 * (انظر delay.ts) — منفصل كي لا ينتظر زرّ «بدأت» رسالة Meta.
 */
export async function beginAppointment(tenantId: string, id: string): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  assertCan("start", a);
  await transition(tenantId, a, { status: "IN_PROGRESS", startedAt: new Date() });
  return view(tenantId, id);
}

/**
 * السعر المقترح عند «خلصت»: آخر ما دفعه هذا العميل لهذه الخدمة، وإلا
 * الحد الأدنى. السعر الحقيقي غالباً ثابت للعميل نفسه، وكتابته كل مرة
 * من الصفر هي الخطوة التي يتخطّاها الفريق فيضيع الدخل من التقارير.
 */
export async function suggestedPrice(
  tenantId: string,
  args: { customerId: string; serviceId: string },
): Promise<number | null> {
  const [last, service] = await Promise.all([
    prisma.appointment.findFirst({
      where: { tenantId, ...args, status: "DONE", finalPrice: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finalPrice: true },
    }),
    prisma.service.findFirst({ where: { id: args.serviceId, tenantId }, select: { priceMin: true } }),
  ]);
  if (last?.finalPrice != null) return Number(last.finalPrice);
  return service ? Number(service.priceMin) : null;
}

export async function finishAppointment(
  tenantId: string,
  id: string,
  input: { finalPrice?: number | null; notes?: string | null } = {},
): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  assertCan("finish", a);
  if (input.finalPrice != null && (!Number.isFinite(input.finalPrice) || input.finalPrice < 0)) {
    throw invalid("سعر غير صالح");
  }
  const now = new Date();
  const price =
    input.finalPrice ?? (await suggestedPrice(tenantId, { customerId: a.customerId, serviceId: a.serviceId }));
  await transition(
    tenantId,
    a,
    {
      status: "DONE",
      finishedAt: now,
      // بلا «بدأت» لا مدة فعلية: رقمٌ مختلَق يعلّم المقدِّر خطأً يدوم
      actualMinutes: actualMinutesOf(a.startedAt, now),
      finalPrice: price,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    },
    { visitCount: { increment: 1 }, lastVisitAt: now },
  );
  return view(tenantId, id);
}

export async function markNoShow(tenantId: string, id: string): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  assertCan("noShow", a);
  await transition(tenantId, a, { status: "NO_SHOW" }, { noShowCount: { increment: 1 } });
  return view(tenantId, id);
}

export async function cancelAppointment(tenantId: string, id: string): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  assertCan("cancel", a);
  await transition(tenantId, a, { status: "CANCELLED", cancelledAt: new Date() });
  return view(tenantId, id);
}

/**
 * تعديل: الوقت، مقدّم الخدمة، المدة، الملاحظات.
 *
 * الملاحظات تُعدَّل في أي حالة (تُكتب غالباً بعد الزيارة). أما الوقت والمقدّم
 * والمدة فلموعد لم يبدأ فقط، وبنفس قفل الحجز وفحصه — نقلٌ لوقت مشغول هو
 * حجزٌ مزدوج من باب آخر. والتذكير والتنبيه يُصفَّران: الوقت الجديد لم يُذكَّر به أحد.
 */
export async function rescheduleAppointment(
  tenantId: string,
  id: string,
  patch: { startAt?: Date; staffId?: string; plannedMinutes?: number; notes?: string | null },
): Promise<AppointmentView> {
  const a = await loadAppointment(tenantId, id);
  const moving = patch.startAt !== undefined || patch.staffId !== undefined || patch.plannedMinutes !== undefined;

  if (!moving) {
    if (patch.notes !== undefined) {
      await prisma.appointment.update({
        where: { id, tenantId },
        data: { notes: patch.notes?.trim() || null },
      });
    }
    return view(tenantId, id);
  }

  assertCan("reschedule", a);
  const t = await loadApptTenant(tenantId);
  const start = patch.startAt ?? a.startAt;
  if (Number.isNaN(start.getTime())) throw invalid("وقت غير صالح");
  if (patch.startAt && start.getTime() < Date.now() - PAST_GRACE_MS) throw invalid("لا يمكن النقل لوقت مضى");

  const staffId = patch.staffId ?? a.staffId;
  if (staffId !== a.staffId) {
    const ok = await prisma.staff.findFirst({
      where: { id: staffId, tenantId, active: true, services: { some: { serviceId: a.serviceId } } },
      select: { id: true },
    });
    if (!ok) throw notFound("مقدّم الخدمة");
  }
  // مقدّم آخر ⇒ مدة أخرى محتملة، ما لم يحدّدها الفريق صراحةً
  const minutes =
    patch.plannedMinutes ??
    (staffId !== a.staffId
      ? (await estimateMinutes(tenantId, { serviceId: a.serviceId, staffId, customerId: a.customerId })).minutes
      : a.plannedMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) throw invalid("مدة غير صالحة");

  await prisma.$transaction(
    async (tx) => {
      await lockStaff(tx, tenantId, staffId);
      await assertFree(tx, t, staffId, start, minutes, procOf(a.service), a.id);
      const res = await tx.appointment.updateMany({
        where: { id, tenantId, status: a.status },
        data: {
          startAt: start,
          staffId,
          plannedMinutes: minutes,
          reminderSentAt: null,
          delayNotifiedAt: null,
          ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        },
      });
      if (res.count === 0) throw invalid("تغيّرت حالة الموعد للتو — حدّث الصفحة");
    },
    { timeout: 15_000 },
  );
  return view(tenantId, id);
}

/** مواعيد العميل القادمة (لم تبدأ ولم تُلغَ). */
export async function upcomingFor(tenantId: string, customerId: string, now = new Date()) {
  const t = await loadApptTenant(tenantId);
  const rows = await prisma.appointment.findMany({
    where: {
      tenantId,
      customerId,
      status: { in: ["BOOKED", "CONFIRMED"] },
      startAt: { gte: new Date(now.getTime() - PAST_GRACE_MS) },
    },
    include: apptInclude,
    orderBy: { startAt: "asc" },
    take: 20,
  });
  return rows.map((r) => toAppointmentView(r, t.timezone, now));
}

export { apptInclude, toBusy, staffAppointments, procOf };
export type { ApptRow, Interval };
