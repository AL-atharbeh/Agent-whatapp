/**
 * المصادقة — حسابان بدورين.
 *
 * PLATFORM_ADMIN : مالك المنصة — يرى كل العملاء، ويدير القنوات ومفاتيح Meta.
 * TENANT_OWNER   : صاحب المتجر — يرى متجره وحده، بلا وصول لأي مفاتيح.
 *
 * الجلسة تحمل الدور و tenantId موقّعَين بـ HMAC داخل الكوكي نفسه، فلا يمكن
 * لصاحب متجر أن يزوّر جلسة متجر آخر: أي تعديل يكسر التوقيع.
 *
 * مكتوب بـ Web Crypto (لا node:crypto) لأن middleware يعمل على Edge runtime.
 */

export const SESSION_COOKIE = "wakeel_session";
const SESSION_DAYS = 30;

export type SessionRole = "PLATFORM_ADMIN" | "TENANT_OWNER";
export type Session = { userId: string; role: SessionRole; tenantId: string | null };

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

// ═══════════════════════════════════════════════════════════
//  كلمات السر — scrypt عبر Web Crypto (PBKDF2)
// ═══════════════════════════════════════════════════════════

const PBKDF2_ITERATIONS = 210_000; // توصية OWASP 2024 لـ SHA-256

async function derive(password: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return b64url(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = b64url(salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${await derive(password, saltB64)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , saltB64, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !saltB64 || !expected) return false;
  return timingSafeEqual(await derive(password, saltB64), expected);
}

// ═══════════════════════════════════════════════════════════
//  الجلسات
// ═══════════════════════════════════════════════════════════

export async function createSession(
  s: Session,
): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `v2.${exp}.${s.userId}.${s.role}.${s.tenantId ?? "-"}`;
  return {
    value: `${payload}.${await hmac(payload)}`,
    maxAge: SESSION_DAYS * 86400,
  };
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;

  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;

  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!timingSafeEqual(sig, await hmac(payload))) return null;

  const [v, expRaw, userId, role, tenantId] = payload.split(".");
  if (v !== "v2" || !userId) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() >= exp) return null;
  if (role !== "PLATFORM_ADMIN" && role !== "TENANT_OWNER") return null;

  return { userId, role, tenantId: tenantId === "-" ? null : tenantId };
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
