import crypto from "node:crypto";

/**
 * فحص صورة مقدّم الخدمة — صافٍ ليُختبر وحده.
 *
 * الصورة تُخدم من مسارنا بنوع المحتوى المخزّن. لو وثقنا بالنوع الذي يعلنه
 * الرافع لأمكن رفع HTML بنوع image/png يفتحه متصفح فيُنفّذ في نطاقنا. فالنوع
 * يُستخرج من البايتات نفسها، والمعلَن يجب أن يطابقه.
 */

export const MAX_PHOTO_BYTES = 150 * 1024;

const SIGNATURES: { mime: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    test: (b) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  },
  {
    mime: "image/webp",
    test: (b) =>
      String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP",
  },
];

export type PhotoCheck = { ok: true; mime: string; etag: string } | { ok: false; error: string };

export function checkPhoto(bytes: Uint8Array, declaredMime?: string | null): PhotoCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "الصورة فارغة" };
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, error: "الصورة أكبر من ١٥٠ كيلوبايت — صغّرها قبل الرفع" };
  }
  const sig = SIGNATURES.find((s) => bytes.byteLength >= 12 && s.test(bytes));
  if (!sig) return { ok: false, error: "صيغة غير مدعومة — JPEG أو PNG أو WebP فقط" };
  if (declaredMime && declaredMime.toLowerCase() !== sig.mime) {
    return { ok: false, error: "نوع الملف لا يطابق محتواه" };
  }
  return { ok: true, mime: sig.mime, etag: photoEtag(bytes) };
}

/** بصمة المحتوى — تتغيّر مع الصورة فيسقط التخزين المؤقت القديم وحده. */
export function photoEtag(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("base64url").slice(0, 22);
}
