import { z } from "zod";
import { Prisma, type Channel, type Customer } from "@prisma/client";
import { prisma } from "../db";
import { displayName } from "../display";
import { isPlausiblePhone, normalizePhone } from "../phone";
import { invalid, notFound } from "./errors";
import { estimateFrom, CUSTOMER_SAMPLES, type Estimate } from "./rules";
import { loadApptTenant } from "./tenant";
import { upcomingFor, type AppointmentView } from "./booking";

/**
 * العملاء — التعرّف التلقائي من القنوات، والملف الكامل بالتاريخ.
 *
 * العميل الواحد قد يراسل من واتساب وانستقرام ويأتي بنفسه. سجلٌّ لكل قناة
 * يعني ثلاثة عملاء بثلاثة تواريخ، والمقدِّر يتعلّم من ثلث زياراته. فالعميل
 * سجلّ واحد، والقنوات صفوف CustomerContact تشير إليه.
 */

export type CustomerView = {
  id: string;
  name: string | null;
  phone: string | null;
  notes: string | null;
  preferredStaffId: string | null;
  visitCount: number;
  noShowCount: number;
  lastVisitAt: string | null;
  createdAt: string;
};

export function toCustomerView(c: Customer): CustomerView {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    preferredStaffId: c.preferredStaffId,
    visitCount: c.visitCount,
    noShowCount: c.noShowCount,
    lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

const isUnique = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * العميل صاحب هذه القناة — يُنشأ أو يُربط عند أول رسالة.
 *
 * واتساب يعطي الرقم: عميل سجّله الفريق برقمه (حضورياً أو بالهاتف)
 * يُربط تلقائياً حين يراسل لاحقاً من الرقم نفسه، بدل أن يصير عميلين.
 *
 * السباق مقبول هنا: رسالتان متزامنتان من نفس العميل قد تحاولان الإنشاء
 * معاً، فيصطدم الثاني بقيد التفرّد ويقرأ ما أنشأه الأول.
 */
export async function upsertCustomerFromContact(
  tenantId: string,
  contact: { channel: Channel; externalUserId: string; name?: string | null },
): Promise<Customer> {
  const key = {
    tenantId_channel_externalUserId: {
      tenantId,
      channel: contact.channel,
      externalUserId: contact.externalUserId,
    },
  };
  const name = displayName(contact.name);

  const found = await prisma.customerContact.findUnique({ where: key, include: { customer: true } });
  if (found) {
    // الاسم من ملف واتساب يملأ الفراغ فقط — لا يكتب فوق اسم صحّحه الفريق
    if (name && !found.customer.name) {
      return prisma.customer.update({ where: { id: found.customer.id }, data: { name } });
    }
    return found.customer;
  }

  const phone =
    contact.channel === "WHATSAPP" && isPlausiblePhone(contact.externalUserId)
      ? contact.externalUserId
      : null;

  try {
    return await prisma.$transaction(async (tx) => {
      let customer = phone
        ? await tx.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } })
        : null;
      if (!customer) {
        customer = await tx.customer.create({ data: { tenantId, phone, name } });
      } else if (name && !customer.name) {
        customer = await tx.customer.update({ where: { id: customer.id }, data: { name } });
      }
      await tx.customerContact.create({
        data: {
          tenantId,
          customerId: customer.id,
          channel: contact.channel,
          externalUserId: contact.externalUserId,
        },
      });
      return customer;
    });
  } catch (err) {
    if (!isUnique(err)) throw err;
    const again = await prisma.customerContact.findUnique({ where: key, include: { customer: true } });
    if (again) return again.customer;
    if (phone) {
      const byPhone = await prisma.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
      if (byPhone) return byPhone;
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
//  CRUD
// ═══════════════════════════════════════════════════════════

export const customerFields = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  preferredStaffId: z.string().min(1).max(64).nullable().optional(),
});
export type CustomerInput = z.infer<typeof customerFields>;

async function cleanPhone(tenantId: string, raw: string | null | undefined) {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  const t = await loadApptTenant(tenantId);
  let digits: string;
  try {
    digits = normalizePhone(raw, t.locale);
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : "رقم غير صالح");
  }
  if (!isPlausiblePhone(digits)) throw invalid(`رقم غير صالح: ${raw}`);
  return digits;
}

async function ownStaff(tenantId: string, id: string | null | undefined) {
  if (!id) return;
  const n = await prisma.staff.count({ where: { id, tenantId } });
  if (!n) throw notFound("مقدّم الخدمة");
}

export async function getCustomer(tenantId: string, id: string): Promise<Customer> {
  const c = await prisma.customer.findFirst({ where: { id, tenantId } });
  if (!c) throw notFound("العميل");
  return c;
}

/**
 * إضافة عميل من اللوحة أو التطبيق.
 *
 * الرقم موجود مسبقاً ⇒ نعيد الموجود ونملأ فراغاته، لا خطأ: العميل الذي
 * راسل على واتساب أمس أُنشئ تلقائياً، والفريق لا يعرف ذلك حين يضيفه
 * اليوم كعميل حضوري. خطأ «مسجّل» يوقفهم؛ الدمج هو ما يقصدونه.
 */
export async function createCustomer(
  tenantId: string,
  input: CustomerInput,
): Promise<{ customer: Customer; existed: boolean }> {
  const v = customerFields.parse(input);
  const phone = await cleanPhone(tenantId, v.phone);
  await ownStaff(tenantId, v.preferredStaffId);
  const name = v.name ? displayName(v.name) : null;
  if (!phone && !name) throw invalid("اكتب الاسم أو الرقم على الأقل");

  if (phone) {
    const existing = await prisma.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    if (existing) {
      const customer = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...(name && !existing.name ? { name } : {}),
          ...(v.notes && !existing.notes ? { notes: v.notes } : {}),
          ...(v.preferredStaffId && !existing.preferredStaffId
            ? { preferredStaffId: v.preferredStaffId }
            : {}),
        },
      });
      return { customer, existed: true };
    }
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        phone: phone ?? null,
        name,
        notes: v.notes ?? null,
        preferredStaffId: v.preferredStaffId ?? null,
      },
    });
    return { customer, existed: false };
  } catch (err) {
    if (isUnique(err) && phone) {
      const customer = await prisma.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
      if (customer) return { customer, existed: true };
    }
    throw err;
  }
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  patch: CustomerInput,
): Promise<Customer> {
  const v = customerFields.parse(patch);
  await getCustomer(tenantId, id);
  const phone = await cleanPhone(tenantId, v.phone);
  await ownStaff(tenantId, v.preferredStaffId);
  try {
    return await prisma.customer.update({
      where: { id, tenantId },
      data: {
        ...(v.name !== undefined ? { name: v.name ? displayName(v.name) : null } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(v.notes !== undefined ? { notes: v.notes || null } : {}),
        ...(v.preferredStaffId !== undefined ? { preferredStaffId: v.preferredStaffId } : {}),
      },
    });
  } catch (err) {
    if (isUnique(err)) throw invalid("هذا الرقم مسجّل لعميل آخر");
    throw err;
  }
}

/**
 * بحث بالاسم أو الرقم. أرقام فقط ⇒ بحث في الرقم (آخر الخانات تكفي:
 * «6649» تجد +962770466649)؛ غيره ⇒ الاسم. فارغ ⇒ الأحدث زيارة.
 */
export async function searchCustomers(
  tenantId: string,
  q: string,
  limit = 20,
): Promise<Customer[]> {
  const term = q.trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const digits = term.replace(/[^\d]/g, "");
  const take = Math.min(Math.max(limit, 1), 50);

  if (!term) {
    return prisma.customer.findMany({
      where: { tenantId },
      orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take,
    });
  }
  const byPhone = digits.length >= 3 && digits.length === term.replace(/[\s+\-()]/g, "").length;
  return prisma.customer.findMany({
    where: byPhone
      ? { tenantId, phone: { contains: digits } }
      : { tenantId, name: { contains: term, mode: "insensitive" } },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take,
  });
}

// ═══════════════════════════════════════════════════════════
//  الملف الكامل
// ═══════════════════════════════════════════════════════════

export type LearnedDuration = {
  serviceId: string;
  serviceName: string;
  defaultMinutes: number;
  /** حقول Estimate مسطّحة — ما يحجز به المقدِّر لهذا العميل الآن */
  minutes: number;
  basis: Estimate["basis"];
  samples: number;
  /** آخر المدد الفعلية، الأحدث أولاً — ليرى الموظف من أين جاء الرقم */
  recentMinutes: number[];
};

export type CustomerHistoryItem = {
  id: string;
  status: string;
  startAt: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  actualMinutes: number | null;
  finalPrice: number | null;
  notes: string | null;
};

export type CustomerProfile = {
  customer: CustomerView;
  channels: { channel: Channel; externalUserId: string }[];
  history: CustomerHistoryItem[];
  learned: LearnedDuration[];
  upcoming: AppointmentView[];
};

/**
 * الملف: الزيارات، والمدد المتعلَّمة لكل خدمة، والملاحظات.
 * المدد المتعلَّمة بنفس المقدِّر الذي يحجز — ما يراه الفريق هو ما يُحجز به.
 */
export async function customerProfile(tenantId: string, id: string): Promise<CustomerProfile> {
  const customer = await getCustomer(tenantId, id);
  const [contacts, appts] = await Promise.all([
    prisma.customerContact.findMany({
      where: { tenantId, customerId: id },
      select: { channel: true, externalUserId: true },
    }),
    prisma.appointment.findMany({
      where: { tenantId, customerId: id },
      orderBy: { startAt: "desc" },
      take: 100,
      include: {
        service: { select: { name: true, defaultMinutes: true } },
        staff: { select: { name: true } },
      },
    }),
  ]);

  const byService = new Map<string, { name: string; def: number; mins: number[] }>();
  for (const a of appts) {
    if (a.status !== "DONE" || a.actualMinutes == null) continue;
    const e = byService.get(a.serviceId) ?? { name: a.service.name, def: a.service.defaultMinutes, mins: [] };
    if (e.mins.length < CUSTOMER_SAMPLES) e.mins.push(a.actualMinutes);
    byService.set(a.serviceId, e);
  }

  return {
    customer: toCustomerView(customer),
    channels: contacts,
    history: appts.slice(0, 50).map((a) => ({
      id: a.id,
      status: a.status,
      startAt: a.startAt.toISOString(),
      serviceId: a.serviceId,
      serviceName: a.service.name,
      staffId: a.staffId,
      staffName: a.staff.name,
      actualMinutes: a.actualMinutes,
      finalPrice: a.finalPrice == null ? null : Number(a.finalPrice),
      notes: a.notes,
    })),
    learned: [...byService.entries()].map(([serviceId, e]) => ({
      serviceId,
      serviceName: e.name,
      defaultMinutes: e.def,
      ...estimateFrom(e.mins, [], e.def),
      recentMinutes: e.mins,
    })),
    upcoming: await upcomingFor(tenantId, id),
  };
}
