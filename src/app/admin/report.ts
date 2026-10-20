import { redirect } from "next/navigation";
import { OutboundError, webErrorMessage } from "@/lib/outbound";

/**
 * ينقل سبب الفشل إلى المستخدم بدل صفحة «صار خطأ في الخادم».
 *
 * الإجراءات ترمي رسائل عربية دقيقة، وNext.js تحجب نصّها في الإنتاج وتعرض
 * صفحة عامة برقم معرّف. فيرى صاحب المتجر عطلاً حيث كان شرطاً لم يستوفِه،
 * ويعيد المحاولة بنفس المُدخَل — والرسالة المكتوبة له في سجلّ لا يقرأه.
 *
 * فنلتقطها هنا ونعيد التوجيه حاملين إياها، ويعرضها <ActionError/>.
 *
 * و`redirect` نفسه يعمل برمي استثناء يحمل digest يبدأ بـ NEXT_ — فابتلاعه
 * هنا يكسر كل تحويل مقصود، لذا نمرّره كما هو.
 *
 * ملف عادي لا "use server": ملفات الإجراءات لا تصدّر إلا دوالاً غير متزامنة،
 * وهذه تُستورد في أكثر من ملف إجراءات.
 */
export function report(err: unknown, path: string, message?: (err: unknown) => string | null): never {
  const digest = (err as { digest?: string })?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;

  const msg =
    message?.(err) ??
    (err instanceof OutboundError
      ? webErrorMessage(err)
      : err instanceof Error
        ? err.message
        : "صار خطأ غير متوقّع");
  console.error("[action]", msg);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}err=${encodeURIComponent(msg)}`);
}
