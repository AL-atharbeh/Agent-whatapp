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

export type OutboundResult = { ok: boolean; error?: string };
