/**
 * التوقيت — ساعة الحائط في المتجر مقابل UTC في القاعدة. صافٍ بلا اعتماديات.
 *
 * الدوام «١٠:٠٠–١٤:٠٠» ساعة حائط في عمّان، والمواعيد تُخزَّن UTC. الخلط بينهما
 * لا يظهر على جهاز المطوّر (توقيته عمّان أيضاً) ويظهر على الخادم (توقيته UTC):
 * كل الأوقات تنزاح ثلاث ساعات، والوكيل يعرض «١:٠٠ ظهراً» لموعد الرابعة.
 * فكل تحويل يمر من هنا بتوقيت المتجر صراحةً، ولا شيء يعتمد على توقيت الخادم.
 *
 * عبر Intl لا مكتبة: الإزاحة تُقرأ من قاعدة توقيت المنصة نفسها، فتصحّ مع أي
 * تغيير مستقبلي في التوقيت الصيفي دون تحديث حزمة.
 */

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DEFAULT_TZ = "Asia/Amman";
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** توقيت صالح أو الافتراضي — قيمة خاطئة في صف متجر لا تُسقط كل مواعيده. */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    formatter(tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function partsOf(date: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** إزاحة المنطقة عن UTC عند لحظة معيّنة، بالميلّي ثانية. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = partsOf(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

export function isDateStr(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // يرفض ٢٠٢٦-٠٢-٣٠ الذي يقبله Date.UTC بصمت ويحوّله لآذار
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

export function isTimeStr(v: string): boolean {
  const m = TIME_RE.exec(v);
  return !!m && (m[1] !== "24" || m[2] === "00");
}

/** دقائق منذ منتصف الليل لـ «HH:MM» — «24:00» = ١٤٤٠ (نهاية اليوم). */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * ساعة حائط في المتجر ⇒ لحظة UTC.
 *
 * التخمين الأول بإزاحة لحظة التخمين، ثم إعادة القياس عند النتيجة: حول تغيير
 * التوقيت الصيفي تختلف الإزاحتان، والثانية هي الصحيحة. (عمّان بلا توقيت
 * صيفي منذ ٢٠٢٢، لكن المتجر قد يكون في بلد آخر.)
 */
export function zonedToUtc(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

export type LocalParts = { date: string; time: string; minutes: number; weekday: Weekday };

const pad = (n: number) => String(n).padStart(2, "0");

/** لحظة UTC ⇒ تاريخ وساعة حائط في المتجر. */
export function toLocal(date: Date, tz: string): LocalParts {
  const p = partsOf(date, tz);
  const dateStr = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return {
    date: dateStr,
    time: `${pad(p.h)}:${pad(p.mi)}`,
    minutes: p.h * 60 + p.mi,
    weekday: weekdayOf(dateStr),
  };
}

/** يوم الأسبوع لتاريخ تقويمي — لا يعتمد على أي توقيت. */
export function weekdayOf(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** حدّا اليوم المحلّي بـ UTC: [منتصف ليله، منتصف ليل اليوم التالي). */
export function dayBounds(dateStr: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(dateStr, "00:00", tz), end: zonedToUtc(addDays(dateStr, 1), "00:00", tz) };
}

/** «YYYY-MM-DD HH:MM» بتوقيت المتجر — الصيغة التي يقرؤها الوكيل ويكتبها. */
export function formatLocal(date: Date, tz: string): string {
  const l = toLocal(date, tz);
  return `${l.date} ${l.time}`;
}

/** يقرأ «YYYY-MM-DD HH:MM» (أو بحرف T) بتوقيت المتجر. null للمشوّه. */
export function parseLocal(v: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(v.trim());
  if (!m || !isDateStr(m[1]) || !isTimeStr(m[2]) || m[2] === "24:00") return null;
  return zonedToUtc(m[1], m[2], tz);
}
