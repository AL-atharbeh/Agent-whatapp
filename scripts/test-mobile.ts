import { isWindowRejection } from "../src/lib/channels/types";
import assert from "node:assert/strict";
import {
  ABSOLUTE_MS,
  LOGIN_WINDOW_MS,
  SLIDING_MS,
  TOUCH_EVERY_MS,
  generateToken,
  hashToken,
  isSessionLive,
  loginKey,
  loginLimit,
  parseBearer,
  shouldTouch,
  slidingExpiry,
} from "../src/lib/mobile/token";
import { REPLY_WINDOW_MS, replyWindow } from "../src/lib/mobile/window";
import { decodeCursor, encodeCursor } from "../src/lib/mobile/cursor";
import { PUSH_BODY_MAX, clip, levelsFor, pushContent, wantsPush } from "../src/lib/mobile/notify";
import { isPlausiblePhone, normalizePhone } from "../src/lib/phone";
import { displayId, displayName } from "../src/lib/display";
import { signServiceJwt } from "../src/lib/mobile/jwt";
import crypto from "node:crypto";
import { clientIpKey, ipLimitKey } from "../src/lib/ip";
import {
  STALE_PENDING_MS,
  canonicalJson,
  decideReservation,
  fingerprint,
  type ReservationRow,
} from "../src/lib/reservation";
import { deliveryOutcome, failureKind } from "../src/lib/channels/types";
import { MAX_BODY_BYTES, readCappedText } from "../src/lib/mobile/body";

/**
 * اختبارات المنطق الصافي لـ API الجوال — بلا قاعدة ولا شبكة.
 *
 *   npx tsx scripts/test-mobile.ts
 *
 * يخرج برمز غير صفري عند أي فشل، فيصلح شرطاً في CI.
 */

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const T0 = new Date("2026-10-16T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

// ── الرموز ──
test("generateToken: ٤٣ محرفاً base64url وفريد", () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});
test("hashToken: SHA-256 hex حتمي ومختلف لكل رمز", () => {
  const t = generateToken();
  assert.equal(hashToken(t), hashToken(t));
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), hashToken(generateToken()));
  assert.equal(
    hashToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("parseBearer: يقبل الصيغة الصحيحة فقط", () => {
  const t = generateToken();
  assert.equal(parseBearer(`Bearer ${t}`), t);
  assert.equal(parseBearer(`bearer ${t}`), t);
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer(t), null);
  assert.equal(parseBearer(`Basic ${t}`), null);
  assert.equal(parseBearer("Bearer short"), null);
  assert.equal(parseBearer(`Bearer ${t}x`), null);
});

// ── الصلاحية ──
test("slidingExpiry: ٣٠ يوماً ولا يتجاوز السقف المطلق", () => {
  assert.equal(slidingExpiry(T0, at(ABSOLUTE_MS)).getTime(), at(SLIDING_MS).getTime());
  assert.equal(slidingExpiry(T0, at(1000)).getTime(), at(1000).getTime());
});
test("isSessionLive: مسحوبة/منتهية منزلقة/منتهية مطلقة ⇒ ميتة", () => {
  const live = { revokedAt: null, expiresAt: at(1), absoluteExpiresAt: at(1) };
  assert.equal(isSessionLive(live, T0), true);
  assert.equal(isSessionLive({ ...live, revokedAt: T0 }, T0), false);
  assert.equal(isSessionLive({ ...live, expiresAt: T0 }, T0), false);
  assert.equal(isSessionLive({ ...live, absoluteExpiresAt: at(-1) }, T0), false);
});
test("shouldTouch: كتابة كل ٥ دقائق على الأكثر", () => {
  assert.equal(shouldTouch(T0, at(TOUCH_EVERY_MS - 1)), false);
  assert.equal(shouldTouch(T0, at(TOUCH_EVERY_MS)), true);
});

// ── تحديد معدّل الدخول ──
const fail = (ms: number) => ({ createdAt: at(ms), success: false });
const ok = (ms: number) => ({ createdAt: at(ms), success: true });
test("loginLimit: أربع إخفاقات لا تحجب", () => {
  assert.deepEqual(loginLimit([fail(-4), fail(-3), fail(-2), fail(-1)], T0), { limited: false });
});
test("loginLimit: الخامسة تحجب، وRetry-After حتى خروج أقدمها", () => {
  const r = loginLimit([fail(-5000), fail(-4000), fail(-3000), fail(-2000), fail(-1000)], T0);
  assert.equal(r.limited, true);
  if (r.limited) assert.equal(r.retryAfterSeconds, (LOGIN_WINDOW_MS - 5000) / 1000);
});
test("loginLimit: مع ست إخفاقات، المحور هو الثانية لا الأولى", () => {
  const r = loginLimit(
    [fail(-6000), fail(-5000), fail(-4000), fail(-3000), fail(-2000), fail(-1000)],
    T0,
  );
  assert.equal(r.limited, true);
  if (r.limited) assert.equal(r.retryAfterSeconds, (LOGIN_WINDOW_MS - 5000) / 1000);
});
test("loginLimit: النجاح يصفّر العدّاد", () => {
  const r = loginLimit([fail(-9), fail(-8), fail(-7), fail(-6), ok(-5), fail(-4)], T0);
  assert.deepEqual(r, { limited: false });
});
test("loginLimit: ما خرج من نافذة ١٥ دقيقة لا يُحسب", () => {
  const old = -LOGIN_WINDOW_MS - 1;
  const r = loginLimit([fail(old), fail(-4), fail(-3), fail(-2), fail(-1)], T0);
  assert.deepEqual(r, { limited: false });
});
test("loginLimit: الترتيب الوارد لا يؤثّر", () => {
  const r = loginLimit([fail(-1000), fail(-5000), fail(-3000), fail(-2000), fail(-4000)], T0);
  assert.equal(r.limited, true);
});
test("loginKey: يوحّد البريد", () => {
  assert.equal(loginKey("  Ahmad@X.com "), "ahmad@x.com");
});

// ── نافذة الرد ──
test("replyWindow: بلا رسالة عميل ⇒ مغلقة و closesAt null", () => {
  assert.deepEqual(replyWindow(null, T0), { open: false, closesAt: null });
});
test("replyWindow: قبل ساعة ⇒ مفتوحة حتى +٢٤ ساعة من الرسالة", () => {
  const last = at(-3600_000);
  assert.deepEqual(replyWindow(last, T0), {
    open: true,
    closesAt: new Date(last.getTime() + REPLY_WINDOW_MS).toISOString(),
  });
});
test("replyWindow: عند ٢٤ ساعة بالضبط ⇒ مغلقة", () => {
  assert.deepEqual(replyWindow(at(-REPLY_WINDOW_MS), T0), { open: false, closesAt: null });
  assert.equal(replyWindow(at(-REPLY_WINDOW_MS + 1), T0).open, true);
});
test("replyWindow: قبل ٢٥ ساعة ⇒ مغلقة", () => {
  assert.equal(replyWindow(at(-25 * 3600_000), T0).open, false);
});

// ── المؤشّر ──
test("cursor: ذهاب وإياب بلا فقد", () => {
  const c = { at: new Date("2026-10-16T10:11:12.345Z"), id: "cmabc123xyz" };
  const d = decodeCursor(encodeCursor(c));
  assert.ok(d);
  assert.equal(d.at.getTime(), c.at.getTime());
  assert.equal(d.id, c.id);
  assert.match(encodeCursor(c), /^[A-Za-z0-9_-]+$/);
});
test("cursor: المشوّه ⇒ null", () => {
  assert.equal(decodeCursor("!!!"), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor(Buffer.from("abc.def").toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("123").toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("123.a b").toString("base64url")), null);
  assert.equal(decodeCursor("x".repeat(500)), null);
});

// ── الإشعارات ──
test("notify: جدول العقد", () => {
  assert.equal(wantsPush("all", "message"), true);
  assert.equal(wantsPush("all", "handoff"), true);
  assert.equal(wantsPush("handoff", "message"), false);
  assert.equal(wantsPush("handoff", "handoff"), true);
  assert.equal(wantsPush("off", "message"), false);
  assert.equal(wantsPush("off", "handoff"), false);
  assert.equal(wantsPush("garbage", "handoff"), false);
  assert.deepEqual(levelsFor("message"), ["all"]);
  assert.deepEqual(levelsFor("handoff").sort(), ["all", "handoff"]);
});
test("clip: ١٢٠ محرفاً ولا يكسر حرفاً مركّباً", () => {
  assert.equal(clip("قصير"), "قصير");
  const long = "😀".repeat(200);
  const out = clip(long);
  assert.equal(Array.from(out).length, PUSH_BODY_MAX);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("�"));
  assert.equal(clip("  a \n\n b  "), "a b");
});
test("pushContent: عنوان الرسالة والتحويل", () => {
  const base = { channel: "WHATSAPP" as const, externalUserId: "962770466649" };
  assert.deepEqual(
    pushContent({ ...base, type: "message", customerName: "أحمد العطاربة", text: "بدي أسعار المواقع" }),
    { title: "أحمد العطاربة · واتساب", body: "بدي أسعار المواقع" },
  );
  assert.equal(
    pushContent({ ...base, type: "handoff", customerName: "أحمد العطاربة", text: "سبب" }).title,
    "يحتاجك الآن · أحمد العطاربة",
  );
  // اسم «.» ليس اسماً ⇒ الرقم
  assert.equal(
    pushContent({ ...base, type: "message", customerName: ".", text: "x" }).title,
    "+962770466649 · واتساب",
  );
});

// ── العرض ──
test("displayName: بلا حرف ولا رقم ⇒ null", () => {
  assert.equal(displayName("."), null);
  assert.equal(displayName(" … "), null);
  assert.equal(displayName(null), null);
  assert.equal(displayName("  خالد "), "خالد");
  assert.equal(displayName("7"), "7");
});
test("displayId: + لواتساب فقط", () => {
  assert.equal(displayId("WHATSAPP", "962770466649"), "+962770466649");
  assert.equal(displayId("MESSENGER", "123456"), "123456");
});

// ── الهاتف ──
test("normalizePhone: كل صيغ الرقم الواحد تتوحّد", () => {
  for (const raw of [
    "+962 7 7046 6649",
    "00962770466649",
    "0770466649",
    "077-046-6649",
    "962770466649",
    "٠٧٧٠٤٦٦٦٤٩",
  ]) {
    assert.equal(normalizePhone(raw, "ar-JO"), "962770466649", raw);
  }
  assert.equal(normalizePhone("0501234567", "ar-SA"), "966501234567");
});
test("normalizePhone: رقم محلي من بلد غير معروف ⇒ رفض لا تخمين", () => {
  assert.throws(() => normalizePhone("0770466649", "ar"));
  assert.throws(() => normalizePhone("0770466649", "en-US"));
  assert.equal(normalizePhone("+12025550123", "ar"), "12025550123");
});
test("isPlausiblePhone: ٨ إلى ١٥ رقماً", () => {
  assert.equal(isPlausiblePhone("962770466649"), true);
  assert.equal(isPlausiblePhone("1234567"), false);
  assert.equal(isPlausiblePhone("1234567890123456"), false);
  assert.equal(isPlausiblePhone("96277x466649"), false);
});

// ── JWT لـ FCM ──
test("signServiceJwt: RS256 يتحقق بالمفتاح العام وبالحقول الصحيحة", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = signServiceJwt({
    clientEmail: "svc@proj.iam.gserviceaccount.com",
    privateKey: pem,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    audience: "https://oauth2.googleapis.com/token",
    nowSeconds: 1_760_000_000,
  });
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.iss, "svc@proj.iam.gserviceaccount.com");
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 3600);
  const ok = crypto
    .createVerify("RSA-SHA256")
    .update(`${h}.${p}`)
    .verify(publicKey, Buffer.from(sig, "base64url"));
  assert.equal(ok, true);
});

// ── سقف العنوان: لا يُصفّره النجاح ───────────────────────
test("loginLimit العنوان: ١٩ إخفاقاً لا تحجب، و٢٠ تحجب", () => {
  const nineteen = Array.from({ length: 19 }, (_, i) => fail(-60_000 + i * 1000));
  const opts = { max: 20, resetOnSuccess: false };
  assert.equal(loginLimit(nineteen, T0, opts).limited, false);
  assert.equal(loginLimit([...nineteen, fail(-1000)], T0, opts).limited, true);
});
test("loginLimit العنوان: مهاجم بحساب صالح لا يصفّر عدّاده بالدخول", () => {
  // أربع تخمينات ثم دخول ناجح بحسابه — يتكرر خمس مرات = ٢٠ إخفاقاً
  const seq: { createdAt: Date; success: boolean }[] = [];
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 4; i++) seq.push(fail(-600_000 + (r * 5 + i) * 1000));
    seq.push(ok(-600_000 + (r * 5 + 4) * 1000));
  }
  assert.equal(loginLimit(seq, T0).limited, false, "سقف البريد يُصفَّر — متوقّع");
  assert.equal(
    loginLimit(seq, T0, { max: 20, resetOnSuccess: false }).limited,
    true,
    "سقف العنوان يجب أن يحجبه",
  );
});

// ── الحدّ الشامل لصفّ الطلب الحالي (التسجيل قبل العدّ) ──
test("loginLimit inclusive: الخامسة تمر والسادسة تُحجب", () => {
  const five = [fail(-5000), fail(-4000), fail(-3000), fail(-2000), fail(-1000)];
  assert.equal(loginLimit(five, T0, { inclusive: true }).limited, false);
  const r = loginLimit([...five, fail(0)], T0, { inclusive: true });
  assert.equal(r.limited, true);
  // بعد خروج أقدم اثنتين يبقى ٤ (مع صفّ هذا المحجوب)، فالمحاولة التالية خامسة
  if (r.limited) assert.equal(r.retryAfterSeconds, (LOGIN_WINDOW_MS - 4000) / 1000);
});
test("loginLimit inclusive: مئة صفّ متزامن ⇒ لا يمر إلا خمسة", () => {
  // كل طلب يرى صفّه وكل ما ثُبّت قبله — أسوأ ترتيب هو التسلسلي
  let passedCount = 0;
  const rows: { createdAt: Date; success: boolean }[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(fail(i));
    if (!loginLimit(rows, at(100), { inclusive: true }).limited) passedCount++;
  }
  assert.equal(passedCount, 5);
});

// ── مفتاح العنوان ──
test("ipLimitKey: IPv4 كما هو وموحّداً", () => {
  assert.equal(ipLimitKey("203.0.113.7"), "203.0.113.7");
  assert.equal(ipLimitKey(" 010.001.0.9 "), "10.1.0.9");
  assert.equal(ipLimitKey("256.1.1.1"), null);
  assert.equal(ipLimitKey("1.2.3"), null);
});
test("ipLimitKey: IPv6 بالـ /64 — عنوانان في نفس الشبكة مفتاح واحد", () => {
  const a = ipLimitKey("2001:db8:abcd:12:1::1");
  const b = ipLimitKey("2001:0DB8:ABCD:0012:ffff:ffff:ffff:fffe");
  assert.equal(a, "2001:db8:abcd:12::/64");
  assert.equal(a, b);
  assert.notEqual(a, ipLimitKey("2001:db8:abcd:13::1"));
  assert.equal(ipLimitKey("1:2:3:4:5:6:7:8"), "1:2:3:4::/64");
});
test("ipLimitKey: الاختصار :: في كل المواضع", () => {
  assert.equal(ipLimitKey("::"), "0:0:0:0::/64");
  assert.equal(ipLimitKey("::1"), "0:0:0:0::/64");
  assert.equal(ipLimitKey("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(ipLimitKey("2001:db8:1:2:3:4:5::"), "2001:db8:1:2::/64");
});
test("ipLimitKey: IPv4 مضمَّن", () => {
  // العنوان المحوَّل (::ffff:) هو جهاز IPv4 نفسه — نفس عدّاده
  assert.equal(ipLimitKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipLimitKey("::FFFF:203.0.113.7"), "203.0.113.7");
  assert.equal(ipLimitKey("64:ff9b::203.0.113.7"), "64:ff9b:0:0::/64");
  assert.equal(ipLimitKey("::ffff:999.0.0.1"), null);
});
test("ipLimitKey: معرّف المنطقة والأقواس تُهمَل", () => {
  assert.equal(ipLimitKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(ipLimitKey("fe80::1%25en0"), "fe80:0:0:0::/64");
  assert.equal(ipLimitKey("[2001:db8::1]"), "2001:db8:0:0::/64");
});
test("ipLimitKey: المشوّه ⇒ null", () => {
  for (const g of [
    null,
    "",
    "   ",
    "localhost",
    "1::2::3",
    ":::",
    "gggg::1",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "12345::1",
    "1.2.3.4, 5.6.7.8",
    "a".repeat(100),
  ]) {
    assert.equal(ipLimitKey(g), null, String(g));
  }
});
test("clientIpKey: x-real-ip وحده — x-forwarded-for يكتبه العميل", () => {
  assert.equal(clientIpKey(new Headers({ "x-forwarded-for": "1.2.3.4" })), null);
  assert.equal(
    clientIpKey(new Headers({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" })),
    "5.6.7.8",
  );
});

// ── بصمة الإرسال ──
const reply = (text: string, conversationId = "c1") =>
  ({ kind: "reply", conversationId, text }) as const;
test("fingerprint: نفس العملية بترتيب حقول مختلف ⇒ نفس البصمة", () => {
  const a = fingerprint({
    kind: "start",
    phone: "962770466649",
    template: { name: "t", language: "ar", variables: ["أحمد", "٢"] },
  });
  const b = fingerprint({
    template: { variables: ["أحمد", "٢"], language: "ar", name: "t" },
    phone: "962770466649",
    kind: "start",
  } as never);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});
test("fingerprint: نص أو مستلم أو قالب مختلف ⇒ بصمة مختلفة", () => {
  assert.notEqual(fingerprint(reply("أهلاً")), fingerprint(reply("أهلا")));
  assert.notEqual(fingerprint(reply("أهلاً", "c1")), fingerprint(reply("أهلاً", "c2")));
  const tpl = (variables: string[], phone = "962770466649") =>
    fingerprint({ kind: "start", phone, template: { name: "t", language: "ar", variables } });
  assert.notEqual(tpl(["a", "b"]), tpl(["b", "a"]));
  assert.notEqual(tpl(["a"]), tpl(["a"], "962770466648"));
  // نفس النص كرد وكقالب عمليتان مختلفتان
  assert.notEqual(
    fingerprint(reply("x")),
    fingerprint({
      kind: "template",
      conversationId: "c1",
      template: { name: "x", language: "ar", variables: [] },
    }),
  );
});

// ── قرار الحجز ──
const row = (state: ReservationRow["state"], extra: Partial<ReservationRow> = {}): ReservationRow => ({
  state,
  fingerprint: "fp",
  messageId: null,
  updatedAt: T0,
  ...extra,
});
test("decideReservation: بصمة مختلفة ⇒ mismatch في كل حالة", () => {
  for (const st of ["PENDING", "SENT", "UNKNOWN", "FAILED"] as const) {
    assert.deepEqual(decideReservation(row(st, { messageId: "m" }), "other", T0), {
      action: "mismatch",
    });
  }
});
test("decideReservation: جدول الحالات", () => {
  assert.deepEqual(decideReservation(row("SENT", { messageId: "m1" }), "fp", T0), {
    action: "replay",
    messageId: "m1",
  });
  assert.deepEqual(decideReservation(row("SENT"), "fp", T0), { action: "unknown" });
  assert.deepEqual(decideReservation(row("PENDING"), "fp", at(1000)), { action: "in_progress" });
  assert.deepEqual(decideReservation(row("UNKNOWN"), "fp", T0), { action: "unknown" });
  assert.deepEqual(decideReservation(row("FAILED"), "fp", T0), { action: "retry" });
});
test("decideReservation: معلّق أقدم من دقيقتين ⇒ stale، لا إعادة", () => {
  assert.deepEqual(decideReservation(row("PENDING"), "fp", at(STALE_PENDING_MS - 1)), {
    action: "in_progress",
  });
  assert.deepEqual(decideReservation(row("PENDING"), "fp", at(STALE_PENDING_MS)), {
    action: "stale",
  });
});

// ── تصنيف نتيجة Meta ──
test("failureKind: 4xx رفض صريح، 5xx غير مؤكّد", () => {
  for (const s of [400, 401, 403, 404, 429, 499]) assert.equal(failureKind(s), "rejected", String(s));
  for (const s of [500, 502, 503, 504, 0, 302]) assert.equal(failureKind(s), "unknown", String(s));
});
test("deliveryOutcome: فشل بلا kind يُعدّ unknown لا rejected", () => {
  assert.equal(deliveryOutcome({ ok: true }), "sent");
  assert.equal(deliveryOutcome({ ok: false, kind: "rejected" }), "rejected");
  assert.equal(deliveryOutcome({ ok: false, kind: "unknown" }), "unknown");
  assert.equal(deliveryOutcome({ ok: false, error: "x" }), "unknown");
});

// ── نطاق المؤشّر ──
test("cursor: وقت خارج ٢٠٢٠–٢١٠٠ ⇒ مشوّه", () => {
  const enc = (ms: number) => Buffer.from(`${ms}.abc`).toString("base64url");
  assert.equal(decodeCursor(enc(0)), null);
  assert.equal(decodeCursor(enc(Date.UTC(2019, 11, 31))), null);
  assert.equal(decodeCursor(enc(Date.UTC(2100, 0, 1))), null);
  assert.equal(decodeCursor(enc(999_999_999_999_999)), null);
  assert.ok(decodeCursor(enc(Date.UTC(2020, 0, 1))));
  assert.ok(decodeCursor(enc(Date.UTC(2099, 11, 31))));
});

// ── سقف حجم الجسم (غير متزامن) ──
const asyncTests: [string, () => Promise<void>][] = [];
const testAsync = (name: string, fn: () => Promise<void>) => asyncTests.push([name, fn]);

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit);

/** جسم مقطّع بلا content-length — ما يرسله من يتجنّب الفحص المبكر */
const streamOf = (bytes: number, chunk = 8192) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let left = bytes; left > 0; left -= chunk) c.enqueue(new Uint8Array(Math.min(chunk, left)).fill(32));
      c.close();
    },
  });

testAsync("readCappedText: جسم صغير يُقرأ كاملاً بالعربية", async () => {
  assert.equal(await readCappedText(post('{"text":"مرحبا"}')), '{"text":"مرحبا"}');
});
testAsync("readCappedText: content-length فوق السقف ⇒ null بلا قراءة", async () => {
  const req = post("{}", { "content-length": String(MAX_BODY_BYTES + 1) });
  assert.equal(await readCappedText(req), null);
  assert.equal(await readCappedText(post("{}", { "content-length": "abc" })), null);
});
testAsync("readCappedText: مقطّع فوق السقف بلا content-length ⇒ null", async () => {
  assert.equal(await readCappedText(post(streamOf(MAX_BODY_BYTES + 1))), null);
  assert.equal((await readCappedText(post(streamOf(MAX_BODY_BYTES))))?.length, MAX_BODY_BYTES);
});
testAsync("readCappedText: content-length يكذب بالأصغر ⇒ يُعدّ الفعلي", async () => {
  const req = post(streamOf(MAX_BODY_BYTES * 2), { "content-length": "10" });
  assert.equal(await readCappedText(req), null);
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── رفض انقضاء النافذة من Meta ─────────────────────────
test("isWindowRejection: رموز Meta الثلاثة ونصّها", () => {
  // نصوص كما تصل من meta.ts: «Meta 400: <body>»
  assert.equal(isWindowRejection('Meta 400: {"error":{"message":"(#131047) Re-engagement message","code":131047}}'), true);
  assert.equal(isWindowRejection('Meta 400: {"error":{"code":10,"error_subcode":2018278,"message":"(#10) This message is sent outside of allowed window."}}'), true);
  assert.equal(isWindowRejection('Meta 400: {"error":{"code":10,"error_subcode":2534022}}'), true);
});
test("isWindowRejection: غيرها ليس رفض نافذة", () => {
  assert.equal(isWindowRejection(undefined), false);
  assert.equal(isWindowRejection(""), false);
  assert.equal(isWindowRejection('Meta 400: {"error":{"code":131026,"message":"Message undeliverable"}}'), false);
  assert.equal(isWindowRejection('Meta 400: {"error":{"code":1310470}}'), false, "رقم أطول يحوي 131047 ليس هو");
  assert.equal(isWindowRejection("The operation was aborted due to timeout"), false);
});

if (failures.length) {
    console.error(failures.join("\n"));
    console.error(`\n${passed} نجح، ${failures.length} فشل`);
    process.exit(1);
  }
  console.log(`✅ ${passed} اختباراً نجحت`);
})();
