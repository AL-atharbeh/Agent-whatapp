import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { isPlausiblePhone, normalizePhone } from "../src/lib/phone";
import { addDays, toLocal, zonedToUtc } from "../src/lib/appointments/time";
import { toAscii } from "./prompt";

/**
 * يحوّل متجراً موجوداً إلى صالون تجريبي «Lush» ليُجرَّب عليه كل ما تحلّه
 * وحدة المواعيد — من رقم واتساب حقيقي.
 *
 *   npm run demo:salon                         ← يسأل عن المتجر ورقم التجربة
 *   npm run demo:salon -- --restore <ملف>      ← يعيد المتجر كما كان
 *
 * قبل أي تغيير يحفظ محتوى المتجر كاملاً في backups/ (خارج git): البيانات
 * والتعليمات والمنتجات والأسئلة والمواعيد. المحادثات والقنوات والـ slug لا
 * تُلمس — الـ slug عليه يقوم رابط ويبهوك ميتا، وتغييره يقطع الواتساب.
 *
 * العملاء الوهميون بلا أرقام عمداً: رقم «وهمي» قد يكون رقم إنسان حقيقي، ومهمة
 * التذكير كانت ستراسله. الرسائل لا تصل إلا لأرقام التجربة التي تكتبها أنت.
 */

const TZ_FALLBACK = "Asia/Amman";
const MIN = 60_000;

// ═══════════════════════════════════════════════════════════
//  محتوى الصالون
// ═══════════════════════════════════════════════════════════

const TENANT = {
  name: "صالون Lush",
  businessType: "beauty",
  agentName: "لمى",
  tone: "ودّية وقريبة، لهجة أردنية، جمل قصيرة، بدون مبالغة",
  customPolicy: [
    "الحجز يتم هنا بالمحادثة فقط — لا يوجد موقع حجز.",
    "سعر الصبغة والكيراتين يتحدد نهائياً بعد رؤية الشعر؛ اذكر النطاق دائماً.",
    "الإلغاء أو التأجيل قبل ساعتين على الأقل من الموعد.",
    "لا تعطِ نصائح طبية؛ عند ذكر حساسية سجّلها واطلب من الفريق مراجعتها.",
  ].join("\n"),
  handoffKeywords: ["شكوى", "المديرة", "مدير"],
};

const PROFILE = {
  about:
    "صالون Lush للعناية بالشعر والأظافر في عمّان: قص، صبغة، كيراتين، سشوار، مانيكير وحواجب. (متجر تجريبي)",
  address: "عمّان – عبدون، شارع القاهرة، بناية ١٢ (عنوان تجريبي)",
  phone: null,
  mapsUrl: null,
  workingHours: "السبت–الخميس ١٠ص–٩م، الجمعة ٢م–٨م",
  deliveryPolicy: null,
  returnPolicy: "الإلغاء أو التأجيل مجاني قبل ساعتين من الموعد.",
  paymentMethods: "كاش، بطاقة، CliQ",
  websiteUrl: null,
};

const PRODUCTS = [
  { sku: "LUSH-SH-01", name: "شامبو للشعر المصبوغ", category: "منتجات العناية", price: 22, description: "يحافظ على لون الصبغة، ٢٥٠ مل" },
  { sku: "LUSH-OIL-01", name: "زيت أرغان للشعر", category: "منتجات العناية", price: 15, description: "للأطراف الجافة، ١٠٠ مل" },
  { sku: "LUSH-MSK-01", name: "ماسك كيراتين منزلي", category: "منتجات العناية", price: 18, description: "يُستخدم مرة أسبوعياً بعد الكيراتين" },
];

const FAQS = [
  { question: "في موقف سيارات؟", answer: "أيوه، في موقف مجاني تحت البناية." },
  { question: "بتستقبلوا أطفال؟", answer: "أيوه، قص أطفال من عمر ٤ سنين وفوق، بنفس سعر القص." },
  { question: "شو طرق الدفع؟", answer: "كاش، بطاقة، أو CliQ." },
  { question: "قديش بيثبت الكيراتين؟", answer: "من ٣ لـ ٥ شهور حسب نوع الشعر والعناية بعده." },
  { question: "بتعملوا مكياج عرايس؟", answer: "حالياً لا، خدماتنا شعر وأظافر وحواجب." },
];

type ServiceKey = "cut" | "color" | "blow" | "keratin" | "mani" | "brows";
const SERVICES: Record<ServiceKey, {
  name: string; category: string; priceMin: number; priceMax: number | null; defaultMinutes: number;
  processingAfterMinutes?: number; processingMinutes?: number; rebookAfterDays?: number;
}> = {
  cut: { name: "قص شعر", category: "شعر", priceMin: 10, priceMax: 25, defaultMinutes: 45, rebookAfterDays: 42 },
  // الانتظار: بعد ٣٠ د من البدء تثبت الصبغة ٣٥ د ومقدّمة الخدمة فاضية
  color: { name: "صبغة جذور", category: "شعر", priceMin: 25, priceMax: 40, defaultMinutes: 120, processingAfterMinutes: 30, processingMinutes: 35, rebookAfterDays: 35 },
  blow: { name: "سشوار", category: "شعر", priceMin: 8, priceMax: 15, defaultMinutes: 30 },
  keratin: { name: "كيراتين", category: "شعر", priceMin: 60, priceMax: 120, defaultMinutes: 180, processingAfterMinutes: 60, processingMinutes: 40 },
  mani: { name: "مانيكير", category: "أظافر", priceMin: 10, priceMax: 15, defaultMinutes: 40, rebookAfterDays: 21 },
  brows: { name: "حواجب", category: "وجه", priceMin: 3, priceMax: 5, defaultMinutes: 15 },
};

const FULL_WEEK = {
  sat: [["10:00", "21:00"]], sun: [["10:00", "21:00"]], mon: [["10:00", "21:00"]],
  tue: [["10:00", "21:00"]], wed: [["10:00", "21:00"]], thu: [["10:00", "21:00"]],
  fri: [["14:00", "20:00"]],
};
type StaffKey = "rana" | "hiba" | "nour";
const STAFF: Record<StaffKey, { name: string; commission: number; services: ServiceKey[]; hours: object }> = {
  rana: { name: "رنا", commission: 30, services: ["cut", "color", "blow", "keratin"], hours: FULL_WEEK },
  hiba: { name: "هبة", commission: 30, services: ["cut", "color", "blow"], hours: FULL_WEEK },
  nour: { name: "نور", commission: 25, services: ["mani", "brows"], hours: { ...FULL_WEEK, fri: [] } },
};

const FAKE_NAMES = ["دانة", "مها", "ريم", "جود", "تالا", "رهف", "سلمى", "هيا", "ملك", "رزان"];
const FORMULAS = [
  "صبغة إينوا 6.0 بدون أمونيا + أوكسجين 6٪",
  "صبغة 5.3 + 6.0 نص بنص، أوكسجين 9٪",
  "صبغة 8.1 رمادي فاتح + أوكسجين 6٪",
  "صبغة 4.0 بني غامق + أوكسجين 6٪",
];

// ═══════════════════════════════════════════════════════════

/** عشوائي ثابت البذرة: إعادة التشغيل تعطي نفس السجل، فتتكرّر التجربة كما هي. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ceil5 = (d: Date) => new Date(Math.ceil(d.getTime() / (5 * MIN)) * 5 * MIN);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);

async function main() {
  const args = process.argv.slice(2);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const ri = args.indexOf("--restore");
    if (ri >= 0) return await restore(rl, args[ri + 1]);
    await seed(rl);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

async function pickTenant(rl: readline.Interface) {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true },
  });
  if (tenants.length === 0) throw new Error("لا يوجد متاجر");
  console.log("\nالمتاجر:");
  tenants.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}  (${t.slug})`));
  const n = Number(toAscii((await rl.question("\nاكتب رقم المتجر من القائمة: ")).trim()));
  const t = tenants[n - 1];
  if (!t) throw new Error("رقم غير موجود في القائمة");
  return t;
}

async function askPhone(rl: readline.Interface, q: string, locale: string, optional: boolean) {
  for (;;) {
    const raw = (await rl.question(q)).trim();
    if (!raw && optional) return null;
    try {
      const p = normalizePhone(raw, locale);
      if (isPlausiblePhone(p)) return p;
    } catch {}
    console.log("  ⚠️  رقم غير صالح — اكتبه بمفتاح الدولة، مثل 9627XXXXXXXX");
  }
}

// ═══════════════════════════════════════════════════════════
//  النسخة الاحتياطية
// ═══════════════════════════════════════════════════════════

async function backup(tenantId: string, slug: string): Promise<string> {
  const [tenant, profile, products, faqs, dataSources, services, staff, staffServices, customers, contacts, appointments] =
    await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          name: true, businessType: true, agentName: true, tone: true, customPolicy: true,
          handoffKeywords: true, appointmentsEnabled: true, appointmentSettings: true,
        },
      }),
      prisma.businessProfile.findUnique({ where: { tenantId } }),
      prisma.product.findMany({ where: { tenantId } }),
      prisma.faq.findMany({ where: { tenantId } }),
      prisma.dataSource.findMany({ where: { tenantId } }),
      prisma.service.findMany({ where: { tenantId } }),
      prisma.staff.findMany({ where: { tenantId } }),
      prisma.staffService.findMany({ where: { staff: { tenantId } } }),
      prisma.customer.findMany({ where: { tenantId } }),
      prisma.customerContact.findMany({ where: { tenantId } }),
      prisma.appointment.findMany({ where: { tenantId } }),
    ]);
  const data = {
    version: 1,
    slug,
    tenantId,
    savedAt: new Date().toISOString(),
    tenant, profile, products, faqs, dataSources, services,
    staff: staff.map((s) => ({ ...s, photo: s.photo ? Buffer.from(s.photo).toString("base64") : null })),
    staffServices, customers, contacts, appointments,
  };
  mkdirSync("backups", { recursive: true });
  const file = `backups/${slug}-${data.savedAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** محو كل ما يخص المواعيد للمتجر — بترتيب القيود (المواعيد تمنع حذف ما تشير إليه). */
async function wipeAppointments(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.appointment.deleteMany({ where: { tenantId } });
  await tx.customerContact.deleteMany({ where: { tenantId } });
  await tx.customer.deleteMany({ where: { tenantId } });
  await tx.staffService.deleteMany({ where: { staff: { tenantId } } });
  await tx.staff.deleteMany({ where: { tenantId } });
  await tx.service.deleteMany({ where: { tenantId } });
}

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

// ═══════════════════════════════════════════════════════════
//  التحويل لصالون
// ═══════════════════════════════════════════════════════════

async function seed(rl: readline.Interface) {
  const t = await pickTenant(rl);
  const full = await prisma.tenant.findUniqueOrThrow({
    where: { id: t.id },
    select: { locale: true, timezone: true, appointmentSettings: true },
  });
  const tz = full.timezone || TZ_FALLBACK;

  console.log(`\nسيتحوّل «${t.name}» إلى «${TENANT.name}»: البيانات والتعليمات والمنتجات والأسئلة`);
  console.log("والخدمات والفريق والعملاء والمواعيد. المحادثات والقنوات والرابط تبقى كما هي.");
  console.log("قبل أي تغيير تُحفظ نسخة كاملة في مجلد backups/.\n");

  const testerPhone = await askPhone(rl, "رقم الواتساب اللي رح تجرّب منه (مش رقم المتجر): ", full.locale, false);
  const testerName = (await rl.question("اسمك بالتجربة [سارة]: ")).trim() || "سارة";
  const secondPhone = await askPhone(
    rl,
    "رقم تاني للتجربة كـ«لين» (اختياري — Enter للتخطي): ",
    full.locale,
    true,
  );
  if (secondPhone === testerPhone) throw new Error("الرقمان متطابقان");

  const ok = (await rl.question(`\nاكتب «نعم» للمتابعة على ${t.slug}: `)).trim();
  if (ok !== "نعم") {
    console.log("أُلغي — لم يتغيّر شيء.");
    return;
  }

  const file = await backup(t.id, t.slug);
  console.log(`\n💾 النسخة الاحتياطية: ${file}`);

  const now = new Date();
  const today = toLocal(now, tz).date;
  const at = (daysFromToday: number, hhmm: string) => zonedToUtc(addDays(today, daysFromToday), hhmm, tz);
  const base = ceil5(now);
  const rand = rng(20261020);

  const summary = await prisma.$transaction(
    async (tx) => {
      // ── المحتوى ──
      const prevSettings =
        full.appointmentSettings && typeof full.appointmentSettings === "object" && !Array.isArray(full.appointmentSettings)
          ? (full.appointmentSettings as Record<string, unknown>)
          : {};
      await tx.tenant.update({
        where: { id: t.id },
        data: {
          ...TENANT,
          appointmentsEnabled: true,
          // أسماء القوالب إن وُجدت تبقى — لا نمحو ما ضبطته
          appointmentSettings: {
            ...prevSettings,
            slotStepMinutes: 15,
            bufferMinutes: 0,
            reminderHour: 18,
            delayNotifyMinutes: 10,
            autoNoShowMinutes: 60,
          },
        },
      });
      await tx.businessProfile.upsert({
        where: { tenantId: t.id },
        create: { tenantId: t.id, ...PROFILE },
        update: PROFILE,
      });
      await tx.product.deleteMany({ where: { tenantId: t.id } });
      await tx.product.createMany({
        data: PRODUCTS.map((p) => ({
          tenantId: t.id, ...p, priceUnit: "piece", inStock: true, active: true,
          searchText: `${p.name} ${p.category} ${p.description}`,
        })),
      });
      await tx.faq.deleteMany({ where: { tenantId: t.id } });
      await tx.faq.createMany({ data: FAQS.map((f, i) => ({ tenantId: t.id, ...f, priority: FAQS.length - i })) });
      await tx.dataSource.deleteMany({ where: { tenantId: t.id } });

      // ── الخدمات والفريق ──
      await wipeAppointments(tx, t.id);
      const svc = {} as Record<ServiceKey, string>;
      let order = 0;
      for (const [k, s] of Object.entries(SERVICES) as [ServiceKey, (typeof SERVICES)[ServiceKey]][]) {
        const row = await tx.service.create({
          data: {
            tenantId: t.id, name: s.name, category: s.category, priceMin: s.priceMin, priceMax: s.priceMax,
            defaultMinutes: s.defaultMinutes, processingAfterMinutes: s.processingAfterMinutes ?? 0,
            processingMinutes: s.processingMinutes ?? 0, rebookAfterDays: s.rebookAfterDays ?? null,
            sortOrder: order++,
          },
        });
        svc[k] = row.id;
      }
      const staff = {} as Record<StaffKey, string>;
      order = 0;
      for (const [k, s] of Object.entries(STAFF) as [StaffKey, (typeof STAFF)[StaffKey]][]) {
        const row = await tx.staff.create({
          data: {
            tenantId: t.id, name: s.name, commissionPercent: s.commission,
            workingHours: s.hours as Prisma.InputJsonValue, sortOrder: order++,
          },
        });
        staff[k] = row.id;
        await tx.staffService.createMany({ data: s.services.map((x) => ({ staffId: row.id, serviceId: svc[x] })) });
      }

      // ── العملاء ──
      const tester = await tx.customer.create({
        data: {
          tenantId: t.id, phone: testerPhone, name: testerName, preferredStaffId: staff.rana,
          notes: "حساسية خفيفة من الأمونيا — صبغة بدون أمونيا دائماً.",
        },
      });
      await tx.customerContact.create({
        data: { tenantId: t.id, customerId: tester.id, channel: "WHATSAPP", externalUserId: testerPhone! },
      });
      const leen = await tx.customer.create({
        data: {
          tenantId: t.id, phone: secondPhone, name: "لين", preferredStaffId: staff.rana,
          notes: secondPhone ? null : "عميلة تجريبية بلا رقم.",
        },
      });
      if (secondPhone) {
        await tx.customerContact.create({
          data: { tenantId: t.id, customerId: leen.id, channel: "WHATSAPP", externalUserId: secondPhone },
        });
      }
      const fake: Record<string, string> = {};
      for (const n of FAKE_NAMES) {
        fake[n] = (await tx.customer.create({ data: { tenantId: t.id, name: n, notes: "عميلة تجريبية بلا رقم." } })).id;
      }

      // ── السجل ──
      type Row = Prisma.AppointmentCreateManyInput;
      const rows: Row[] = [];
      const done = (r: {
        customerId: string; staffId: string; service: ServiceKey; startAt: Date;
        actual: number; price: number; notes?: string | null; source?: Row["source"];
      }): Row => {
        const started = plus(r.startAt, Math.floor(rand() * 8));
        return {
          tenantId: t.id, customerId: r.customerId, staffId: r.staffId, serviceId: svc[r.service],
          startAt: r.startAt, plannedMinutes: SERVICES[r.service].defaultMinutes, status: "DONE",
          source: r.source ?? "WALK_IN", startedAt: started, finishedAt: plus(started, r.actual),
          actualMinutes: r.actual, finalPrice: r.price, notes: r.notes ?? null,
          confirmedAt: r.startAt, reminderSentAt: r.startAt,
          // سجلّ الماضي «أُرسل له» تذكير العودة: لا نريد أن تراسل المهمة عملاء وهميين
          rebookSentAt: r.startAt,
        };
      };

      // المشكلة ١: نفس الخدمة — المختبِر ١٥ د، لين ساعة
      for (const [d, m] of [[70, 15], [49, 17], [28, 14]] as const) {
        rows.push(done({ customerId: tester.id, staffId: staff.rana, service: "cut", startAt: at(-d, "12:00"), actual: m, price: 12 }));
      }
      for (const [d, m] of [[65, 62], [44, 58], [23, 60]] as const) {
        rows.push(done({ customerId: leen.id, staffId: staff.rana, service: "cut", startAt: at(-d, "16:00"), actual: m, price: 20 }));
      }
      // «شو الصبغة آخر مرة؟» + تذكير العودة (٣٥ يوماً ⇒ مستحق منذ ٥ أيام)
      rows.push({
        ...done({
          customerId: tester.id, staffId: staff.hiba, service: "color", startAt: at(-40, "11:00"), actual: 105, price: 32,
          notes: "صبغة إينوا 7.1 بدون أمونيا + أوكسجين 6٪، تثبيت ٣٥ دقيقة، الجذور فقط.",
        }),
        rebookSentAt: null,
      });

      // سجلّ عام لشهر — للتقارير ولمتوسط كل مقدّمة خدمة
      const pool = FAKE_NAMES.filter((n) => n !== "دانة" && n !== "مها" && n !== "ريم");
      for (let d = 30; d >= 1; d--) {
        for (const k of Object.keys(STAFF) as StaffKey[]) {
          const times = ["11:00", "14:00", "17:30"].slice(0, 1 + Math.floor(rand() * 3));
          for (const hhmm of times) {
            const sk = STAFF[k].services[Math.floor(rand() * STAFF[k].services.length)];
            const s = SERVICES[sk];
            const customerId = fake[pool[Math.floor(rand() * pool.length)]];
            const startAt = at(-d, hhmm);
            const roll = rand();
            if (roll < 0.07) {
              rows.push({ tenantId: t.id, customerId, staffId: staff[k], serviceId: svc[sk], startAt,
                plannedMinutes: s.defaultMinutes, status: "NO_SHOW", source: "WHATSAPP", reminderSentAt: startAt });
              continue;
            }
            if (roll < 0.11) {
              rows.push({ tenantId: t.id, customerId, staffId: staff[k], serviceId: svc[sk], startAt,
                plannedMinutes: s.defaultMinutes, status: "CANCELLED", source: "WHATSAPP", cancelledAt: startAt });
              continue;
            }
            const actual = Math.round(s.defaultMinutes * (0.75 + rand() * 0.5));
            const price = Math.round(s.priceMin + rand() * ((s.priceMax ?? s.priceMin) - s.priceMin));
            rows.push(done({
              customerId, staffId: staff[k], service: sk, startAt, actual, price,
              notes: sk === "color" ? FORMULAS[Math.floor(rand() * FORMULAS.length)] : null,
              source: rand() < 0.6 ? "WHATSAPP" : "WALK_IN",
            }));
          }
        }
      }
      // ريم غابت قبل — وسيتكرّر اليوم
      rows.push({ tenantId: t.id, customerId: fake["ريم"], staffId: staff.nour, serviceId: svc.mani,
        startAt: at(-12, "15:00"), plannedMinutes: 40, status: "NO_SHOW", source: "WHATSAPP", reminderSentAt: at(-13, "18:00") });

      // ── اليوم: سيناريوهات حيّة حول وقت التشغيل ──
      // التأخير المتسلسل: دانة متأخرة ٢٠ د ولم تبدأ؛ المختبِر بعدها عند رنا
      rows.push({ tenantId: t.id, customerId: fake["دانة"], staffId: staff.rana, serviceId: svc.cut,
        startAt: plus(base, -20), plannedMinutes: 30, status: "CONFIRMED", source: "WHATSAPP", confirmedAt: plus(base, -600) });
      rows.push({ tenantId: t.id, customerId: tester.id, staffId: staff.rana, serviceId: svc.cut,
        startAt: plus(base, 10), plannedMinutes: 15, status: "BOOKED", source: "WHATSAPP" });
      // وقت الانتظار: مها بالصبغة عند هبة منذ ٣٠ د ⇒ هبة فاضية ٣٥ د الآن
      rows.push({ tenantId: t.id, customerId: fake["مها"], staffId: staff.hiba, serviceId: svc.color,
        startAt: plus(base, -30), plannedMinutes: 120, status: "IN_PROGRESS", source: "WALK_IN", startedAt: plus(base, -30) });
      // غياب بلا إلغاء: ريم كان موعدها قبل ساعتين ونصف ولم تأتِ
      rows.push({ tenantId: t.id, customerId: fake["ريم"], staffId: staff.nour, serviceId: svc.mani,
        startAt: plus(base, -150), plannedMinutes: 40, status: "BOOKED", source: "WHATSAPP" });

      // ── بكرا: التذكير وتأكيد/إلغاء من الواتساب ──
      rows.push({ tenantId: t.id, customerId: tester.id, staffId: staff.hiba, serviceId: svc.blow,
        startAt: at(1, "12:00"), plannedMinutes: 30, status: "BOOKED", source: "WHATSAPP" });
      for (const [k, sk, hhmm, n] of [
        ["rana", "keratin", "11:00", "تالا"], ["rana", "cut", "15:00", "جود"],
        ["hiba", "color", "14:00", "سلمى"], ["nour", "mani", "13:00", "هيا"], ["nour", "brows", "16:00", "ملك"],
      ] as const) {
        rows.push({ tenantId: t.id, customerId: fake[n], staffId: staff[k], serviceId: svc[sk],
          startAt: at(1, hhmm), plannedMinutes: SERVICES[sk].defaultMinutes, status: "BOOKED", source: "WHATSAPP" });
      }

      await tx.appointment.createMany({ data: rows });

      // ── عدّادات العملاء من السجل نفسه ──
      const ids = [tester.id, leen.id, ...Object.values(fake)];
      for (const id of ids) {
        const mine = rows.filter((r) => r.customerId === id);
        const visits = mine.filter((r) => r.status === "DONE");
        const last = visits.map((r) => new Date(r.finishedAt as Date)).sort((a, b) => +b - +a)[0] ?? null;
        await tx.customer.update({
          where: { id },
          data: {
            visitCount: visits.length,
            noShowCount: mine.filter((r) => r.status === "NO_SHOW").length,
            lastVisitAt: last,
          },
        });
      }
      return { appointments: rows.length, customers: ids.length };
    },
    { timeout: 180_000, maxWait: 20_000 },
  );

  const fmt = (d: Date) => toLocal(d, tz).time;
  console.log(`\n✅ صار «${TENANT.name}» — ${summary.appointments} موعداً و${summary.customers} عميلاً`);
  console.log(`\nسيناريوهات اليوم (بتوقيت المتجر):`);
  console.log(`  • دانة عند رنا ${fmt(plus(base, -20))} — متأخرة ولم تبدأ`);
  console.log(`  • ${testerName} (رقمك) عند رنا ${fmt(plus(base, 10))} — ستتأثر بتأخير دانة`);
  console.log(`  • مها بالصبغة عند هبة منذ ${fmt(plus(base, -30))} — هبة فاضية وقت التثبيت`);
  console.log(`  • ريم عند نور ${fmt(plus(base, -150))} — لم تأتِ`);
  console.log(`  • بكرا ١٢:٠٠: ${testerName} سشوار عند هبة — للتذكير`);
  console.log(`\nللرجوع: npm run demo:salon -- --restore ${file}\n`);
}

// ═══════════════════════════════════════════════════════════
//  الإرجاع
// ═══════════════════════════════════════════════════════════

async function restore(rl: readline.Interface, file: string | undefined) {
  if (!file) throw new Error("اكتب مسار ملف النسخة: npm run demo:salon -- --restore backups/<ملف>.json");
  const b = JSON.parse(readFileSync(file, "utf8"));
  if (b.version !== 1 || !b.tenantId) throw new Error("ملف نسخة غير معروف");
  const t = await prisma.tenant.findUnique({ where: { id: b.tenantId }, select: { slug: true, name: true } });
  if (!t) throw new Error("المتجر في النسخة غير موجود");

  const ok = (await rl.question(`سيعود «${t.name}» (${t.slug}) لما كان عليه في ${b.savedAt}. اكتب «نعم»: `)).trim();
  if (ok !== "نعم") return console.log("أُلغي — لم يتغيّر شيء.");

  const tenantId: string = b.tenantId;
  await prisma.$transaction(
    async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { ...b.tenant, appointmentSettings: json(b.tenant.appointmentSettings) },
      });
      if (b.profile) {
        const { id: _id, tenantId: _t, updatedAt: _u, ...p } = b.profile;
        await tx.businessProfile.upsert({ where: { tenantId }, create: { tenantId, ...p }, update: p });
      } else {
        await tx.businessProfile.deleteMany({ where: { tenantId } });
      }
      await tx.product.deleteMany({ where: { tenantId } });
      if (b.products.length)
        await tx.product.createMany({ data: b.products.map((p: any) => ({ ...p, attributes: json(p.attributes) })) });
      await tx.faq.deleteMany({ where: { tenantId } });
      if (b.faqs.length) await tx.faq.createMany({ data: b.faqs });
      await tx.dataSource.deleteMany({ where: { tenantId } });
      if (b.dataSources.length)
        await tx.dataSource.createMany({
          data: b.dataSources.map((d: any) => ({ ...d, config: json(d.config), value: json(d.value) })),
        });

      await wipeAppointments(tx, tenantId);
      if (b.services.length) await tx.service.createMany({ data: b.services });
      if (b.staff.length)
        await tx.staff.createMany({
          data: b.staff.map((s: any) => ({ ...s, photo: s.photo ? Buffer.from(s.photo, "base64") : null })),
        });
      if (b.staffServices.length) await tx.staffService.createMany({ data: b.staffServices });
      if (b.customers.length) await tx.customer.createMany({ data: b.customers });
      if (b.contacts.length) await tx.customerContact.createMany({ data: b.contacts });
      if (b.appointments.length) await tx.appointment.createMany({ data: b.appointments });
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  console.log(`✅ عاد «${b.tenant.name}» كما كان.`);
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
