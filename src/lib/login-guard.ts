import crypto from "node:crypto";
import { prisma } from "./db";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_PER_IP,
  LOGIN_WINDOW_MS,
  ipKey,
  loginKey,
  loginLimit,
} from "./mobile/token";

/**
 * حارس الدخول — مشترك بين الويب والجوال، والعدّاد واحد للاثنين.
 *
 * عدّادان منفصلان كانا يعنيان عشر محاولات لكل بريد بدل خمس: خمس من صفحة
 * الدخول وخمس من الجوال. والويب كان بلا عدّاد أصلاً.
 *
 * **التسجيل قبل العدّ.** الطريقة البديهية — اعدّ ثم سجّل الفشل بعد فحص
 * كلمة السر — تترك نافذة: مئة طلب متزامن تعدّ كلها صفراً قبل أن يسجّل أيّها
 * شيئاً، فتمر المئة. حين يُدرج كل طلب صفّه أولاً ثم يعدّ، فالطلب الذي صار
 * صفّه السادس يرى خمسة قبله على الأقل (READ COMMITTED يُظهر ما ثُبّت قبل
 * استعلامه) — فلا يمر أكثر من السقف مهما تزامنت الطلبات.
 */

/**
 * هاش ثابت لكلمة سر عشوائية لا يعرفها أحد.
 *
 * بريد غير موجود كان يرجع فوراً، وبريد موجود بكلمة سر خاطئة يمر بـ PBKDF2
 * (٢١٠ ألف تكرار — عشرات الميلّي ثانية). الفرق يكفي لاستخراج قائمة
 * الحسابات المسجّلة من زمن الرد وحده. فنمرّر الحالتين بنفس العمل.
 */
export const DUMMY_HASH =
  "pbkdf2$210000$gQD6g9SQyj5wGPoiqQuFrw$w549I6tlD9CTYqdGxxQYcOWauiKMzeEPlH-soSmKPzU";

export class LoginRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("محاولات دخول كثيرة");
    this.name = "LoginRateLimited";
  }
}

export type LoginTicket = { rowIds: string[] };

// كنس عام عشوائي بدل مهمة مجدولة: صفوف المهاجمين لبريد غير موجود لا
// يكنسها نجاحٌ أبداً، فينمو الجدول بلا حد. مرة كل خمسين محاولة تكفي
// لإبقائه بحجم ربع ساعة من المحاولات، بلا cron يُنسى إعداده.
const SWEEP_ONE_IN = 50;

async function maybeSweep(now: Date) {
  if (crypto.randomInt(SWEEP_ONE_IN) !== 0) return;
  await prisma.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOGIN_WINDOW_MS) } } })
    .catch((err) => console.error("[login] فشل كنس المحاولات القديمة:", err));
}

/**
 * يسجّل المحاولة ثم يقرر إن كانت تمر. يرمي LoginRateLimited، والصفّ يبقى:
 * المحاولة المحجوبة محاولة، وإلا صار تكرار الطلب بلا كلفة على المهاجم.
 *
 * `ipKeyValue` من lib/ip.ts (العنوان أو الـ /64)، و null ⇒ البريد وحده.
 */
export async function beginLogin(email: string, ipKeyValue: string | null): Promise<LoginTicket> {
  const now = new Date();
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const key = loginKey(email);
  const ipk = ipKeyValue ? ipKey(ipKeyValue) : null;

  // createMany لا يرجّع المعرّفات، ونحتاجها لتعليم النجاح لاحقاً
  const rows = await prisma.$transaction([
    prisma.loginAttempt.create({ data: { key, success: false }, select: { id: true } }),
    ...(ipk
      ? [prisma.loginAttempt.create({ data: { key: ipk, success: false }, select: { id: true } })]
      : []),
  ]);

  const recentOf = (k: string, take: number) =>
    prisma.loginAttempt.findMany({
      where: { key: k, createdAt: { gt: since } },
      select: { createdAt: true, success: true },
      orderBy: { createdAt: "desc" },
      take,
    });

  const [byEmail, byIp] = await Promise.all([
    recentOf(key, LOGIN_MAX_FAILURES * 4),
    ipk ? recentOf(ipk, LOGIN_MAX_FAILURES_PER_IP * 4) : Promise.resolve([]),
  ]);

  await maybeSweep(now);

  const limit = [
    loginLimit(byEmail, now, { inclusive: true }),
    ...(ipk
      ? [
          loginLimit(byIp, now, {
            max: LOGIN_MAX_FAILURES_PER_IP,
            resetOnSuccess: false,
            inclusive: true,
          }),
        ]
      : []),
  ].find((l) => l.limited);
  if (limit?.limited) throw new LoginRateLimited(limit.retryAfterSeconds);

  return { rowIds: rows.map((r) => r.id) };
}

/**
 * كلمة السر صحيحة ⇒ صفّا هذه المحاولة نجاح.
 *
 * على البريد يصفّر النجاحُ العدّاد (resetOnSuccess). على العنوان لا يصفّر
 * شيئاً، لكن تعليمه نجاحاً يُخرجه من عدّ الإخفاقات — وإلا حُجب مكتب فيه
 * عشرون موظفاً يدخلون صباحاً من نفس الشبكة بلا خطأ واحد.
 */
export async function loginSucceeded(ticket: LoginTicket): Promise<void> {
  await prisma.loginAttempt.updateMany({
    where: { id: { in: ticket.rowIds } },
    data: { success: true },
  });
}
