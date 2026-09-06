/**
 * مصادقة اللوحة — بسيطة ومناسبة لمالك منصة واحد.
 *
 * كلمة سر واحدة في ADMIN_PASSWORD، وجلسة موقّعة بـ HMAC داخل كوكي httpOnly.
 * لا حاجة لجدول مستخدمين ولا مزوّد خارجي في هذه المرحلة.
 *
 * مكتوب بـ Web Crypto (وليس node:crypto) لأن middleware يعمل على Edge runtime.
 * عند إضافة فريق أو حسابات لكل عميل، استبدل هذا الملف بمزوّد كامل.
 */

export const SESSION_COOKIE = "wakeel_session";
const SESSION_DAYS = 7;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** سر التوقيع مشتق من ENCRYPTION_KEY الموجود — لا متغيّر بيئة إضافي. */
function secret(): string {
  const s = process.env.ENCRYPTION_KEY;
  if (!s) throw new Error("ENCRYPTION_KEY مفقود — لا يمكن توقيع الجلسات");
  return s;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** مقارنة ثابتة الزمن — تمنع استنتاج القيمة من فروق التوقيت. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD?.trim();
}

/** يتحقق من كلمة السر بمقارنة بصمتيهما، لا نصّيهما. */
export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return false;
  const [a, b] = await Promise.all([hmac(input), hmac(expected)]);
  return timingSafeEqual(a, b);
}

export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `v1.${exp}`;
  return {
    value: `${payload}.${await hmac(payload)}`,
    maxAge: SESSION_DAYS * 86400,
  };
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;

  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  if (!timingSafeEqual(sig, await hmac(payload))) return false;

  const exp = Number(payload.split(".")[1]);
  return Number.isFinite(exp) && Date.now() < exp;
}
