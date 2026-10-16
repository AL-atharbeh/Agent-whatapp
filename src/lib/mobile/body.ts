/**
 * قراءة جسم الطلب بسقف — صافية بلا قاعدة ولا Next لتُختبر وحدها.
 *
 * `req.json()` يقرأ أي حجم يُرسَل إليه قبل أن يرى zod سطراً واحداً. جسم
 * من مئة ميغا يملأ ذاكرة الدالة ويُسقطها، وكل مسارات الجوال لا يتجاوز
 * جسمها بضعة كيلوبايت (أطول رسالة ٤٠٩٦ حرفاً).
 */

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * النص، أو null إن تجاوز السقف.
 *
 * content-length وحده لا يكفي: قد يغيب (ترميز مقطّع) أو يكذب. فنفحصه حين
 * يوجد لنرفض مبكراً بلا قراءة، ونعدّ البايتات أثناء القراءة على أي حال.
 */
export async function readCappedText(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      // نوقف القراءة فوراً بدل استهلاك بقية ما يرسله
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(buf);
}
