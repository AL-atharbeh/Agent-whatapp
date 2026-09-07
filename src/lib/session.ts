import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { SESSION_COOKIE, readSession, type Session } from "./auth";

/**
 * حراسة الخادم.
 *
 * middleware يمنع الوصول للمسارات، لكنه لا يكفي وحده: server actions تُستدعى
 * مباشرة ولا تمر بكل فحوصه. لذلك كل إجراء يعدّل بيانات متجر يمر من هنا.
 *
 * القاعدة: صاحب المتجر لا يصل إلا لمتجره. الـ tenantId يأتي من الجلسة
 * الموقّعة، لا من الطلب — فلا يمكن تزويره بتغيير الرابط أو حقل مخفي.
 */

export async function getSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "PLATFORM_ADMIN") redirect("/app");
  return s;
}

/**
 * يتحقّق أن المستخدم يملك حق تعديل هذا المتجر، ويعيد معرّفه.
 * مالك المنصة يمر دائماً؛ صاحب المتجر فقط إن كان متجره.
 */
export async function authorizeTenant(slug: string): Promise<string> {
  const s = await requireSession();

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) throw new Error("لا يوجد متجر بهذا المعرّف");

  if (s.role === "PLATFORM_ADMIN") return tenant.id;
  if (s.tenantId === tenant.id) return tenant.id;

  // محاولة وصول لمتجر آخر — تُسجَّل ولا تُنفَّذ
  console.warn(`[auth] رفض وصول: المستخدم ${s.userId} حاول تعديل ${slug}`);
  throw new Error("ليس لديك صلاحية على هذا المتجر");
}

/** متجر المستخدم الحالي — للبوابة الخاصة بالعملاء. */
export async function requireOwnTenant() {
  const s = await requireSession();

  if (s.role === "PLATFORM_ADMIN") redirect("/admin");
  if (!s.tenantId) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: s.tenantId },
    include: { profile: true },
  });
  if (!tenant) redirect("/login");

  return { session: s, tenant };
}

export async function currentUser() {
  const s = await getSession();
  if (!s) return null;
  return prisma.user.findUnique({
    where: { id: s.userId },
    select: { id: true, email: true, name: true, role: true, tenantId: true },
  });
}
