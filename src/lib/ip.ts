/**
 * مفتاح عنوان العميل لتحديد معدّل الدخول — منطق صافٍ ليُختبر وحده.
 *
 * IPv6 بالـ /64 لا بالعنوان الكامل: مزوّد الإنترنت يعطي كل مشترك /64 كاملة
 * على الأقل، أي ١٨ مليون مليون مليون عنوان. عدّاد لكل عنوان يعني أن المهاجم
 * يبدّل عنوانه مع كل محاولة ولا يقترب من السقف أبداً.
 */

const MAX_LEN = 64;

function ipv4(s: string): string | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
  }
  // «010» و«10» نفس الخانة — بلا توحيد يصير لعنوان واحد عدّادان
  return parts.map((p) => String(Number(p))).join(".");
}

/** يوسّع IPv6 إلى ثماني خانات، أو null إن لم يكن عنواناً. */
function expand6(s: string): number[] | null {
  let text = s;

  // IPv4 مضمَّن في آخره (::ffff:1.2.3.4، 64:ff9b::1.2.3.4) ⇒ خانتان
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4(text.slice(lastColon + 1));
    if (!v4) return null;
    const o = v4.split(".").map(Number);
    tail.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
    text = text.slice(0, lastColon + 1);
    // «::1.2.3.4» يبقى منه «::» — وإلا ترك نقطتين يتيمتين
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  for (const g of [...head, ...rest]) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
  }

  const want = 8 - tail.length;
  const given = head.length + rest.length;
  if (halves.length === 2 ? given >= want : given !== want) return null;

  const zeros = halves.length === 2 ? Array(want - given).fill("0") : [];
  return [...head, ...zeros, ...rest].map((g) => parseInt(g, 16)).concat(tail);
}

/**
 * يحوّل عنوان العميل إلى مفتاح العدّاد:
 *   IPv4                → العنوان نفسه موحّداً
 *   IPv4 داخل IPv6 (::ffff:) → عنوان IPv4 نفسه — هو نفس الجهاز
 *   IPv6                → أول أربع خانات + «::/64»
 *   ما عدا ذلك          → null، أي بلا تحديد بالعنوان
 *
 * null للمشوّه لا رفض الطلب: العنوان يضعه Vercel لا العميل، وشكلٌ لم
 * نتوقّعه عطل عندنا — لا سبب لمنع صاحب المتجر من الدخول بسببه.
 */
export function ipLimitKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s.length > MAX_LEN) return null;

  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  // معرّف المنطقة (fe80::1%eth0) محلي للجهاز ولا يعني شيئاً خارجه
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  if (!s.includes(":")) return ipv4(s);

  const g = expand6(s);
  if (!g) return null;

  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");

  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/**
 * عنوان العميل من رؤوس الطلب — x-real-ip وحده.
 *
 * Vercel يضعه بنفسه ويستبدل ما يرسله العميل. أما x-forwarded-for فيبدأ بما
 * يكتبه العميل نفسه: الاعتماد عليه يعني أن المهاجم يختار عدّاده بنفسه.
 * بلا x-real-ip (خارج Vercel) ⇒ null، ويبقى سقف البريد وحده.
 */
export function clientIpKey(headers: Headers): string | null {
  return ipLimitKey(headers.get("x-real-ip"));
}
