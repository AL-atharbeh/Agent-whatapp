import crypto from "node:crypto";

/**
 * حجز الإرسال قبل Meta — منطق صافٍ بلا قاعدة ليُختبر وحده.
 *
 * فحص «هل أُرسلت هذه من قبل؟» ثم الإرسال لا يكفي: طلبان متزامنان بنفس
 * clientId يمرّان من الفحص معاً قبل أن يخزّن أيّهما، فيصل العميل ردّان. لذا
 * يُحجز المعرّف بصفّ فريد *قبل* أن نكلّم Meta، والطلب الثاني يصطدم بالقيد
 * فلا يصل Meta أبداً — ويقرّر ما يُرجعه من حالة الصفّ هنا.
 */

export type OutboundState = "PENDING" | "SENT" | "UNKNOWN" | "FAILED";

/**
 * حجز معلّق أقدم من هذا مات صاحبه (دالة انقطعت وسط الإرسال).
 *
 * لا نعرف إن وصلت Meta قبل الانقطاع، فيُعامل كـ «غير مؤكّد» لا كفاشل:
 * إعادة إرسال ما ربما وصل أسوأ من سؤال الموظف أن يتحقّق. ودقيقتان أطول
 * بكثير من مهلة Meta (١٥ ثانية) فلا نحكم على إرسال ما زال جارياً.
 */
export const STALE_PENDING_MS = 2 * 60_000;

export type SendPayload =
  | { kind: "reply"; conversationId: string; text: string }
  | {
      kind: "template";
      conversationId: string;
      template: { name: string; language: string; variables: string[] };
    }
  | {
      kind: "start";
      phone: string; // بعد التوحيد — «0770…» و«+962770…» نفس المستلم
      template: { name: string; language: string; variables: string[] };
    };

/** JSON بمفاتيح مرتّبة — ترتيب الحقول في جسم الطلب لا يغيّر البصمة. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * بصمة العملية: نفس clientId لعملية مختلفة (نص آخر، مستلم آخر) خطأ في
 * الجهاز، ولو أعدنا له الرسالة الأولى لظن أن الثانية أُرسلت وهي لم تُرسل.
 */
export function fingerprint(p: SendPayload): string {
  return crypto.createHash("sha256").update(canonicalJson(p), "utf8").digest("hex");
}

export type ReservationRow = {
  state: OutboundState;
  fingerprint: string;
  messageId: string | null;
  updatedAt: Date;
};

export type Decision =
  | { action: "mismatch" } // معرّف لعملية أخرى ⇒ INVALID_INPUT
  | { action: "replay"; messageId: string } // أُرسلت وخُزّنت ⇒ نفس الرسالة
  | { action: "in_progress" } // جارية الآن ⇒ IN_PROGRESS
  | { action: "stale" } // معلّقة ماتت ⇒ تُثبَّت UNKNOWN ثم DELIVERY_UNKNOWN
  | { action: "unknown" } // لم تؤكّد Meta ولم ترفض ⇒ DELIVERY_UNKNOWN
  | { action: "retry" }; // رفض صريح سابق ⇒ إرسال جديد مسموح

/** ماذا نفعل بطلب وجد معرّفه محجوزاً. الترتيب مهم: البصمة قبل كل شيء. */
export function decideReservation(
  row: ReservationRow,
  fp: string,
  now: Date,
): Decision {
  if (row.fingerprint !== fp) return { action: "mismatch" };
  switch (row.state) {
    case "SENT":
      // «أُرسلت» بلا رسالة لا يحدث إلا بخلل — والآمن ألا نرسل ثانيةً
      return row.messageId ? { action: "replay", messageId: row.messageId } : { action: "unknown" };
    case "PENDING":
      return now.getTime() - row.updatedAt.getTime() >= STALE_PENDING_MS
        ? { action: "stale" }
        : { action: "in_progress" };
    case "UNKNOWN":
      return { action: "unknown" };
    case "FAILED":
      return { action: "retry" };
  }
}
