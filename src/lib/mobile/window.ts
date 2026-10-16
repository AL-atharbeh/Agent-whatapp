/**
 * نافذة الرد الحرّ — تُحسب على الخادم من آخر رسالة للعميل.
 *
 * على الخادم لا الجهاز: ساعة الجوال قد تكون متأخرة ساعات، فيعرض «النافذة
 * مفتوحة» والموظف يكتب رداً ترفضه Meta بعد ذلك. وملف بلا اعتماديات ليُختبر.
 *
 * ٢٤ ساعة للقنوات الثلاث. ماسنجر وانستقرام يسمحان بسبعة أيام عبر وسم
 * HUMAN_AGENT، لكنه صلاحية تمنحها Meta بمراجعة لم نجتزها — فلا نَعِد بها.
 */

export const REPLY_WINDOW_MS = 24 * 3600_000;

export type ReplyWindow = { open: boolean; closesAt: string | null };

export function replyWindow(lastInboundAt: Date | null, now: Date = new Date()): ReplyWindow {
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closes = lastInboundAt.getTime() + REPLY_WINDOW_MS;
  // closesAt يُعطى فقط والنافذة مفتوحة — وقت إغلاق في الماضي لا يفيد
  // التطبيق بشيء، ويغريه بحساب العدّاد التنازلي من ساعته هو.
  return now.getTime() < closes
    ? { open: true, closesAt: new Date(closes).toISOString() }
    : { open: false, closesAt: null };
}
