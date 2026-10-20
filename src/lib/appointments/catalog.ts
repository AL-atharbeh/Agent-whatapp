import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { invalid, notFound } from "./errors";
import { checkPhoto } from "./photo";
import { parseWorkingHours, workingHoursSchema, type WorkingHours } from "./rules";

/**
 * الخدمات والفريق — CRUD مقيّد بالمتجر، تستعمله اللوحة والجوال معاً.
 *
 * كل معرّف يأتي من الخارج يُطابَق مع tenantId قبل أي كتابة: خدمة من متجر
 * آخر تُعامل كغير موجودة، لا كخدمة يمكن ربطها بأحد من الفريق هنا.
 */

const money = z.number().finite().min(0).max(10_000_000);
const minutes = (max: number) => z.number().int().min(0).max(max);

export const serviceFields = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).nullable().optional(),
  priceMin: money,
  priceMax: money.nullable().optional(),
  defaultMinutes: z.number().int().min(5).max(720),
  processingAfterMinutes: minutes(720).optional(),
  processingMinutes: minutes(720).optional(),
  rebookAfterDays: z.number().int().min(1).max(730).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(-10000).max(10000).optional(),
});
export type ServiceInput = z.infer<typeof serviceFields>;
export const servicePatch = serviceFields.partial();
export type ServicePatch = z.infer<typeof servicePatch>;

/**
 * قواعد بين الحقول — بعد دمج التعديل مع القائم، لأن تعديلاً يغيّر
 * priceMin وحده قد يجعله أكبر من priceMax المخزّن.
 */
function checkService(s: {
  priceMin: number;
  priceMax: number | null;
  defaultMinutes: number;
  processingAfterMinutes: number;
  processingMinutes: number;
}) {
  if (s.priceMax != null && s.priceMax < s.priceMin) throw invalid("السعر الأعلى أقل من الأدنى");
  // انتظار يتجاوز مدة الخدمة يعني مقدّم خدمة «حرّاً» بعد انتهاء الموعد — رقم بلا معنى
  if (s.processingMinutes > 0 && s.processingAfterMinutes + s.processingMinutes > s.defaultMinutes) {
    throw invalid("وقت الانتظار يتجاوز مدة الخدمة");
  }
}

export type ServiceView = {
  id: string;
  name: string;
  category: string | null;
  priceMin: number;
  priceMax: number | null;
  defaultMinutes: number;
  processingAfterMinutes: number;
  processingMinutes: number;
  rebookAfterDays: number | null;
  active: boolean;
  sortOrder: number;
  staffIds: string[];
};

const serviceInclude = { staff: { select: { staffId: true } } } as const;
type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;

export function toServiceView(s: ServiceRow): ServiceView {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    priceMin: Number(s.priceMin),
    priceMax: s.priceMax == null ? null : Number(s.priceMax),
    defaultMinutes: s.defaultMinutes,
    processingAfterMinutes: s.processingAfterMinutes,
    processingMinutes: s.processingMinutes,
    rebookAfterDays: s.rebookAfterDays,
    active: s.active,
    sortOrder: s.sortOrder,
    staffIds: s.staff.map((x) => x.staffId),
  };
}

export async function listServices(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ServiceView[]> {
  const rows = await prisma.service.findMany({
    where: { tenantId, ...(opts.includeInactive ? {} : { active: true }) },
    include: serviceInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toServiceView);
}

export async function getService(tenantId: string, id: string): Promise<ServiceView> {
  const s = await prisma.service.findFirst({ where: { id, tenantId }, include: serviceInclude });
  if (!s) throw notFound("الخدمة");
  return toServiceView(s);
}

export async function createService(tenantId: string, input: ServiceInput): Promise<ServiceView> {
  const v = serviceFields.parse(input);
  const merged = {
    priceMin: v.priceMin,
    priceMax: v.priceMax ?? null,
    defaultMinutes: v.defaultMinutes,
    processingAfterMinutes: v.processingAfterMinutes ?? 0,
    processingMinutes: v.processingMinutes ?? 0,
  };
  checkService(merged);
  const s = await prisma.service.create({
    data: {
      tenantId,
      name: v.name,
      category: v.category ?? null,
      ...merged,
      rebookAfterDays: v.rebookAfterDays ?? null,
      active: v.active ?? true,
      sortOrder: v.sortOrder ?? 0,
    },
    include: serviceInclude,
  });
  return toServiceView(s);
}

export async function updateService(
  tenantId: string,
  id: string,
  patch: ServicePatch,
): Promise<ServiceView> {
  const v = servicePatch.parse(patch);
  const cur = await getService(tenantId, id);
  checkService({
    priceMin: v.priceMin ?? cur.priceMin,
    priceMax: v.priceMax === undefined ? cur.priceMax : v.priceMax,
    defaultMinutes: v.defaultMinutes ?? cur.defaultMinutes,
    processingAfterMinutes: v.processingAfterMinutes ?? cur.processingAfterMinutes,
    processingMinutes: v.processingMinutes ?? cur.processingMinutes,
  });
  const s = await prisma.service.update({
    where: { id, tenantId },
    data: v,
    include: serviceInclude,
  });
  return toServiceView(s);
}

// ═══════════════════════════════════════════════════════════
//  الفريق (مقدّمو الخدمة)
// ═══════════════════════════════════════════════════════════

export const staffFields = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).nullable().optional(),
  workingHours: workingHoursSchema,
  commissionPercent: z.number().finite().min(0).max(100).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(-10000).max(10000).optional(),
  serviceIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});
export type StaffInput = z.infer<typeof staffFields>;
export const staffPatch = staffFields.partial();
export type StaffPatch = z.infer<typeof staffPatch>;

export type StaffView = {
  id: string;
  name: string;
  phone: string | null;
  /** بصمة الصورة — null بلا صورة. المسار يبنيه المستهلك (الجوال/اللوحة) */
  photoVersion: string | null;
  workingHours: WorkingHours;
  commissionPercent: number | null;
  active: boolean;
  sortOrder: number;
  serviceIds: string[];
};

// الصورة نفسها خارج كل استعلام قائمة: ١٥٠ كيلوبايت × عدد الفريق تُقرأ
// من القاعدة في كل فتح لشاشة اليوم بلا حاجة — الصورة لها مسارها المخبّأ.
export const staffSelect = {
  id: true,
  name: true,
  phone: true,
  photoEtag: true,
  workingHours: true,
  commissionPercent: true,
  active: true,
  sortOrder: true,
  services: { select: { serviceId: true } },
} as const;
type StaffRow = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

export function toStaffView(s: StaffRow): StaffView {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    photoVersion: s.photoEtag,
    workingHours: parseWorkingHours(s.workingHours),
    commissionPercent: s.commissionPercent == null ? null : Number(s.commissionPercent),
    active: s.active,
    sortOrder: s.sortOrder,
    serviceIds: s.services.map((x) => x.serviceId),
  };
}

export async function listStaff(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<StaffView[]> {
  const rows = await prisma.staff.findMany({
    where: { tenantId, ...(opts.includeInactive ? {} : { active: true }) },
    select: staffSelect,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toStaffView);
}

export async function getStaff(tenantId: string, id: string): Promise<StaffView> {
  const s = await prisma.staff.findFirst({ where: { id, tenantId }, select: staffSelect });
  if (!s) throw notFound("مقدّم الخدمة");
  return toStaffView(s);
}

/** يتحقّق أن كل الخدمات لهذا المتجر — خدمة غريبة واحدة تُبطل الطلب كله. */
async function ownServices(tenantId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const n = await prisma.service.count({ where: { tenantId, id: { in: unique } } });
  if (n !== unique.length) throw notFound("الخدمة");
  return unique;
}

export async function createStaff(tenantId: string, input: StaffInput): Promise<StaffView> {
  const v = staffFields.parse(input);
  const serviceIds = await ownServices(tenantId, v.serviceIds ?? []);
  const s = await prisma.staff.create({
    data: {
      tenantId,
      name: v.name,
      phone: v.phone ?? null,
      workingHours: v.workingHours as Prisma.InputJsonValue,
      commissionPercent: v.commissionPercent ?? null,
      active: v.active ?? true,
      sortOrder: v.sortOrder ?? 0,
      services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
    },
    select: staffSelect,
  });
  return toStaffView(s);
}

export async function updateStaff(tenantId: string, id: string, patch: StaffPatch): Promise<StaffView> {
  const v = staffPatch.parse(patch);
  await getStaff(tenantId, id);
  const serviceIds = v.serviceIds ? await ownServices(tenantId, v.serviceIds) : null;

  const { serviceIds: _ignored, workingHours, ...rest } = v;
  void _ignored;
  const s = await prisma.$transaction(async (tx) => {
    if (serviceIds) {
      await tx.staffService.deleteMany({ where: { staffId: id } });
      if (serviceIds.length) {
        await tx.staffService.createMany({ data: serviceIds.map((serviceId) => ({ staffId: id, serviceId })) });
      }
    }
    return tx.staff.update({
      where: { id, tenantId },
      data: {
        ...rest,
        ...(workingHours ? { workingHours: workingHours as Prisma.InputJsonValue } : {}),
      },
      select: staffSelect,
    });
  });
  return toStaffView(s);
}

export async function setStaffServices(tenantId: string, staffId: string, serviceIds: string[]) {
  return updateStaff(tenantId, staffId, { serviceIds });
}

/** يرفع الصورة بعد فحص حجمها ونوعها الحقيقي. null يمحوها. */
export async function setStaffPhoto(
  tenantId: string,
  staffId: string,
  photo: { bytes: Uint8Array; mime?: string | null } | null,
): Promise<StaffView> {
  await getStaff(tenantId, staffId);
  if (!photo) {
    const s = await prisma.staff.update({
      where: { id: staffId, tenantId },
      data: { photo: null, photoMime: null, photoEtag: null },
      select: staffSelect,
    });
    return toStaffView(s);
  }
  const c = checkPhoto(photo.bytes, photo.mime);
  if (!c.ok) throw invalid(c.error);
  const s = await prisma.staff.update({
    where: { id: staffId, tenantId },
    data: { photo: Buffer.from(photo.bytes), photoMime: c.mime, photoEtag: c.etag },
    select: staffSelect,
  });
  return toStaffView(s);
}

export async function getStaffPhoto(
  tenantId: string,
  staffId: string,
): Promise<{ bytes: Uint8Array; mime: string; etag: string } | null> {
  const s = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { photo: true, photoMime: true, photoEtag: true },
  });
  if (!s) throw notFound("مقدّم الخدمة");
  if (!s.photo || !s.photoMime || !s.photoEtag) return null;
  return { bytes: new Uint8Array(s.photo), mime: s.photoMime, etag: s.photoEtag };
}
