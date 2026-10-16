/**
 * مؤشّر ترقيم مبهم: (وقت، معرّف) بـ base64url.
 *
 * الوقت وحده لا يكفي: محادثتان بنفس الميلّي ثانية تتبادلان المكان بين
 * صفحتين فتظهر واحدة مرتين وتختفي الأخرى. والمعرّف يكسر التعادل.
 * ومبهم لأن التطبيق لا يجب أن يبني عليه — شكله قابل للتغيير.
 */

export type Cursor = { at: Date; id: string };

const MIN_AT = Date.UTC(2020, 0, 1);
const MAX_AT = Date.UTC(2100, 0, 1);

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at.getTime()}.${c.id}`, "utf8").toString("base64url");
}

/** null لأي مؤشّر لا نفهمه — والمنادي يقرر أنه INVALID_INPUT. */
export function decodeCursor(raw: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(raw)) return null;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/.exec(text);
  if (!m) return null;
  const at = new Date(Number(m[1]));
  // وقت خارج عمر المنصة ليس مؤشّراً أصدرناه — مؤشّر مصنوع يدوياً لا نمرّره
  // إلى الاستعلام كأنه حقيقي
  const t = at.getTime();
  if (Number.isNaN(t) || t < MIN_AT || t >= MAX_AT) return null;
  return { at, id: m[2] };
}
