import crypto from "node:crypto";

/**
 * رموز جلسات الجوال والحدود الزمنية — منطق صافٍ بلا قاعدة ليُختبر وحده.
 */

const DAY = 86400_000;
export const SLIDING_MS = 30 * DAY;
export const ABSOLUTE_MS = 90 * DAY;

// الكتابة مع كل طلب تعني كتابة كل ٨ ثوانٍ لكل جهاز (استطلاع الصندوق) —
// ضغط على القاعدة لا يضيف شيئاً، فدقّة خمس دقائق تكفي لـ «آخر ظهور».
export const TOUCH_EVERY_MS = 5 * 60_000;

/** ٣٢ بايت عشوائية — ٢٥٦ بت لا تُخمَّن، بصيغة آمنة في رأس HTTP. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * هاش الرمز كما يُخزَّن. SHA-256 بلا ملح ولا تكرار كافٍ هنا — خلافاً
 * لكلمات السر: الرمز عشوائي بالكامل فلا قاموس يُجرَّب عليه، والهاش الثابت
 * هو ما يسمح بالبحث عنه بفهرس فريد.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** طول رمز ٣٢ بايت بـ base64url بلا حشو. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** يستخرج الرمز من `Authorization: Bearer …`. أي شكل آخر ⇒ null. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  // رمز بشكل مستحيل لا يستحق استعلاماً
  return TOKEN_RE.test(m[1]) ? m[1] : null;
}

/** الصلاحية المنزلقة الجديدة — لا تتجاوز السقف المطلق أبداً. */
export function slidingExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + SLIDING_MS, absoluteExpiresAt.getTime()));
}

export function isSessionLive(
  s: { revokedAt: Date | null; expiresAt: Date; absoluteExpiresAt: Date },
  now: Date,
): boolean {
  return !s.revokedAt && s.expiresAt > now && s.absoluteExpiresAt > now;
}

export function shouldTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_EVERY_MS;
}

// ═══════════════════════════════════════════════════════════
//  تحديد معدّل الدخول
// ═══════════════════════════════════════════════════════════

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 5;

/**
 * سقف ثانٍ للعنوان، أوسع من سقف البريد.
 *
 * سقف البريد وحده يحمي حساباً واحداً من التخمين، ولا يحمي المنصة: من يجرّب
 * «12345678» على ألف بريد مختلف لا يتجاوز محاولة واحدة لكل بريد، فلا يوقفه
 * شيء. وأوسع من سقف البريد لأن موظفي متجر واحد يخرجون غالباً من شبكة واحدة.
 */
export const LOGIN_MAX_FAILURES_PER_IP = 20;

/**
 * هل هذا البريد محجوب الآن، وإلى متى؟
 *
 * نعدّ الفشل بعد آخر نجاح فقط: صاحب المتجر الذي أخطأ مرتين ثم دخل لا يجب
 * أن يبدأ يومه التالي بثلاث محاولات متبقية.
 *
 * `Retry-After` = حتى تخرج من النافذة أقدمُ محاولة تُبقي العدد عند السقف —
 * لا ربع ساعة كاملة ثابتة، وإلا انتظر المستخدم أكثر مما يلزم.
 */
export function loginLimit(
  attempts: { createdAt: Date; success: boolean }[],
  now: Date,
  /**
   * `resetOnSuccess` للبريد لا للعنوان: النجاح يثبت أن صاحب الحساب هو من
   * يحاول. أما على العنوان فالنجاح لا يثبت شيئاً — مهاجم يملك حساباً واحداً
   * صالحاً كان سيدخل به كل أربع محاولات فيصفّر عدّاده، ويخمّن بلا سقف.
   */
  opts: {
    max?: number;
    resetOnSuccess?: boolean;
    /**
     * المحاولات تشمل صفّ الطلب الحالي نفسه (يُسجَّل قبل العدّ — انظر
     * lib/login-guard.ts). عندها السقف `max` محاولة تمر، والحجب من التي
     * بعدها. و`Retry-After` لا يتغيّر: صفّ الطلب المحجوب يبقى في النافذة
     * ويُحسب، فالموعد هو حين تنزل المحاولات إلى ما يسمح بواحدة جديدة.
     */
    inclusive?: boolean;
  } = {},
): { limited: false } | { limited: true; retryAfterSeconds: number } {
  const max = opts.max ?? LOGIN_MAX_FAILURES;
  const since = now.getTime() - LOGIN_WINDOW_MS;
  const inWindow = attempts
    .filter((a) => a.createdAt.getTime() > since)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const from = opts.resetOnSuccess === false ? 0 : inWindow.findLastIndex((a) => a.success) + 1;
  const failures = inWindow.slice(from).filter((a) => !a.success);
  if (opts.inclusive ? failures.length <= max : failures.length < max) return { limited: false };

  const pivot = failures[failures.length - max];
  const ms = pivot.createdAt.getTime() + LOGIN_WINDOW_MS - now.getTime();
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) };
}

/** مفتاح العدّاد: البريد موحّداً — «A@x.com » و«a@x.com» حساب واحد. */
export const loginKey = (email: string) => email.trim().toLowerCase();

/** مفتاح عدّاد العنوان — مسبوق ليستحيل تصادمه مع بريد. */
export const ipKey = (ip: string) => `ip:${ip}`;
