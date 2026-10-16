"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  createSession,
  hashPassword,
  isValidEmail,
  verifyPassword,
} from "@/lib/auth";
import { DUMMY_HASH, LoginRateLimited, beginLogin, loginSucceeded } from "@/lib/login-guard";
import { clientIpKey } from "@/lib/ip";

const str = (v: FormDataEntryValue | null) => v?.toString().trim() ?? "";

async function setSessionCookie(userId: string, role: "PLATFORM_ADMIN" | "TENANT_OWNER", tenantId: string | null) {
  const s = await createSession({ userId, role, tenantId });
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: s.maxAge,
  });
}

/** مسار داخلي فقط — يمنع الاستغلال عبر open redirect. */
const safeNext = (n: string, fallback: string) =>
  n.startsWith("/") && !n.startsWith("//") ? n : fallback;

// ═══════════════════════════════════════════════════════════
//  تسجيل الدخول
// ═══════════════════════════════════════════════════════════

export async function login(formData: FormData) {
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  const next = str(formData.get("next"));

  const keep = next ? `&next=${encodeURIComponent(next)}` : "";
  const fail = () => redirect(`/login?error=1${keep}`);

  if (!email || !password) fail();

  /**
   * نفس الحارس ونفس العدّاد الذي يستعمله الجوال (lib/login-guard.ts).
   *
   * كانت صفحة الدخول بلا حدّ إطلاقاً: خمس محاولات على الجوال ثم ما لا
   * نهاية له هنا، فحماية الجوال كانت شكلية.
   */
  let ticket;
  try {
    ticket = await beginLogin(email, clientIpKey(await headers()));
  } catch (err) {
    if (err instanceof LoginRateLimited) {
      const wait = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
      redirect(`/login?error=rate&wait=${wait}${keep}`);
    }
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // رسالة واحدة للحالتين: لا نكشف أي بريد مسجَّل وأيها لا. وبريد غير
  // موجود يمر بـ PBKDF2 كاملاً على هاش وهمي — كان يرجع فوراً، فيكشف زمنُ
  // الرد وحده أيّ البُرُد مسجَّلة.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) fail();

  await loginSucceeded(ticket);

  await prisma.user.update({
    where: { id: user!.id },
    data: { lastLoginAt: new Date() },
  });

  await setSessionCookie(user!.id, user!.role, user!.tenantId);
  redirect(safeNext(next, user!.role === "PLATFORM_ADMIN" ? "/admin" : "/app"));
}

// ═══════════════════════════════════════════════════════════
//  التسجيل الذاتي
// ═══════════════════════════════════════════════════════════

export async function signup(formData: FormData) {
  const name = str(formData.get("name"));
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  const businessName = str(formData.get("businessName"));
  const businessType = str(formData.get("businessType")) || "other";
  const phone = str(formData.get("phone"));

  const fail = (code: string) => redirect(`/signup?error=${code}`);

  if (!name || !email || !password || !businessName) fail("missing");
  if (!isValidEmail(email)) fail("email");
  if (password.length < 8) fail("weak");

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    fail("exists");
  }

  // معرّف فريد من اسم البزنس؛ يستخدم في الروابط وفي عنوان الويبهوك
  const base =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/[؀-ۿ]/g, "")
      .slice(0, 30) || "store";

  let slug = base;
  for (let i = 2; await prisma.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }

  // المتجر يُنشأ متوقفاً: لا يرد الوكيل على أحد حتى يفعّله مالك المنصة
  // بعد الاتفاق على الاشتراك. التسجيل الذاتي لا يعني تشغيلاً ذاتياً.
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: businessName,
      businessType,
      status: "PAUSED",
      agentName: "المساعد",
      profile: { create: { phone: phone || null } },
    },
  });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "TENANT_OWNER",
      tenantId: tenant.id,
    },
  });

  await setSessionCookie(user.id, "TENANT_OWNER", tenant.id);
  redirect("/app?welcome=1");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
