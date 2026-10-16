import type { Channel } from "@prisma/client";

/**
 * الشكل الموحّد للرسالة الواردة.
 *
 * كل قناة (واتساب/ماسنجر/انستقرام/ويب) لها صيغة payload مختلفة تماماً، لكنها
 * تُطبَّع هنا إلى بنية واحدة. نتيجة ذلك: بقية النظام — العزل، المحرك، الأدوات —
 * لا يعرف شيئاً عن Meta ولا يحتاج تعديلاً عند إضافة قناة جديدة (تليجرام مثلاً).
 */
export type InboundMessage = {
  channel: Channel;
  /** معرّف حساب القناة عند المزوّد: phone_number_id / page_id / ig_id */
  accountExternalId: string;
  /** معرّف العميل عند المزوّد: رقم واتساب أو PSID */
  externalUserId: string;
  /** معرّف الرسالة عند المزوّد — لمنع المعالجة المكرّرة */
  externalMessageId: string;
  customerName?: string;
  text: string;
  /**
   * فويس وارد. `mediaId` لواتساب (يُستبدل برابط مؤقت عبر Graph)،
   * و`url` لماسنجر وانستقرام (يصل جاهزاً في الويبهوك).
   */
  audio?: { mediaId?: string; url?: string; mimeType?: string };
  /** رسالة غير نصية ولا صوتية (صورة/ملف) — نتعامل معها برد مختلف */
  unsupportedKind?: string;
};

/**
 * نتيجة إرسال لـ Meta.
 *
 * `kind` عند الفشل يفرّق بين حالتين يجب ألا تُعاملا كواحدة:
 *   rejected — ردّت Meta برفض (4xx): الرسالة لم تصل يقيناً، والإعادة آمنة.
 *   unknown  — مهلة، انقطاع، أو 5xx: ربما وصلت. إعادتها قد تُرسل للعميل ردّين.
 *
 * اختياري ليبقى من يفحص `ok` وحده يعمل كما كان.
 */
export type OutboundResult = { ok: boolean; error?: string; kind?: "rejected" | "unknown" };

/**
 * يصنّف فشل HTTP من Meta. 4xx رفضٌ صريح لطلبنا؛ 5xx خلل عندهم قد يقع
 * بعد أن قبلوا الرسالة، فلا نعدّه رفضاً.
 */
export function failureKind(status: number): "rejected" | "unknown" {
  return status >= 400 && status < 500 ? "rejected" : "unknown";
}

/**
 * مصير الرسالة كما يجب أن يتصرّف عليه المنادي. نتيجة فاشلة بلا `kind`
 * (من مسار قديم) تُعدّ unknown: افتراض الرفض هو ما يسمح بإرسال مكرّر.
 */
export function deliveryOutcome(r: OutboundResult): "sent" | "rejected" | "unknown" {
  if (r.ok) return "sent";
  return r.kind === "rejected" ? "rejected" : "unknown";
}
