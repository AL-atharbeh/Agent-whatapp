import { z } from "zod";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { OutboundError } from "../outbound";
import { readCappedText } from "./body";

/**
 * شكل الرد والخطأ الموحّد لـ API الجوال — انظر docs/mobile-api.md.
 *
 * موضع واحد يحوّل كل خطأ إلى `{ error: { code, message } }`. البديل أن
 * يكتب كل مسار try/catch خاصاً به، ومسار واحد ينساه يُرجع صفحة HTML أو
 * رسالة Prisma خام فيها أسماء جداول — والتطبيق لا يعرف كيف يقرأ أياً منهما.
 */

export type ApiCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "ADMIN_NOT_SUPPORTED"
  | "TENANT_INACTIVE"
  | "NOT_FOUND"
  | "WINDOW_CLOSED"
  | "IN_PROGRESS"
  | "DELIVERY_UNKNOWN"
  | "CHANNEL_NOT_CONNECTED"
  | "TEMPLATE_INVALID"
  | "RATE_LIMITED"
  | "SEND_FAILED"
  | "INTERNAL";

const STATUS: Record<ApiCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ADMIN_NOT_SUPPORTED: 403,
  TENANT_INACTIVE: 403,
  NOT_FOUND: 404,
  WINDOW_CLOSED: 409,
  IN_PROGRESS: 409,
  DELIVERY_UNKNOWN: 409,
  CHANNEL_NOT_CONNECTED: 409,
  TEMPLATE_INVALID: 422,
  RATE_LIMITED: 429,
  SEND_FAILED: 502,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<ApiCode, string> = {
  INVALID_INPUT: "البيانات المرسلة غير صالحة",
  UNAUTHENTICATED: "انتهت الجلسة — سجّل الدخول من جديد",
  INVALID_CREDENTIALS: "البريد أو كلمة السر غير صحيحة",
  ADMIN_NOT_SUPPORTED: "حساب مالك المنصة لا يعمل في التطبيق — التطبيق لأصحاب المتاجر",
  TENANT_INACTIVE: "المتجر موقوف أو اشتراكه منتهٍ — الإرسال معطّل حتى يُفعَّل، والقراءة تعمل",
  NOT_FOUND: "غير موجود",
  IN_PROGRESS: "الإرسال ما زال جارياً — انتظر ولا تُعِد",
  DELIVERY_UNKNOWN: "لم تؤكّد Meta الإرسال — ربما وصلت العميل، تحقّق قبل الإعادة",
  WINDOW_CLOSED: "انتهت نافذة الرد الحرّ (٢٤ ساعة من آخر رسالة للعميل) — أرسل قالباً معتمداً",
  CHANNEL_NOT_CONNECTED: "القناة غير مربوطة لهذا المتجر",
  TEMPLATE_INVALID: "القالب غير معتمد أو متغيّراته ناقصة",
  RATE_LIMITED: "محاولات كثيرة — انتظر قليلاً ثم جرّب",
  SEND_FAILED: "رفضت Meta الإرسال — لم تصل العميل، ويمكن إعادتها",
  INTERNAL: "صار خطأ غير متوقّع — جرّب بعد قليل",
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiCode,
    message?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "ApiError";
  }
}

// no-store على كل رد: البيانات لكل مستخدم، ووسيط يخزّن رداً واحداً قد
// يعطيه لجهاز آخر — أو يعرض للموظف صندوقاً قديماً كأنه الآن.
const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

function errorResponse(code: ApiCode, message?: string, headers?: Record<string, string>) {
  return json(
    { error: { code, message: message ?? DEFAULT_MESSAGE[code] } },
    STATUS[code],
    headers,
  );
}

/**
 * يحوّل أي استثناء إلى رد العقد.
 *
 * المعروف (ApiError، OutboundError، zod) يمر برسالته العربية. ما عداه يُسجَّل
 * كاملاً هنا ويخرج كـ INTERNAL بلا تفاصيل: نص خطأ Prisma أو Meta قد يحمل
 * أسماء جداول أو معرّفات حساب أو جزءاً من رمز وصول.
 */
export function toErrorResponse(err: unknown) {
  if (err instanceof ApiError) return errorResponse(err.code, err.message, err.headers);

  if (err instanceof OutboundError) {
    // تفصيل Meta للسجل فقط — رسالة الجهاز هي العربية الثابتة
    if (err.detail) console.error(`[mobile] ${err.code}:`, err.detail);
    // «فشل الإرسال» وحدها مكتوبة للّوحة التي تُلحق بها نص Meta؛ الجهاز لا
    // يرى ذلك النص، فيحتاج الجملة الكاملة التي تقول إن شيئاً لم يُحفظ.
    const message =
      err.code === "SEND_FAILED" && err.message === "فشل الإرسال"
        ? DEFAULT_MESSAGE.SEND_FAILED
        : err.message;
    return errorResponse(err.code, message);
  }

  if (err instanceof z.ZodError) return errorResponse("INVALID_INPUT");

  // سجل غير موجود في تحديث مقيّد بـ tenantId — من متجر آخر أو حُذف للتو.
  // نفس رد «غير موجود» حتى لا يُستنتج الفرق.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return errorResponse("NOT_FOUND");
  }

  console.error("[mobile] خطأ غير متوقّع:", err);
  return errorResponse("INTERNAL");
}

type Ctx<P> = { params: Promise<P> };

/**
 * غلاف كل مسار: يلتقط كل خطأ ويحوّله لشكل العقد.
 * بدونه يكفي `throw` واحد منسيّ ليرى الجهاز صفحة خطأ Next بالـ HTML.
 */
export function route<P extends Record<string, string> = Record<string, never>>(
  fn: (req: Request, ctx: Ctx<P>) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/**
 * يقرأ الجسم (بسقف ٦٤ كيلوبايت) ويطابقه بالمخطط.
 * الحقول الزائدة تُهمَل (سلوك zod الافتراضي).
 */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await readCappedText(req);
  if (text === null) throw new ApiError("INVALID_INPUT", "حجم الطلب أكبر من المسموح");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_INPUT", "الجسم ليس JSON صالحاً");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

/** يطابق معاملات الرابط بالمخطط — نفس رد INVALID_INPUT عند الفشل. */
export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ApiError("INVALID_INPUT");
  return parsed.data;
}

/** معرّف في الرابط — cuid أو ما يشبهه. غيره لا يستحق استعلاماً. */
export const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export function parseId(raw: string): string {
  const parsed = idParam.safeParse(raw);
  // معرّف بصيغة مستحيلة لا يوجد — فـ 404 لا 400، كأي معرّف غير موجود
  if (!parsed.success) throw new ApiError("NOT_FOUND");
  return parsed.data;
}

/** clientId يولّده الجهاز — uuid عادةً، ونقبل أي معرّف معقول الطول. */
export const clientIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/);

/**
 * قنوات الجوال: WEB ساحة تجربة، و VOICE مكالمات بلا رد نصّي.
 * بترتيب أشرطة التطبيق — الملخّص يُرجعها بهذا الترتيب دائماً.
 */
export const MOBILE_CHANNELS = ["WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;
export type MobileChannel = (typeof MOBILE_CHANNELS)[number];
