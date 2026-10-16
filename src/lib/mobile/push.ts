import { after } from "next/server";
import type { Channel } from "@prisma/client";
import { prisma } from "../db";
import { levelsFor, pushContent, type PushType } from "./notify";
import { signServiceJwt } from "./jwt";

/**
 * إشعارات الجوال عبر FCM HTTP v1.
 *
 * بلا مكتبة firebase-admin: هي عشرات الميغابايت لنحتاج منها نداءين — توقيع
 * JWT ونداء HTTP — وكلاهما في node:crypto و fetch. وحجم الحزمة يُدفع في
 * كل تشغيل بارد على Vercel.
 *
 * القاعدة الأولى هنا: **الإشعار لا يكسر خط المعالجة أبداً.** كل ما يخرج من
 * هذا الملف يُلتقط ويُسجَّل؛ عطل في FCM لا يجوز أن يمنع رد الوكيل على العميل.
 */

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

let warned = false;
let cachedAccount: ServiceAccount | null | undefined;

/** يقرأ حساب الخدمة مرة واحدة لكل نسخة. غيابه ليس عطلاً: التطبيق يعيش على الاستطلاع. */
function serviceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;

  const raw = process.env.FCM_SERVICE_ACCOUNT;
  let parsed: ServiceAccount | null = null;
  if (raw?.trim()) {
    try {
      const j = JSON.parse(raw) as Partial<ServiceAccount>;
      if (j.project_id && j.client_email && j.private_key) {
        parsed = {
          project_id: j.project_id,
          client_email: j.client_email,
          // متغيّرات البيئة في بعض اللوحات تحفظ \n حرفين لا سطراً جديداً،
          // فيرفض node:crypto المفتاح بخطأ لا يذكر السبب.
          private_key: j.private_key.replace(/\\n/g, "\n"),
          token_uri: j.token_uri,
        };
      }
    } catch {
      parsed = null;
    }
  }

  // سطر واحد لكل نسخة لا لكل رسالة — وإلا غرق السجل بتحذير متكرر
  if (!parsed && !warned) {
    warned = true;
    console.warn(
      "[push] FCM_SERVICE_ACCOUNT غير مضبوط أو غير صالح — الإشعارات معطّلة والتطبيق يعتمد على الاستطلاع",
    );
  }
  cachedAccount = parsed;
  return parsed;
}

// ═══════════════════════════════════════════════════════════
//  رمز الوصول — JWT موقّع بـ RS256 يُبادَل برمز OAuth2
// ═══════════════════════════════════════════════════════════

let accessToken: { value: string; expiresAt: number } | null = null;
let minting: Promise<string> | null = null;

/**
 * رمز وصول مخزَّن حتى قبيل انتهائه.
 *
 * بدون التخزين يصير كل إشعار نداءين لـ Google بدل واحد. و`minting` المشترك
 * يمنع رسائل متزامنة من سكّ رموز متوازية لنفس الغرض.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value;
  if (minting) return minting;

  minting = (async () => {
    const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
    const assertion = signServiceJwt({
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
      scope: SCOPE,
      audience: tokenUri,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("OAuth بلا access_token");

    accessToken = {
      value: j.access_token,
      expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
    };
    return j.access_token;
  })().finally(() => {
    minting = null;
  });

  return minting;
}

// ═══════════════════════════════════════════════════════════
//  الإرسال
// ═══════════════════════════════════════════════════════════

export type PushEvent = {
  tenantId: string;
  type: PushType;
  conversation: {
    id: string;
    channel: Channel;
    customerName: string | null;
    externalUserId: string;
  };
  /** نص رسالة العميل، أو سبب التحويل */
  text: string;
};

type SendResult = "ok" | "unregistered" | "auth" | "failed";

async function sendOne(
  sa: ServiceAccount,
  token: string,
  pushToken: string,
  ev: PushEvent,
): Promise<SendResult> {
  const { title, body } = pushContent({
    type: ev.type,
    channel: ev.conversation.channel,
    customerName: ev.conversation.customerName,
    externalUserId: ev.conversation.externalUserId,
    text: ev.text,
  });

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: pushToken,
          notification: { title, body },
          data: {
            type: ev.type,
            conversationId: ev.conversation.id,
            channel: ev.conversation.channel,
          },
          // نفس الوسم لنفس المحادثة: رسالة ثم تحويلها بعد ثانية تحلّ محل
          // بعضها في الشريط بدل أن تتراكم إشعارات عن محادثة واحدة.
          android: {
            priority: "high",
            notification: { tag: ev.conversation.id },
          },
          apns: {
            headers: { "apns-collapse-id": ev.conversation.id, "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (res.ok) return "ok";
  const text = await res.text();
  if (res.status === 401) return "auth";
  // 404 أو UNREGISTERED: التطبيق حُذف أو الرمز تجدّد — لن يصل إليه شيء بعد اليوم
  if (res.status === 404 || text.includes("UNREGISTERED")) return "unregistered";
  console.error(`[push] FCM ${res.status}:`, text.slice(0, 500));
  return "failed";
}

/**
 * يرسل الحدث لكل أجهزة مستخدمي هذا المتجر التي تريده.
 *
 * الشروط كلها في الاستعلام نفسه — متجر، غير مسحوبة، غير منتهية، لها رمز،
 * ومستوى إشعارها يقبل الحدث — فلا يخرج إشعار من متجر لجهاز متجر آخر ولو
 * أخطأ أحد في الفلترة بعد ذلك.
 */
export async function sendPush(ev: PushEvent): Promise<void> {
  const sa = serviceAccount();
  if (!sa) return;

  const now = new Date();
  const devices = await prisma.deviceSession.findMany({
    where: {
      tenantId: ev.tenantId,
      revokedAt: null,
      expiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
      pushToken: { not: null },
      notify: { in: levelsFor(ev.type) },
      // المستخدم ما زال في هذا المتجر — نقله يقطع إشعاراته فوراً
      user: { tenantId: ev.tenantId, role: "TENANT_OWNER" },
    },
    select: { id: true, pushToken: true },
  });
  if (devices.length === 0) return;

  // جلستان على نفس الجهاز (إعادة تثبيت بلا خروج) تحملان نفس الرمز —
  // بدون هذا يصل الإشعار مرتين.
  const byToken = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.pushToken) continue;
    byToken.set(d.pushToken, [...(byToken.get(d.pushToken) ?? []), d.id]);
  }

  let token = await getAccessToken(sa);
  const dead: string[] = [];

  await Promise.all(
    [...byToken.entries()].map(async ([pushToken, ids]) => {
      try {
        let r = await sendOne(sa, token, pushToken, ev);
        if (r === "auth") {
          // رمز وصول أُبطل قبل موعده — نسكّ واحداً جديداً ونعيد مرة واحدة
          accessToken = null;
          token = await getAccessToken(sa);
          r = await sendOne(sa, token, pushToken, ev);
        }
        if (r === "unregistered") dead.push(...ids);
      } catch (err) {
        console.error("[push] فشل إرسال لجهاز:", err);
      }
    }),
  );

  if (dead.length) {
    await prisma.deviceSession.updateMany({
      where: { id: { in: dead }, tenantId: ev.tenantId },
      data: { pushToken: null },
    });
  }
}

const PUSH_CHANNELS: readonly Channel[] = ["WHATSAPP", "MESSENGER", "INSTAGRAM"];

/**
 * يجدول الإشعار بعد الرد ولا ينتظره.
 *
 * داخل طلب: `after()` — Vercel يُبقي الدالة حيّة حتى ينتهي، والرد لا ينتظر.
 * خارج طلب (سكربت المحاكاة): `after` يرمي، فنطلقه بلا انتظار.
 * وفي الحالتين: لا استثناء يصل إلى المنادي.
 */
export function schedulePush(ev: PushEvent): void {
  // التجربة والمكالمات لا تظهر في الجوال — إشعار عنها يفتح شاشة فارغة
  if (!PUSH_CHANNELS.includes(ev.conversation.channel)) return;
  if (!serviceAccount()) return;

  const task = () =>
    sendPush(ev).catch((err) => console.error("[push] فشل الإشعار:", err));
  try {
    after(task);
  } catch {
    void task();
  }
}
