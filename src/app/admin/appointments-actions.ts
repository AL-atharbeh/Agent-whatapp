"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeTenant } from "@/lib/session";
import {
  WEEKDAYS,
  bookAppointment,
  cancelAppointment,
  confirmAppointment,
  createCustomer,
  createService,
  createStaff,
  finishAppointment,
  markNoShow,
  setStaffPhoto,
  startAppointment,
  updateCustomer,
  updateService,
  updateStaff,
  type Weekday,
} from "@/lib/appointments";
import { report } from "./report";

/**
 * إجراءات لوحة المواعيد — لمالك المنصة ولصاحب النشاط معاً.
 *
 * كل منطق المواعيد في @/lib/appointments؛ هنا قراءة النموذج والصلاحية فقط.
 * نسخة ثانية من قاعدة التداخل أو الانتقالات هنا كانت ستختلف يوماً عن نسخة
 * الجوال والوكيل، فيُقبل في اللوحة حجزٌ يرفضه التطبيق.
 *
 * كل إجراء يحمل `back`: المسار الذي جاء منه (/admin/<slug>/appointments… أو
 * /app/appointments…) — النماذج نفسها تُعرض في البوابتين، والخطأ والتحديث
 * يجب أن يعودا للصفحة التي يراها المستخدم لا لبوابة لا يدخلها.
 */

const s = (v: FormDataEntryValue | null) => {
  const t = v?.toString().trim();
  return t ? t : null;
};

/** رقم من حقل نموذج — الأرقام العربية-الهندية تُقبل كما تُكتب على لوحة عربية. */
const num = (v: FormDataEntryValue | null): number | null => {
  const t = s(v)?.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, ".");
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
};

const BACK_RE = /^\/(admin\/[A-Za-z0-9_-]+|app)\/appointments(\/[A-Za-z0-9_-]+)*(\?[^#\s]*)?$/;

/**
 * المسار الآمن للعودة. أي شيء خارج صفحات المواعيد يُستبدل: حقل مخفي يعدّله
 * أي أحد، ولا يجوز أن يصير بوابة إعادة توجيه لموقع آخر.
 */
function backOf(formData: FormData, slug: string): string {
  const b = s(formData.get("back"));
  return b && BACK_RE.test(b) ? b : `/admin/${slug}/appointments`;
}

/** يزيل ?err القديم من مسار العودة كي لا تتراكم الرسائل. */
const clean = (path: string) => path.replace(/([?&])err=[^&]*(&|$)/, "$1").replace(/[?&]$/, "");

/** صلاحية المتجر + تفعيل الوحدة — إجراء على متجر لم يفعّلها يُرفض ولو أُرسل يدوياً. */
async function tenantFor(formData: FormData) {
  const slug = s(formData.get("slug"));
  if (!slug) throw new Error("طلب ناقص");
  const tenantId = await authorizeTenant(slug);
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { appointmentsEnabled: true },
  });
  if (!t?.appointmentsEnabled) throw new Error("وحدة المواعيد غير مفعّلة لهذا المتجر");
  return { slug, tenantId };
}

const FIELD_AR: Record<string, string> = {
  name: "الاسم",
  priceMin: "السعر الأدنى",
  priceMax: "السعر الأعلى",
  defaultMinutes: "المدة الافتراضية",
  processingAfterMinutes: "بداية الانتظار",
  processingMinutes: "مدة الانتظار",
  rebookAfterDays: "أيام العودة",
  sortOrder: "الترتيب",
  workingHours: "أوقات الدوام",
  commissionPercent: "نسبة العمولة",
  phone: "الهاتف",
  notes: "الملاحظات",
};

/** خطأ zod بجملة عربية تسمّي الحقل — نصّه الأصلي JSON لا يقرؤه صاحب نشاط. */
function friendly(err: unknown): string | null {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const field = String(issue?.path[0] ?? "");
    return `تحقّق من حقل «${FIELD_AR[field] ?? field ?? "غير معروف"}»${
      issue?.message && !issue.message.startsWith("Invalid") && !issue.message.startsWith("Too")
        ? `: ${issue.message}`
        : ""
    }`;
  }
  return null;
}

/** يلفّ الإجراء: الخطأ يعود للصفحة نفسها برسالته، والنجاح يحدّثها. */
async function run(formData: FormData, fn: (ctx: { slug: string; tenantId: string }) => Promise<string | void>) {
  const slugRaw = s(formData.get("slug")) ?? "";
  const back = clean(backOf(formData, slugRaw));
  let next: string | void;
  try {
    next = await fn(await tenantFor(formData));
  } catch (err) {
    report(err, back, friendly);
  }
  revalidatePath(back.split("?")[0]);
  if (next) redirect(next);
}

// ═══════════════════════════════════════════════════════════
//  إعدادات الوحدة — مالك المنصة وحده
// ═══════════════════════════════════════════════════════════

const tpl = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,512}$/, "أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط")
  .nullable();

const settingsSchema = z.object({
  slotStepMinutes: z.number().int().min(5).max(120),
  bufferMinutes: z.number().int().min(0).max(120),
  reminderHour: z.number().int().min(0).max(23),
  delayNotifyMinutes: z.number().int().min(1).max(240),
  autoNoShowMinutes: z.number().int().min(5).max(1440),
  reminderTemplate: tpl,
  delayTemplate: tpl,
  rebookTemplate: tpl,
});

/**
 * إعدادات المواعيد — لمالك المنصة ولصاحب النشاط. الحدود نفسها التي يطبّقها
 * settingsOf عند القراءة — قيمة خارجها كانت ستُحفظ ثم تُهمَل بصمت، فيظن من
 * ضبطها أنه ضبط ما لم يُضبط.
 *
 * التفعيل نفسه ليس هنا: setAppointmentsEnabled لمالك المنصة وحده، وحفظ
 * الضبط لمتجر مطفأ مرفوض حتى لا تصير البوابة طريقاً خلفياً لتشغيل الوحدة.
 */
export async function saveAppointmentSettings(formData: FormData) {
  const slug = s(formData.get("slug")) ?? "";
  const path = s(formData.get("portal")) ? "/app/business" : `/admin/${slug}`;
  try {
    const tenantId = await authorizeTenant(slug);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { appointmentsEnabled: true } });
    if (!t.appointmentsEnabled) throw new Error("وحدة المواعيد غير مفعّلة لهذا المتجر");
    const v = settingsSchema.parse({
      slotStepMinutes: num(formData.get("slotStepMinutes")),
      bufferMinutes: num(formData.get("bufferMinutes")),
      reminderHour: num(formData.get("reminderHour")),
      delayNotifyMinutes: num(formData.get("delayNotifyMinutes")),
      autoNoShowMinutes: num(formData.get("autoNoShowMinutes")),
      reminderTemplate: s(formData.get("reminderTemplate")),
      delayTemplate: s(formData.get("delayTemplate")),
      rebookTemplate: s(formData.get("rebookTemplate")),
    });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { appointmentSettings: v as Prisma.InputJsonValue },
    });
  } catch (err) {
    report(err, path, (e) =>
      e instanceof z.ZodError ? "تحقّق من إعدادات المواعيد: قيمة خارج حدودها أو اسم قالب غير صالح" : null,
    );
  }
  revalidatePath(path);
}

// ═══════════════════════════════════════════════════════════
//  اليوم: الحجز ودورة الموعد
// ═══════════════════════════════════════════════════════════

/**
 * «حجز جديد» من اللوحة. العميل بالرقم: موجود ⇒ يُستعمل (createCustomer يدمج)،
 * وإلا يُنشأ. الوقت مختار من findSlots — وإن أُخذ بين العرض والحجز يعود
 * SLOT_TAKEN برسالته فيختار غيره.
 */
export async function bookFromDashboard(formData: FormData) {
  await run(formData, async ({ tenantId }) => {
    const slot = s(formData.get("slot"));
    const [staffId, startIso] = slot?.split("|") ?? [];
    const serviceId = s(formData.get("serviceId"));
    if (!staffId || !startIso || !serviceId) throw new Error("اختر خدمة ووقتاً");
    const phone = s(formData.get("phone"));
    const name = s(formData.get("name"));
    const { customer } = await createCustomer(tenantId, { phone, name });
    const source = s(formData.get("source")) === "PHONE" ? "PHONE" : s(formData.get("source")) === "WALK_IN" ? "WALK_IN" : "DASHBOARD";
    await bookAppointment(tenantId, {
      customerId: customer.id,
      serviceId,
      staffId,
      startAt: new Date(startIso),
      source,
      notes: s(formData.get("notes")),
    });
    // بعد الحجز: اليوم نفسه بلا نموذج الحجز المفتوح
    const date = s(formData.get("date"));
    const base = backOf(formData, s(formData.get("slug")) ?? "").split("?")[0];
    return date ? `${base}?date=${date}` : base;
  });
}

/** بدأت / خلصت / غياب / إلغاء / تأكيد — زرّ واحد لكل انتقال. */
export async function appointmentAction(formData: FormData) {
  await run(formData, async ({ tenantId }) => {
    const id = s(formData.get("id"));
    if (!id) throw new Error("طلب ناقص");
    switch (s(formData.get("action"))) {
      case "confirm":
        await confirmAppointment(tenantId, id);
        break;
      case "start":
        await startAppointment(tenantId, id);
        break;
      case "finish": {
        const price = num(formData.get("finalPrice"));
        if (Number.isNaN(price)) throw new Error("السعر ليس رقماً");
        await finishAppointment(tenantId, id, { finalPrice: price, notes: s(formData.get("notes")) });
        break;
      }
      case "noShow":
        await markNoShow(tenantId, id);
        break;
      case "cancel":
        await cancelAppointment(tenantId, id);
        break;
      default:
        throw new Error("إجراء غير معروف");
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  الخدمات
// ═══════════════════════════════════════════════════════════

const orNull = (x: number | null) => (x === null ? null : x);

export async function saveService(formData: FormData) {
  await run(formData, async ({ tenantId }) => {
    const id = s(formData.get("id"));
    const processingMinutes = num(formData.get("processingMinutes")) ?? 0;
    const input = {
      name: s(formData.get("name")) ?? "",
      category: s(formData.get("category")),
      priceMin: num(formData.get("priceMin")) ?? NaN,
      priceMax: orNull(num(formData.get("priceMax"))),
      defaultMinutes: num(formData.get("defaultMinutes")) ?? NaN,
      // الانتظار اختياري: بلا مدة لا معنى لبدايته
      processingAfterMinutes: processingMinutes > 0 ? (num(formData.get("processingAfterMinutes")) ?? 0) : 0,
      processingMinutes,
      rebookAfterDays: orNull(num(formData.get("rebookAfterDays"))),
      active: formData.get("active") === "on",
      sortOrder: num(formData.get("sortOrder")) ?? 0,
    };
    if (id) await updateService(tenantId, id, input);
    else await createService(tenantId, input);
  });
}

// ═══════════════════════════════════════════════════════════
//  الفريق
// ═══════════════════════════════════════════════════════════

/**
 * أوقات الدوام من النموذج: لكل يوم فترتان اختياريتان (صباحية ومسائية).
 * فترة بطرف واحد فقط خطأ لا فراغ — نسيان «إلى» لا يجب أن يحذف يوم العمل بصمت.
 */
function hoursFrom(formData: FormData) {
  const out: Partial<Record<Weekday, [string, string][]>> = {};
  for (const d of WEEKDAYS) {
    const ranges: [string, string][] = [];
    for (const i of [1, 2]) {
      const a = s(formData.get(`${d}_from${i}`));
      const b = s(formData.get(`${d}_to${i}`));
      if (!a && !b) continue;
      if (!a || !b) throw new Error("أكمل بداية ونهاية كل فترة دوام");
      ranges.push([a, b]);
    }
    out[d] = ranges;
  }
  return out;
}

export async function saveStaff(formData: FormData) {
  await run(formData, async ({ tenantId }) => {
    const id = s(formData.get("id"));
    const commission = num(formData.get("commissionPercent"));
    const input = {
      name: s(formData.get("name")) ?? "",
      phone: s(formData.get("phone")),
      workingHours: hoursFrom(formData),
      commissionPercent: commission === null ? null : commission,
      active: formData.get("active") === "on",
      sortOrder: num(formData.get("sortOrder")) ?? 0,
      serviceIds: formData.getAll("serviceIds").map(String).filter(Boolean),
    };
    const saved = id ? await updateStaff(tenantId, id, input) : await createStaff(tenantId, input);

    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      await setStaffPhoto(tenantId, saved.id, {
        bytes: new Uint8Array(await photo.arrayBuffer()),
        mime: photo.type || null,
      });
    } else if (formData.get("removePhoto") === "on") {
      await setStaffPhoto(tenantId, saved.id, null);
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  العملاء
// ═══════════════════════════════════════════════════════════

export async function saveCustomer(formData: FormData) {
  await run(formData, async ({ tenantId }) => {
    const id = s(formData.get("id"));
    const input = {
      name: s(formData.get("name")),
      phone: s(formData.get("phone")),
      notes: s(formData.get("notes")),
      preferredStaffId: s(formData.get("preferredStaffId")),
    };
    if (id) {
      await updateCustomer(tenantId, id, input);
      return;
    }
    const { customer } = await createCustomer(tenantId, input);
    const base = backOf(formData, s(formData.get("slug")) ?? "").split("?")[0];
    return `${base.replace(/\/customers.*$/, "")}/customers/${customer.id}`;
  });
}
