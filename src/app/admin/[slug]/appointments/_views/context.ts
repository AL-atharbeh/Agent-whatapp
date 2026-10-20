import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwnTenant } from "@/lib/session";
import type { ViewProps } from "./shared";

/**
 * سياق صفحات المواعيد في البوابتين.
 *
 * الوحدة غير مفعّلة ⇒ 404 لا صفحة فارغة ولا تحويل: متجر ذهب لا يجب أن يجد
 * أثراً لوحدة لا تخصّه، ولا رابطاً يقود إليها.
 *
 * البوابة لا تأخذ المتجر من الرابط إطلاقاً — من الجلسة الموقّعة، كما في كل
 * صفحات /app. ومالك المنصة يأخذه من الرابط وحراسة /admin في middleware.
 */

type RawSearch = Record<string, string | string[] | undefined>;

function flat(sp: RawSearch): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

export async function adminCtx(
  params: Promise<{ slug: string }>,
  searchParams?: Promise<RawSearch>,
): Promise<ViewProps> {
  const { slug } = await params;
  const t = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, appointmentsEnabled: true },
  });
  if (!t?.appointmentsEnabled) notFound();
  return { tenantId: t.id, slug, base: `/admin/${slug}/appointments`, sp: flat((await searchParams) ?? {}) };
}

export async function ownerCtx(searchParams?: Promise<RawSearch>): Promise<ViewProps> {
  const { tenant } = await requireOwnTenant();
  if (!tenant.appointmentsEnabled) notFound();
  return { tenantId: tenant.id, slug: tenant.slug, base: "/app/appointments", sp: flat((await searchParams) ?? {}) };
}
