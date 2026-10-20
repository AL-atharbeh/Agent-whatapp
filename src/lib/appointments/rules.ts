import { z } from "zod";
import { WEEKDAYS, isTimeStr, minutesOf, weekdayOf, zonedToUtc, type Weekday } from "./time";

/**
 * قواعد المواعيد الصافية — المقدِّر، الانشغال، الأوقات، التأخير، والمهام.
 *
 * بلا قاعدة ولا شبكة عمداً: هذه القواعد هي ما يقرر إن كان العميل سيجد
 * موعده فارغاً أو مشغولاً، وخطأ فيها لا يظهر إلا في يوم مزدحم. فتُختبر
 * وحدها بأوقات مصنوعة (scripts/test-appointments.ts).
 */

const MIN = 60_000;

export type Interval = { start: Date; end: Date };

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

// ═══════════════════════════════════════════════════════════
//  ١. مُقدِّر المدة
// ═══════════════════════════════════════════════════════════

/** الوسيط لا المتوسط: جلسة شاذّة واحدة (عميل غيّر رأيه ٣ مرات) لا تفسد التقدير. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** للأعلى إلى ٥ دقائق، ولا أقل من ٥ — موعد بثلاث دقائق ليس موعداً. */
export function roundUp5(min: number): number {
  return Math.max(5, Math.ceil(min / 5) * 5);
}

export type Estimate = {
  minutes: number;
  basis: "customer" | "staff" | "default";
  samples: number;
};

export const CUSTOMER_SAMPLES = 3;
export const STAFF_SAMPLES = 10;

/**
 * التقدير من العيّنات، بالترتيب: تاريخ العميل ⇐ تاريخ مقدّم الخدمة ⇐ الافتراضي.
 * العيّنات مرتّبة الأحدث أولاً ومقصوصة من المنادي؛ القصّ هنا احتياط.
 */
export function estimateFrom(
  customerMinutes: number[],
  staffMinutes: number[],
  defaultMinutes: number,
): Estimate {
  const c = customerMinutes.filter((x) => x > 0).slice(0, CUSTOMER_SAMPLES);
  if (c.length) return { minutes: roundUp5(median(c)!), basis: "customer", samples: c.length };
  const s = staffMinutes.filter((x) => x > 0).slice(0, STAFF_SAMPLES);
  if (s.length) return { minutes: roundUp5(median(s)!), basis: "staff", samples: s.length };
  return { minutes: roundUp5(defaultMinutes), basis: "default", samples: 0 };
}

// ═══════════════════════════════════════════════════════════
//  ٢. الانشغال
// ═══════════════════════════════════════════════════════════

export type Processing = { afterMinutes: number; minutes: number };

export type BusySource = {
  id?: string;
  status: "BOOKED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";
  startAt: Date;
  plannedMinutes: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  processing: Processing;
};

/** الفترة الكلّية التي يشغلها الموعد — قبل استثناء الانتظار وإضافة الفاصل. */
export function spanOf(a: BusySource, now: Date): Interval | null {
  switch (a.status) {
    case "CANCELLED":
    case "NO_SHOW":
      return null;
    case "DONE": {
      // الفعلي: من خلص بدري حرّر وقته. بلا finishedAt (بيانات ناقصة) نعود للمخطّط
      const start = a.startedAt ?? a.startAt;
      const end = a.finishedAt ?? new Date(start.getTime() + a.plannedMinutes * MIN);
      return end > start ? { start, end } : null;
    }
    case "IN_PROGRESS": {
      // ما طال يمتد للآن — لا نعرض وقتاً «متاحاً» ومقدّم الخدمة ما زال مشغولاً
      const start = a.startedAt ?? a.startAt;
      const planned = start.getTime() + a.plannedMinutes * MIN;
      return { start, end: new Date(Math.max(now.getTime(), planned)) };
    }
    default:
      return { start: a.startAt, end: new Date(a.startAt.getTime() + a.plannedMinutes * MIN) };
  }
}

/** فترة الانتظار داخل الموعد، أو null. محصورة في حدود الموعد نفسه. */
export function processingGap(span: Interval, p: Processing): Interval | null {
  if (p.minutes <= 0) return null;
  const start = new Date(span.start.getTime() + Math.max(0, p.afterMinutes) * MIN);
  const end = new Date(start.getTime() + p.minutes * MIN);
  const s = start < span.start ? span.start : start;
  const e = end > span.end ? span.end : end;
  return s < e ? { start: s, end: e } : null;
}

/**
 * قطع الانشغال الفعلية لموعد: الفترة ناقص الانتظار، والفاصل بعد آخرها.
 *
 * تمثيله قطعاً لا فترة واحدة هو ما يجعل «موعد آخر يُقبل داخل الانتظار فقط
 * إن وقع بكامله فيه» قاعدة تداخل عادية: ما خرج من الانتظار يصطدم بقطعة.
 */
export function busySegments(span: Interval, p: Processing, bufferMinutes: number): Interval[] {
  const gap = processingGap(span, p);
  const segs: Interval[] = gap
    ? [
        { start: span.start, end: gap.start },
        { start: gap.end, end: span.end },
      ].filter((x) => x.start < x.end)
    : [{ start: span.start, end: span.end }];
  if (bufferMinutes > 0 && segs.length) {
    const last = segs[segs.length - 1];
    segs[segs.length - 1] = { start: last.start, end: new Date(last.end.getTime() + bufferMinutes * MIN) };
  }
  return segs;
}

export function busyIntervals(appts: BusySource[], now: Date, bufferMinutes: number): Interval[] {
  const out: Interval[] = [];
  for (const a of appts) {
    const span = spanOf(a, now);
    if (span) out.push(...busySegments(span, a.processing, bufferMinutes));
  }
  return out;
}

/** هل يتّسع هذا الموعد المرشّح دون أن يمسّ أي قطعة انشغال؟ */
export function fits(
  candidate: { start: Date; minutes: number; processing: Processing },
  busy: Interval[],
  bufferMinutes: number,
): boolean {
  const span = { start: candidate.start, end: new Date(candidate.start.getTime() + candidate.minutes * MIN) };
  const mine = busySegments(span, candidate.processing, bufferMinutes);
  return !mine.some((m) => busy.some((b) => overlaps(m, b)));
}

// ═══════════════════════════════════════════════════════════
//  ٣. الدوام والأوقات المتاحة
// ═══════════════════════════════════════════════════════════

const range = z
  .tuple([z.string(), z.string()])
  .refine(([a, b]) => isTimeStr(a) && isTimeStr(b) && minutesOf(a) < minutesOf(b), "فترة غير صالحة");

/**
 * مخطط الدوام: { "sat": [["10:00","14:00"],["16:00","21:00"]], "fri": [] }.
 * اليوم الغائب = عطلة. الفترات المتداخلة تُرفض: تُكرّر الأوقات المقترحة.
 */
export const workingHoursSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(range).max(6).optional()])) as Record<
    Weekday,
    z.ZodOptional<z.ZodArray<typeof range>>
  >)
  .refine(
    (wh) =>
      WEEKDAYS.every((d) => {
        const r = [...(wh[d] ?? [])].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
        return r.every((x, i) => i === 0 || minutesOf(r[i - 1][1]) <= minutesOf(x[0]));
      }),
    "فترات الدوام متداخلة",
  );

export type WorkingHours = Partial<Record<Weekday, [string, string][]>>;

/** يقرأ الدوام المخزّن؛ قيمة تالفة ⇒ لا دوام (لا أوقات) بدل استثناء يُسقط اليوم كله. */
export function parseWorkingHours(raw: unknown): WorkingHours {
  const r = workingHoursSchema.safeParse(raw);
  return r.success ? (r.data as WorkingHours) : {};
}

/** فترات دوام يوم محلّي بـ UTC. */
export function workingWindows(hours: WorkingHours, dateStr: string, tz: string): Interval[] {
  return (hours[weekdayOf(dateStr)] ?? []).map(([a, b]) => ({
    start: zonedToUtc(dateStr, a, tz),
    end: zonedToUtc(dateStr, b, tz),
  }));
}

/**
 * الأوقات المتاحة: داخل الدوام، لا في الماضي، بخطوة ثابتة، ولا تمسّ انشغالاً.
 *
 * الشبكة مثبّتة على بداية فترة الدوام لا على «الآن»: عميل يسأل ١٠:٠٧ يرى
 * ١٠:١٥ و١٠:٣٠، لا ١٠:٠٧ و١٠:٢٢ — أوقات لا يحجزها أحد بالهاتف.
 */
export function slotsIn(args: {
  windows: Interval[];
  busy: Interval[];
  minutes: number;
  processing: Processing;
  bufferMinutes: number;
  stepMinutes: number;
  now: Date;
  limit?: number;
}): Date[] {
  const step = Math.max(5, args.stepMinutes) * MIN;
  const dur = args.minutes * MIN;
  const out: Date[] = [];
  for (const w of [...args.windows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    let t = w.start.getTime();
    if (t < args.now.getTime()) t += Math.ceil((args.now.getTime() - t) / step) * step;
    for (; t + dur <= w.end.getTime(); t += step) {
      const start = new Date(t);
      if (fits({ start, minutes: args.minutes, processing: args.processing }, args.busy, args.bufferMinutes)) {
        out.push(start);
        if (args.limit && out.length >= args.limit) return out;
      }
    }
  }
  return out;
}

/** هل يقع الموعد كاملاً داخل إحدى فترات الدوام؟ */
export function withinWindows(start: Date, minutes: number, windows: Interval[]): boolean {
  const end = start.getTime() + minutes * MIN;
  return windows.some((w) => w.start <= start && end <= w.end.getTime());
}

// ═══════════════════════════════════════════════════════════
//  ٥. دورة الموعد
// ═══════════════════════════════════════════════════════════

export type Status = BusySource["status"];

const TRANSITIONS: Record<string, Status[]> = {
  confirm: ["BOOKED", "CONFIRMED"],
  start: ["BOOKED", "CONFIRMED"],
  // خلصت من غير «بدأت» (نُسي الزر) مقبولة — لكن بلا مدة فعلية
  finish: ["IN_PROGRESS", "BOOKED", "CONFIRMED"],
  noShow: ["BOOKED", "CONFIRMED"],
  cancel: ["BOOKED", "CONFIRMED"],
  reschedule: ["BOOKED", "CONFIRMED"],
};

export type Action = keyof typeof TRANSITIONS;

export function canTransition(action: Action, from: Status): boolean {
  return TRANSITIONS[action].includes(from);
}

/** المدة الفعلية بالدقائق، أو null حين لا بداية مسجّلة — لا نعلّم المقدِّر رقماً مختلَقاً. */
export function actualMinutesOf(startedAt: Date | null, finishedAt: Date): number | null {
  if (!startedAt) return null;
  const m = Math.round((finishedAt.getTime() - startedAt.getTime()) / MIN);
  return m >= 1 ? m : 1;
}

// ═══════════════════════════════════════════════════════════
//  ٧. التأخير المتسلسل
// ═══════════════════════════════════════════════════════════

export type DayAppt = BusySource & {
  id: string;
  delayNotifiedAt: Date | null;
};

export type DelayDecision =
  | { notify: false }
  | { notify: true; appointmentId: string; delayMinutes: number; expectedStart: Date };

/**
 * هل العميل التالي لمقدّم الخدمة هذا سينتظر بما يستحق تنبيهه؟
 *
 * النهاية المتوقّعة = نهاية الجلسة الجارية (وإن طالت: الآن)، أو — إن لم
 * تبدأ أي جلسة — موعدٌ فات وقته ولم يبدأ يُعدّ كأنه يبدأ الآن. التالية هي
 * أول موعد بعده لم يبدأ. نُنبّه مرة واحدة (delayNotifiedAt).
 *
 * إن وقعت التالية بكاملها في وقت انتظار الجارية فمقدّم الخدمة حرّ له — لا تأخير.
 */
export function delayDecision(appts: DayAppt[], now: Date, thresholdMinutes: number): DelayDecision {
  const live = appts
    .filter((a) => a.status === "BOOKED" || a.status === "CONFIRMED" || a.status === "IN_PROGRESS")
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // المرساة: الجلسة الجارية، أو أول موعد فات وقته ولم يبدأ (كأنه يبدأ الآن)
  let anchor: { span: Interval; processing: Processing; id: string; scheduled: Date } | null = null;
  const running = live.find((a) => a.status === "IN_PROGRESS");
  if (running) {
    anchor = {
      span: spanOf(running, now)!,
      processing: running.processing,
      id: running.id,
      scheduled: running.startAt,
    };
  } else {
    const late = live.find((a) => a.startAt <= now);
    if (late) {
      anchor = {
        span: { start: now, end: new Date(now.getTime() + late.plannedMinutes * MIN) },
        processing: late.processing,
        id: late.id,
        scheduled: late.startAt,
      };
    }
  }
  if (!anchor) return { notify: false };

  // التالية بترتيب المواعيد المحجوزة، لا بترتيب ما بدأ فعلاً
  const a0 = anchor;
  const next = live.find(
    (a) => a.id !== a0.id && a.status !== "IN_PROGRESS" && a.startAt >= a0.scheduled,
  );
  if (!next || next.delayNotifiedAt) return { notify: false };

  const gap = processingGap(anchor.span, anchor.processing);
  const nextEnd = new Date(next.startAt.getTime() + next.plannedMinutes * MIN);
  if (gap && gap.start <= next.startAt && nextEnd <= gap.end) return { notify: false };

  const delay = Math.round((anchor.span.end.getTime() - next.startAt.getTime()) / MIN);
  if (delay < thresholdMinutes) return { notify: false };
  return { notify: true, appointmentId: next.id, delayMinutes: delay, expectedStart: anchor.span.end };
}

// ═══════════════════════════════════════════════════════════
//  ٨. قرارات المهام المجدولة
// ═══════════════════════════════════════════════════════════

/** التذكير حين تكون الساعة reminderHour بتوقيت المتجر أو بعدها. */
export const reminderDue = (localMinutes: number, reminderHour: number) =>
  localMinutes >= reminderHour * 60;

/** غياب تلقائي: لم يبدأ، ومرّت نهايته المخطّطة بـ autoNoShowMinutes. */
export function isAutoNoShow(
  a: { status: Status; startAt: Date; plannedMinutes: number },
  now: Date,
  autoNoShowMinutes: number,
): boolean {
  if (a.status !== "BOOKED" && a.status !== "CONFIRMED") return false;
  const deadline = a.startAt.getTime() + (a.plannedMinutes + autoNoShowMinutes) * MIN;
  return now.getTime() > deadline;
}

/**
 * نافذة العودة: التذكير يستحق بعد rebookAfterDays، ولا يُرسَل لزيارة أقدم من
 * أسبوعين من موعد استحقاقه. بدون هذا الحد، متجر يضبط قالب العودة اليوم
 * يُطلق دفعة رسائل لكل عميل زاره منذ سنة — رسائل لا تُفهم وتُبلَّغ كإزعاج.
 */
export const REBOOK_GRACE_DAYS = 14;

export function rebookDue(args: {
  finishedAt: Date;
  rebookAfterDays: number | null;
  rebookSentAt: Date | null;
  hasUpcoming: boolean;
  hasLaterVisitSameService: boolean;
  now: Date;
}): boolean {
  if (args.rebookAfterDays == null || args.rebookAfterDays <= 0) return false;
  if (args.rebookSentAt || args.hasUpcoming || args.hasLaterVisitSameService) return false;
  const due = args.finishedAt.getTime() + args.rebookAfterDays * 86400_000;
  return args.now.getTime() >= due && args.now.getTime() - due <= REBOOK_GRACE_DAYS * 86400_000;
}

/**
 * متغيّرات القالب بالترتيب المتّفق عليه، مقصوصة لعدد ما يطلبه القالب:
 *   {{1}} اسم العميل · {{2}} الخدمة · {{3}} الوقت · {{4}} التاريخ · {{5}} مقدّم الخدمة
 * قالب بمتغيّرين يأخذ الاسم والخدمة؛ لا نُرسل لـ Meta متغيّرات لم يطلبها.
 */
export function templateVars(
  v: { customer: string; service: string; time: string; date: string; staff: string },
  count: number,
): string[] {
  return [v.customer, v.service, v.time, v.date, v.staff].slice(0, Math.max(0, count));
}
