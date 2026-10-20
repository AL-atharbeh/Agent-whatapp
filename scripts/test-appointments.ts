import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  addDays,
  dayBounds,
  formatLocal,
  isDateStr,
  parseLocal,
  toLocal,
  weekdayOf,
  zonedToUtc,
} from "../src/lib/appointments/time";
import { DEFAULT_SETTINGS, settingsOf } from "../src/lib/appointments/settings";
import {
  REBOOK_GRACE_DAYS,
  actualMinutesOf,
  busyIntervals,
  busySegments,
  canTransition,
  delayDecision,
  estimateFrom,
  fits,
  isAutoNoShow,
  median,
  parseWorkingHours,
  rebookDue,
  reminderDue,
  roundUp5,
  slotsIn,
  spanOf,
  templateVars,
  withinWindows,
  workingHoursSchema,
  workingWindows,
  type BusySource,
  type DayAppt,
} from "../src/lib/appointments/rules";
import { MAX_PHOTO_BYTES, checkPhoto } from "../src/lib/appointments/photo";
import { buildSystemPrompt } from "../src/lib/agent/prompt";
import { buildTools } from "../src/lib/agent/tools";

/**
 * اختبارات وحدة المواعيد — منطق صافٍ بلا قاعدة ولا شبكة.
 *
 *   npx tsx scripts/test-appointments.ts
 *
 * البيانات من ثلاثة أنشطة لا من صالون وحده: عيادة أسنان (تخدير يسري)،
 * مركز صيانة سيارات (طلاء يجف، جلسات بالساعات)، وصالون (صبغة تثبت).
 * الوحدة واحدة لكلها، والاختبار يجب أن يكسر إن افترض الكود نشاطاً بعينه.
 *
 * يخرج برمز غير صفري عند أي فشل.
 */

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const TZ = "Asia/Amman"; // UTC+3 ثابتة منذ ٢٠٢٢
const MIN = 60_000;
const at = (iso: string) => new Date(iso);
const local = (d: string, t: string) => zonedToUtc(d, t, TZ);
const plus = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const iso = (d: Date) => d.toISOString();

// ═══════════════════════════════════════════════════════════
//  التوقيت
// ═══════════════════════════════════════════════════════════

test("zonedToUtc: ١٠:٠٠ عمّان = ٠٧:٠٠ UTC", () => {
  assert.equal(iso(local("2026-10-20", "10:00")), "2026-10-20T07:00:00.000Z");
});
test("zonedToUtc: منتصف الليل المحلّي يقع في اليوم السابق بـ UTC", () => {
  assert.equal(iso(local("2026-10-20", "00:00")), "2026-10-19T21:00:00.000Z");
  assert.equal(iso(local("2026-10-20", "24:00")), "2026-10-20T21:00:00.000Z");
});
test("toLocal: ٢١:٣٠ UTC = ٠٠:٣٠ من اليوم التالي في عمّان", () => {
  const l = toLocal(at("2026-10-20T21:30:00Z"), TZ);
  assert.equal(l.date, "2026-10-21");
  assert.equal(l.time, "00:30");
  assert.equal(l.minutes, 30);
  assert.equal(l.weekday, "wed");
});
test("dayBounds: ٢٤ ساعة تبدأ ٢١:٠٠ UTC من اليوم السابق", () => {
  const b = dayBounds("2026-12-31", TZ);
  assert.equal(iso(b.start), "2026-12-30T21:00:00.000Z");
  assert.equal(iso(b.end), "2026-12-31T21:00:00.000Z");
});
test("addDays: عبر نهاية الشهر والسنة والسنة الكبيسة", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
test("weekdayOf: مستقل عن توقيت الخادم", () => {
  assert.equal(weekdayOf("2026-10-20"), "tue");
  assert.equal(weekdayOf("2026-10-23"), "fri");
});
test("isDateStr: يرفض تاريخاً لا وجود له", () => {
  assert.equal(isDateStr("2026-02-30"), false);
  assert.equal(isDateStr("2026-13-01"), false);
  assert.equal(isDateStr("2026-10-20"), true);
});
test("parseLocal/formatLocal: ذهاب وإياب بتوقيت المتجر", () => {
  const d = parseLocal("2026-10-21 16:30", TZ)!;
  assert.equal(iso(d), "2026-10-21T13:30:00.000Z");
  assert.equal(formatLocal(d, TZ), "2026-10-21 16:30");
  assert.equal(parseLocal("2026-10-21T16:30", TZ)?.getTime(), d.getTime());
  assert.equal(parseLocal("بكرا العصر", TZ), null);
  assert.equal(parseLocal("2026-10-21 24:00", TZ), null);
});
test("zonedToUtc: منطقة بتوقيت صيفي (برلين) على جانبي التحويل", () => {
  assert.equal(iso(zonedToUtc("2026-03-28", "10:00", "Europe/Berlin")), "2026-03-28T09:00:00.000Z");
  assert.equal(iso(zonedToUtc("2026-03-30", "10:00", "Europe/Berlin")), "2026-03-30T08:00:00.000Z");
});

// ═══════════════════════════════════════════════════════════
//  الإعدادات
// ═══════════════════════════════════════════════════════════

test("settingsOf: بلا إعدادات ⇒ الافتراضي كاملاً", () => {
  assert.deepEqual(settingsOf({ appointmentSettings: null }), DEFAULT_SETTINGS);
});
test("settingsOf: القيمة الخاطئة تسقط وحدها لافتراضيّها", () => {
  const s = settingsOf({
    appointmentSettings: { slotStepMinutes: 0, bufferMinutes: 10, reminderHour: "18", reminderTemplate: "Bad Name!" },
  });
  assert.equal(s.slotStepMinutes, 15);
  assert.equal(s.bufferMinutes, 10);
  assert.equal(s.reminderHour, 18);
  assert.equal(s.reminderTemplate, null);
  assert.equal(settingsOf({ appointmentSettings: [1, 2] }).slotStepMinutes, 15);
});

// ═══════════════════════════════════════════════════════════
//  ١. المقدِّر
// ═══════════════════════════════════════════════════════════

test("median: فردي وزوجي وفارغ", () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});
test("roundUp5: للأعلى، ولا أقل من ٥", () => {
  assert.equal(roundUp5(41), 45);
  assert.equal(roundUp5(45), 45);
  assert.equal(roundUp5(2), 5);
  assert.equal(roundUp5(0), 5);
});
test("estimateFrom: تاريخ العميل أولاً — آخر ٣ فقط، والشاذّ لا يفسده", () => {
  // كشف أسنان: ١٢ ثم ١١ ثم جلسة شاذّة ٩٠ ثم قديمة ١٠٠
  const e = estimateFrom([12, 11, 90, 100], [40, 40], 30);
  assert.deepEqual(e, { minutes: 15, basis: "customer", samples: 3 });
});
test("estimateFrom: بلا تاريخ للعميل ⇒ مقدّم الخدمة (آخر ١٠)", () => {
  // صيانة سيارة: فنّي ينهيها عادة في ساعتين وربع
  const e = estimateFrom([], [130, 140, 135, 500, 120, 125, 138, 131, 129, 133, 999], 180);
  assert.equal(e.basis, "staff");
  assert.equal(e.samples, 10);
  assert.equal(e.minutes, 135);
});
test("estimateFrom: لا عيّنات ⇒ الافتراضي مقرّباً", () => {
  assert.deepEqual(estimateFrom([], [], 42), { minutes: 45, basis: "default", samples: 0 });
});
test("estimateFrom: العيّنات الصفرية تُهمَل", () => {
  assert.equal(estimateFrom([0, 0], [], 30).basis, "default");
});

// ═══════════════════════════════════════════════════════════
//  ٢. الانشغال
// ═══════════════════════════════════════════════════════════

const NO_PROC = { afterMinutes: 0, minutes: 0 };
const appt = (o: Partial<BusySource> & { startAt: Date }): BusySource => ({
  status: "BOOKED",
  plannedMinutes: 60,
  startedAt: null,
  finishedAt: null,
  processing: NO_PROC,
  ...o,
});
const T = local("2026-10-20", "10:00");

test("spanOf BOOKED: [البداية، البداية + المخطّط]", () => {
  const s = spanOf(appt({ startAt: T }), T)!;
  assert.equal(iso(s.end), iso(plus(T, 60)));
});
test("spanOf DONE: الفعلي — من انتهى بدري حرّر وقته", () => {
  const s = spanOf(
    appt({ startAt: T, status: "DONE", startedAt: plus(T, 5), finishedAt: plus(T, 25) }),
    plus(T, 300),
  )!;
  assert.equal(iso(s.start), iso(plus(T, 5)));
  assert.equal(iso(s.end), iso(plus(T, 25)));
});
test("spanOf IN_PROGRESS: ما طال يمتد للآن", () => {
  const a = appt({ startAt: T, status: "IN_PROGRESS", startedAt: T, plannedMinutes: 30 });
  assert.equal(iso(spanOf(a, plus(T, 10))!.end), iso(plus(T, 30)));
  assert.equal(iso(spanOf(a, plus(T, 50))!.end), iso(plus(T, 50)));
});
test("spanOf: الملغى والغائب لا يشغلان وقتاً", () => {
  assert.equal(spanOf(appt({ startAt: T, status: "CANCELLED" }), T), null);
  assert.equal(spanOf(appt({ startAt: T, status: "NO_SHOW" }), T), null);
});
test("busySegments: وقت الانتظار يُستثنى، والفاصل بعد آخر قطعة فقط", () => {
  // صبغة: ٢٠ دقيقة عمل، ٤٠ انتظار، ٣٠ عمل
  const segs = busySegments({ start: T, end: plus(T, 90) }, { afterMinutes: 20, minutes: 40 }, 10);
  assert.equal(segs.length, 2);
  assert.equal(iso(segs[0].end), iso(plus(T, 20)));
  assert.equal(iso(segs[1].start), iso(plus(T, 60)));
  assert.equal(iso(segs[1].end), iso(plus(T, 100)));
});
test("fits: موعد يقع بكامله في انتظار آخر يُقبل؛ ما خرج منه يُرفض", () => {
  // عيادة: حشوة بتخدير يسري ٢٥ دقيقة بعد أول ١٠
  const filling = appt({ startAt: T, plannedMinutes: 60, processing: { afterMinutes: 10, minutes: 25 } });
  const busy = busyIntervals([filling], T, 0);
  assert.equal(fits({ start: plus(T, 10), minutes: 20, processing: NO_PROC }, busy, 0), true);
  assert.equal(fits({ start: plus(T, 15), minutes: 25, processing: NO_PROC }, busy, 0), false);
  assert.equal(fits({ start: plus(T, 5), minutes: 10, processing: NO_PROC }, busy, 0), false);
});
test("fits: الفاصل يمنع الالتصاق", () => {
  const busy = busyIntervals([appt({ startAt: T, plannedMinutes: 30 })], T, 10);
  assert.equal(fits({ start: plus(T, 30), minutes: 30, processing: NO_PROC }, busy, 10), false);
  assert.equal(fits({ start: plus(T, 40), minutes: 30, processing: NO_PROC }, busy, 10), true);
});

// ═══════════════════════════════════════════════════════════
//  ٣. الدوام والأوقات
// ═══════════════════════════════════════════════════════════

const SPLIT = { tue: [["10:00", "14:00"], ["16:00", "21:00"]], fri: [] } as const;

test("workingHoursSchema: يقبل الفترتين ويرفض المتداخل والمشوّه", () => {
  assert.equal(workingHoursSchema.safeParse(SPLIT).success, true);
  assert.equal(workingHoursSchema.safeParse({ sat: [["10:00", "14:00"], ["13:00", "18:00"]] }).success, false);
  assert.equal(workingHoursSchema.safeParse({ sat: [["14:00", "10:00"]] }).success, false);
  assert.equal(workingHoursSchema.safeParse({ sat: [["9:00", "10:00"]] }).success, false);
  assert.deepEqual(parseWorkingHours("تالف"), {});
});
test("workingWindows: فترتا الثلاثاء بـ UTC، والجمعة عطلة", () => {
  const w = workingWindows(parseWorkingHours(SPLIT), "2026-10-20", TZ);
  assert.deepEqual(w.map((x) => [iso(x.start), iso(x.end)]), [
    ["2026-10-20T07:00:00.000Z", "2026-10-20T11:00:00.000Z"],
    ["2026-10-20T13:00:00.000Z", "2026-10-20T18:00:00.000Z"],
  ]);
  assert.deepEqual(workingWindows(parseWorkingHours(SPLIT), "2026-10-23", TZ), []);
  assert.deepEqual(workingWindows(parseWorkingHours(SPLIT), "2026-10-24", TZ), []);
});

const tueWindows = workingWindows(parseWorkingHours(SPLIT), "2026-10-20", TZ);
const slots = (o: Partial<Parameters<typeof slotsIn>[0]> = {}) =>
  slotsIn({
    windows: tueWindows,
    busy: [],
    minutes: 60,
    processing: NO_PROC,
    bufferMinutes: 0,
    stepMinutes: 15,
    now: local("2026-10-19", "12:00"),
    ...o,
  }).map((d) => toLocal(d, TZ).time);

test("slotsIn: عبر فترتين — لا وقت يعبر الاستراحة", () => {
  const s = slots();
  assert.equal(s[0], "10:00");
  assert.ok(s.includes("13:00"));
  assert.ok(!s.includes("13:15"), "١٣:١٥ + ساعة تعبر ١٤:٠٠");
  assert.ok(s.includes("16:00"));
  assert.equal(s[s.length - 1], "20:00");
});
test("slotsIn: لا في الماضي، والشبكة مثبّتة على بداية الدوام", () => {
  const s = slots({ now: local("2026-10-20", "10:07") });
  assert.equal(s[0], "10:15");
});
test("slotsIn: يتخطّى المشغول، ويقبل ما يقع في انتظار موعد آخر", () => {
  // مركز صيانة: رشّ طلاء ١١:٠٠ — ٣٠ عمل ثم ٦٠ تجفيف ثم ٣٠ تلميع
  const paint = appt({
    startAt: local("2026-10-20", "11:00"),
    plannedMinutes: 120,
    processing: { afterMinutes: 30, minutes: 60 },
  });
  const busy = busyIntervals([paint], local("2026-10-19", "12:00"), 0);
  const s = slots({ busy, minutes: 30 });
  assert.ok(!s.includes("11:00"));
  assert.ok(s.includes("11:30") && s.includes("12:00"), "داخل التجفيف");
  assert.ok(!s.includes("12:15"), "يخرج من التجفيف إلى التلميع");
  assert.ok(s.includes("13:00"));
});
test("slotsIn: الحد الأقصى للنتائج", () => {
  assert.equal(slots({ limit: 3 }).length, 3);
});
test("withinWindows: الوكيل لا يحجز خارج الدوام", () => {
  assert.equal(withinWindows(local("2026-10-20", "13:30"), 30, tueWindows), true);
  assert.equal(withinWindows(local("2026-10-20", "13:45"), 30, tueWindows), false);
  assert.equal(withinWindows(local("2026-10-20", "14:30"), 30, tueWindows), false);
});

// ═══════════════════════════════════════════════════════════
//  ٥. دورة الموعد
// ═══════════════════════════════════════════════════════════

test("canTransition: الدورة كما في العقد", () => {
  assert.equal(canTransition("confirm", "BOOKED"), true);
  assert.equal(canTransition("start", "CONFIRMED"), true);
  assert.equal(canTransition("finish", "IN_PROGRESS"), true);
  assert.equal(canTransition("start", "DONE"), false);
  assert.equal(canTransition("cancel", "IN_PROGRESS"), false);
  assert.equal(canTransition("noShow", "CANCELLED"), false);
  assert.equal(canTransition("reschedule", "DONE"), false);
});
test("actualMinutesOf: مقرّبة، ولا مدة بلا «بدأت»", () => {
  assert.equal(actualMinutesOf(T, plus(T, 41.6)), 42);
  assert.equal(actualMinutesOf(null, T), null);
  assert.equal(actualMinutesOf(T, T), 1);
});

// ═══════════════════════════════════════════════════════════
//  ٧. التأخير المتسلسل
// ═══════════════════════════════════════════════════════════

const day = (o: Partial<DayAppt> & { id: string; startAt: Date }): DayAppt => ({
  ...appt(o),
  id: o.id,
  delayNotifiedAt: o.delayNotifiedAt ?? null,
});

test("delayDecision: جلسة جارية طالت ⇒ تنبيه التالي بمقدار التأخير", () => {
  const r = delayDecision(
    [
      day({ id: "a", startAt: T, status: "IN_PROGRESS", startedAt: T, plannedMinutes: 60 }),
      day({ id: "b", startAt: plus(T, 60), plannedMinutes: 30 }),
    ],
    plus(T, 75),
    10,
  );
  assert.equal(r.notify, true);
  if (r.notify) {
    assert.equal(r.appointmentId, "b");
    assert.equal(r.delayMinutes, 15);
  }
});
test("delayDecision: تأخير أقل من العتبة ⇒ لا تنبيه", () => {
  const r = delayDecision(
    [
      day({ id: "a", startAt: T, status: "IN_PROGRESS", startedAt: T, plannedMinutes: 60 }),
      day({ id: "b", startAt: plus(T, 60) }),
    ],
    plus(T, 65),
    10,
  );
  assert.equal(r.notify, false);
});
test("delayDecision: نُبِّه سابقاً ⇒ لا تكرار", () => {
  const r = delayDecision(
    [
      day({ id: "a", startAt: T, status: "IN_PROGRESS", startedAt: T }),
      day({ id: "b", startAt: plus(T, 60), delayNotifiedAt: plus(T, 70) }),
    ],
    plus(T, 90),
    10,
  );
  assert.equal(r.notify, false);
});
test("delayDecision: بدء متأخر يُحسب كأنه يبدأ الآن", () => {
  // موعد ١٠:٠٠ لم يبدأ و الساعة ١٠:٢٠ — التالي ١١:٠٠ سيتأخّر ٢٠ دقيقة
  const r = delayDecision(
    [day({ id: "a", startAt: T, plannedMinutes: 60 }), day({ id: "b", startAt: plus(T, 60) })],
    plus(T, 20),
    10,
  );
  assert.equal(r.notify, true);
  if (r.notify) assert.equal(r.delayMinutes, 20);
});
test("delayDecision: التالي يقع كاملاً في وقت انتظار الجارية ⇒ لا تأخير", () => {
  const r = delayDecision(
    [
      day({
        id: "a",
        startAt: T,
        status: "IN_PROGRESS",
        startedAt: plus(T, 15),
        plannedMinutes: 90,
        processing: { afterMinutes: 20, minutes: 40 },
      }),
      day({ id: "b", startAt: plus(T, 40), plannedMinutes: 15 }),
    ],
    plus(T, 30),
    10,
  );
  assert.equal(r.notify, false);
});
test("delayDecision: لا جلسة ولا متأخّر ⇒ لا شيء", () => {
  assert.equal(delayDecision([day({ id: "b", startAt: plus(T, 60) })], T, 10).notify, false);
});

// ═══════════════════════════════════════════════════════════
//  ٨. قرارات المهام
// ═══════════════════════════════════════════════════════════

test("reminderDue: عند reminderHour بتوقيت المتجر أو بعدها", () => {
  assert.equal(reminderDue(17 * 60 + 59, 18), false);
  assert.equal(reminderDue(18 * 60, 18), true);
  assert.equal(reminderDue(23 * 60, 18), true);
});
test("isAutoNoShow: بعد النهاية المخطّطة + المهلة، ولم يبدأ", () => {
  const a = { status: "BOOKED" as const, startAt: T, plannedMinutes: 30 };
  assert.equal(isAutoNoShow(a, plus(T, 90), 60), false);
  assert.equal(isAutoNoShow(a, plus(T, 91), 60), true);
  assert.equal(isAutoNoShow({ ...a, status: "IN_PROGRESS" }, plus(T, 500), 60), false);
});
test("rebookDue: بعد المدة، ضمن نافذة السماح، بلا قادم ولا زيارة أحدث", () => {
  const base = {
    finishedAt: T,
    rebookAfterDays: 180, // تنظيف أسنان كل ٦ أشهر
    rebookSentAt: null,
    hasUpcoming: false,
    hasLaterVisitSameService: false,
  };
  const dayMs = 86400_000;
  assert.equal(rebookDue({ ...base, now: new Date(T.getTime() + 179 * dayMs) }), false);
  assert.equal(rebookDue({ ...base, now: new Date(T.getTime() + 180 * dayMs) }), true);
  assert.equal(
    rebookDue({ ...base, now: new Date(T.getTime() + (180 + REBOOK_GRACE_DAYS + 1) * dayMs) }),
    false,
    "زيارة قديمة جداً لا تُطلق رسالة",
  );
  const now = new Date(T.getTime() + 181 * dayMs);
  assert.equal(rebookDue({ ...base, now, hasUpcoming: true }), false);
  assert.equal(rebookDue({ ...base, now, hasLaterVisitSameService: true }), false);
  assert.equal(rebookDue({ ...base, now, rebookSentAt: T }), false);
  assert.equal(rebookDue({ ...base, now, rebookAfterDays: null }), false);
});
test("templateVars: مقصوصة لعدد ما يطلبه القالب", () => {
  const v = { customer: "سامر", service: "تغيير زيت", time: "16:00", date: "2026-10-21", staff: "رامي" };
  assert.deepEqual(templateVars(v, 2), ["سامر", "تغيير زيت"]);
  assert.deepEqual(templateVars(v, 0), []);
  assert.equal(templateVars(v, 9).length, 5);
});

// ═══════════════════════════════════════════════════════════
//  الصورة
// ═══════════════════════════════════════════════════════════

const bytes = (head: number[], size = 64) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];

test("checkPhoto: النوع من البايتات لا من الإعلان", () => {
  assert.equal((checkPhoto(bytes(JPEG)) as { mime: string }).mime, "image/jpeg");
  assert.equal((checkPhoto(bytes(PNG), "image/png") as { mime: string }).mime, "image/png");
  assert.equal((checkPhoto(bytes(WEBP)) as { mime: string }).mime, "image/webp");
  assert.equal(checkPhoto(bytes(PNG), "image/jpeg").ok, false);
  assert.equal(checkPhoto(new Uint8Array(Buffer.from("<html><script>x</script></html>")), "image/png").ok, false);
});
test("checkPhoto: الحجم الأقصى ١٥٠ كيلوبايت والفارغ مرفوض", () => {
  assert.equal(checkPhoto(bytes(JPEG, MAX_PHOTO_BYTES)).ok, true);
  assert.equal(checkPhoto(bytes(JPEG, MAX_PHOTO_BYTES + 1)).ok, false);
  assert.equal(checkPhoto(new Uint8Array()).ok, false);
});
test("checkPhoto: البصمة تتغيّر مع المحتوى", () => {
  const a = checkPhoto(bytes(JPEG)) as { etag: string };
  const b = checkPhoto(bytes([...JPEG, 1])) as { etag: string };
  assert.notEqual(a.etag, b.etag);
});

// ═══════════════════════════════════════════════════════════
//  مطفأة تماماً حين لا تُفعَّل
// ═══════════════════════════════════════════════════════════

const tenant = (appointmentsEnabled: boolean, businessType = "gold") =>
  ({
    id: "t1",
    name: "متجر",
    businessType,
    agentName: "المساعد",
    currency: "JOD",
    locale: "ar-JO",
    timezone: TZ,
    tone: "ودّي",
    customPolicy: null,
    profile: null,
    faqs: [],
    dataSources: [],
    appointmentsEnabled,
    appointmentSettings: null,
  }) as never;

const APPT_TOOLS = [
  "list_services",
  "find_slots",
  "book_appointment",
  "my_appointments",
  "confirm_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "my_history",
];

const toolNames = (enabled: boolean, channel = "WHATSAPP") =>
  buildTools({
    scope: {} as never,
    tenant: tenant(enabled),
    channel: channel as never,
    externalUserId: "962770000000",
    state: { handoff: null, toolCalls: [] },
  }).map((t) => t.name);

test("مطفأة: لا أداة مواعيد واحدة لمتجر لم يفعّلها", () => {
  const names = toolNames(false);
  assert.deepEqual(names, ["search_catalog", "capture_lead", "handoff_to_human"]);
  assert.ok(!APPT_TOOLS.some((n) => names.includes(n)));
});
test("مفعّلة: الأدوات الثماني تُضاف فوق الأساسية", () => {
  const names = toolNames(true);
  assert.deepEqual(names.slice(3), APPT_TOOLS);
});
test("مفعّلة على ساحة التجربة (WEB): لا أدوات حجز — لا مصدر حجز لها", () => {
  assert.equal(toolNames(true, "WEB").length, 3);
});
test("مطفأة: تعليمات الوكيل بلا حرف عن المواعيد، والقاعدة ٣ كما كانت", () => {
  const p = buildSystemPrompt(tenant(false));
  assert.ok(!p.includes("## المواعيد"));
  assert.ok(!p.includes("find_slots"));
  assert.ok(p.includes("3. لا تثبّت سعراً، ولا توافق على خصم، ولا تؤكد حجزاً أو موعد تسليم."));
});
test("مفعّلة: قسم المواعيد محايد — بلا افتراض نشاط ولا جنس", () => {
  const p = buildSystemPrompt(tenant(true, "clinic"));
  assert.ok(p.includes("## المواعيد"));
  const section = p.slice(p.indexOf("## المواعيد"));
  for (const w of ["زبونة", "الزبونة", "موظفة", "صبغة", "صالون", "حلاق"]) {
    assert.ok(!section.includes(w), `قسم المواعيد يحوي «${w}»`);
  }
});
test("مطفأة: خط المعالجة لا يمسّ القاعدة لأجل المواعيد إلا خلف الشرط", () => {
  // فحص بنيوي: النداء الوحيد في pipeline.ts داخل كتلة appointmentsEnabled
  const src = fs.readFileSync(path.join(__dirname, "../src/lib/pipeline.ts"), "utf8");
  const calls = src.split("upsertCustomerFromContact(").length - 1;
  assert.equal(calls, 1);
  const before = src.slice(0, src.indexOf("upsertCustomerFromContact("));
  const gate = before.lastIndexOf("tenant.appointmentsEnabled");
  assert.ok(gate > 0 && before.length - gate < 300, "النداء خارج شرط التفعيل");
});
test("مطفأة: مهمة الكنس تختار المتاجر المفعّلة وحدها", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/lib/appointments/cron.ts"), "utf8");
  assert.match(src, /where:\s*\{\s*appointmentsEnabled:\s*true/);
});
test("لغة محايدة: لا «زبونة» ولا «موظفة» في نصوص الوحدة الظاهرة", () => {
  const dir = path.join(__dirname, "../src/lib/appointments");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // النصوص الظاهرة فقط: ما بين علامات التنصيص
    const strings = src.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
    for (const s of strings) {
      assert.ok(!/زبون|موظف/.test(s), `${f}: ${s}`);
    }
  }
});

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} نجح، ${failures.length} فشل`);
  process.exit(1);
}
console.log(`✅ ${passed} اختباراً نجحت`);
