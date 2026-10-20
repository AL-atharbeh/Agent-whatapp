import { prisma } from "../db";
import {
  suggestedPrice,
  type AppointmentView,
  type StaffView,
} from "../appointments";
import { requireDevice, type Device } from "./auth";
import { ApiError } from "./http";

/**
 * مشترك بين مسارات المواعيد في الجوال.
 *
 * `404` لمتجر لم يفعّل الوحدة — لا 403: التطبيق يخفي التبويب أصلاً، ومتجر
 * لا يعمل بالمواعيد لا يحتاج أن يعرف أن مسارات كهذه موجودة.
 */
export async function requireAppointments(req: Request): Promise<Device> {
  const d = await requireDevice(req);
  const t = await prisma.tenant.findUnique({
    where: { id: d.tenantId },
    select: { appointmentsEnabled: true },
  });
  if (!t?.appointmentsEnabled) throw new ApiError("NOT_FOUND");
  return d;
}

/**
 * مقدّم الخدمة كما يراه الجوال: رابط الصورة بنسختها، فيُخبّئها التطبيق بلا
 * حدّ ويعيد طلبها فقط حين تتغيّر بصمتها.
 */
export function staffJson(s: StaffView) {
  return {
    ...s,
    hasPhoto: !!s.photoVersion,
    photoUrl: s.photoVersion ? `/api/mobile/v1/staff/${s.id}/photo?v=${s.photoVersion}` : null,
  };
}

/**
 * الموعد كما يراه الجوال، ومعه السعر المقترح للجاري منه — هو ما تعرضه
 * شاشة «خلصت» مسبقاً. يُحسب للجاري وحده: لا معنى له لموعد لم يبدأ أو انتهى.
 */
export async function appointmentJson(tenantId: string, a: AppointmentView) {
  const suggested =
    a.status === "IN_PROGRESS"
      ? await suggestedPrice(tenantId, { customerId: a.customerId, serviceId: a.serviceId })
      : null;
  return { ...a, suggestedPrice: suggested };
}
