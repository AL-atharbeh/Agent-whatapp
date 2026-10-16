import { prisma } from "../db";
import { verifyPassword } from "../auth";
import { ApiError } from "./http";
import { DUMMY_HASH, LoginRateLimited, beginLogin, loginSucceeded } from "../login-guard";
import {
  ABSOLUTE_MS,
  SLIDING_MS,
  generateToken,
  hashToken,
  isSessionLive,
  loginKey,
  parseBearer,
  shouldTouch,
  slidingExpiry,
} from "./token";

/**
 * مصادقة الجوال — جلسة جهاز في القاعدة، منفصلة تماماً عن كوكي الويب.
 *
 * القاعدة نفسها كما في lib/session.ts: الـ tenantId يأتي من الجلسة لا من
 * الطلب. لا يوجد في أي مسار جوال حقل أو معامل يحدد المتجر — فلا يوجد ما
 * يُزوَّر.
 */

export type Device = {
  deviceId: string;
  userId: string;
  tenantId: string;
  notify: string;
  /** ما قبله يُعدّ مقروءاً — انظر User.inboxBaselineAt */
  inboxBaselineAt: Date;
};

/** الجهاز صاحب الطلب، أو 401. كل مسار جوال — عدا الدخول — يبدأ من هنا. */
export async function requireDevice(req: Request): Promise<Device> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) throw new ApiError("UNAUTHENTICATED");

  const s = await prisma.deviceSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      tenantId: true,
      notify: true,
      revokedAt: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      lastSeenAt: true,
      createdAt: true,
      user: { select: { role: true, tenantId: true, inboxBaselineAt: true } },
    },
  });

  const now = new Date();
  if (!s || !isSessionLive(s, now)) throw new ApiError("UNAUTHENTICATED");

  // المستخدم نُقل لمتجر آخر أو صار بلا متجر أو رُقّي لمالك منصة ⇒ الجلسة
  // التي صدرت لمتجره القديم لا تفتح شيئاً، لا القديم ولا الجديد.
  if (
    s.user.role !== "TENANT_OWNER" ||
    !s.user.tenantId ||
    s.user.tenantId !== s.tenantId
  ) {
    throw new ApiError("UNAUTHENTICATED");
  }

  if (shouldTouch(s.lastSeenAt, now)) {
    // updateMany بشرط revokedAt: سحبٌ حدث بين القراءة والكتابة لا يُلغى هنا.
    // وفشل التحديث لا يُسقط الطلب — «آخر ظهور» معلومة، لا شرط.
    await prisma.deviceSession
      .updateMany({
        where: { id: s.id, revokedAt: null },
        data: { lastSeenAt: now, expiresAt: slidingExpiry(now, s.absoluteExpiresAt) },
      })
      .catch((err) => console.error("[mobile] فشل تحديث آخر ظهور:", err));
  }

  return {
    deviceId: s.id,
    userId: s.userId,
    tenantId: s.tenantId,
    notify: s.notify,
    // الدخول يضبطها دائماً؛ الاحتياط لصفّ أقدم من الحقل
    inboxBaselineAt: s.user.inboxBaselineAt ?? s.createdAt,
  };
}

/**
 * الدخول من الجوال. يرجّع الرمز مرة واحدة — لا يُخزَّن إلا هاشه.
 *
 * الترتيب مقصود: فحص المعدّل قبل كلمة السر (وإلا صار الحدّ بلا معنى)، ثم
 * التحقق بزمن متساوٍ للحالتين، ثم الدور — فلا يُكشف أن البريد لمالك المنصة
 * إلا لمن يعرف كلمة سره. والحارس نفسه (lib/login-guard.ts) هو ما يستعمله
 * دخول الويب، فالعدّاد واحد للطرفين.
 */
export async function loginDevice(
  input: {
    email: string;
    password: string;
    device: { name: string; platform: "ios" | "android" };
  },
  /** مفتاح العنوان من lib/ip.ts (عنوان IPv4 أو /64) — null بلا x-real-ip */
  ipKeyValue: string | null,
) {
  const key = loginKey(input.email);
  const now = new Date();

  let ticket;
  try {
    ticket = await beginLogin(key, ipKeyValue);
  } catch (err) {
    if (err instanceof LoginRateLimited) {
      throw new ApiError("RATE_LIMITED", undefined, {
        "Retry-After": String(err.retryAfterSeconds),
      });
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { email: key },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      tenant: { select: { id: true, slug: true, name: true, agentName: true } },
    },
  });

  // صفّ المحاولة مسجَّل فاشلاً من الحارس — الفشل لا يحتاج كتابة هنا
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new ApiError("INVALID_CREDENTIALS");

  await loginSucceeded(ticket);

  if (user.role === "PLATFORM_ADMIN") throw new ApiError("ADMIN_NOT_SUPPORTED");
  if (!user.tenant) {
    // صاحب متجر بلا متجر: العزل كله يعتمد على tenantId، فلا جلسة بدونه
    console.warn(`[mobile] دخول مرفوض لحساب بلا متجر: ${user.id}`);
    throw new ApiError("UNAUTHENTICATED", "هذا الحساب غير مرتبط بمتجر");
  }

  const token = generateToken();
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_MS);
  const expiresAt = new Date(now.getTime() + SLIDING_MS);

  await prisma.$transaction([
    // أول دخول من الجوال يحدّد أين يبدأ «غير المقروء». updateMany بشرط null
    // لا يحرّكه في الدخول الثاني ولا من جهاز ثانٍ.
    prisma.user.updateMany({
      where: { id: user.id, inboxBaselineAt: null },
      data: { inboxBaselineAt: now },
    }),
    prisma.deviceSession.create({
      data: {
        userId: user.id,
        tenantId: user.tenant.id,
        tokenHash: hashToken(token),
        name: input.device.name,
        platform: input.device.platform,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        absoluteExpiresAt,
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
  ]);

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, email: user.email, name: user.name },
    tenant: user.tenant,
  };
}
