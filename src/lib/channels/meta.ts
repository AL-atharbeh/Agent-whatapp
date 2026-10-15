import crypto from "node:crypto";
import type { Channel } from "@prisma/client";
import type { InboundMessage, OutboundResult } from "./types";

const GRAPH = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

// ═══════════════════════════════════════════════════════════
//  التحقق من صحة الويبهوك
// ═══════════════════════════════════════════════════════════

/** يتحقق من توقيع Meta على الجسم الخام. رفض التوقيع = رفض الطلب. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const got = header.slice("sha256=".length);
  // مقارنة ثابتة الزمن لمنع timing attacks
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// ═══════════════════════════════════════════════════════════
//  تطبيع الرسائل الواردة
// ═══════════════════════════════════════════════════════════

type AnyRecord = Record<string, unknown>;

/** يحوّل payload الويبهوك (أياً كانت قناته) إلى قائمة InboundMessage موحّدة. */
export function parseWebhook(body: AnyRecord): InboundMessage[] {
  const out: InboundMessage[] = [];
  const object = body.object as string | undefined;
  const entries = (body.entry as AnyRecord[]) ?? [];

  for (const entry of entries) {
    // ── واتساب ──
    if (object === "whatsapp_business_account") {
      for (const change of (entry.changes as AnyRecord[]) ?? []) {
        const value = change.value as AnyRecord | undefined;
        if (!value) continue;
        const meta = value.metadata as AnyRecord | undefined;
        const accountExternalId = meta?.phone_number_id as string | undefined;
        if (!accountExternalId) continue;

        const contacts = (value.contacts as AnyRecord[]) ?? [];
        const nameOf = (waId: string) => {
          const c = contacts.find((x) => x.wa_id === waId);
          return (c?.profile as AnyRecord | undefined)?.name as string | undefined;
        };

        for (const msg of (value.messages as AnyRecord[]) ?? []) {
          const from = msg.from as string;
          const type = msg.type as string;
          const base = {
            channel: "WHATSAPP" as Channel,
            accountExternalId,
            externalUserId: from,
            externalMessageId: msg.id as string,
            customerName: nameOf(from),
          };
          if (type === "text") {
            out.push({ ...base, text: ((msg.text as AnyRecord)?.body as string) ?? "" });
          } else if (type === "audio" || type === "voice") {
            // واتساب يميّز الفويس (voice) عن الملف الصوتي (audio) — كلاهما يُفرَّغ
            const a = (msg.audio ?? msg.voice) as AnyRecord | undefined;
            out.push({
              ...base,
              text: "",
              audio: { mediaId: a?.id as string, mimeType: a?.mime_type as string },
            });
          } else if (type === "interactive") {
            // ردود الأزرار/القوائم
            const inter = msg.interactive as AnyRecord;
            const reply =
              (inter?.button_reply as AnyRecord) ?? (inter?.list_reply as AnyRecord);
            out.push({ ...base, text: (reply?.title as string) ?? "" });
          } else {
            out.push({ ...base, text: "", unsupportedKind: type });
          }
        }
      }
      continue;
    }

    // ── ماسنجر / انستقرام ──
    if (object === "page" || object === "instagram") {
      const channel: Channel = object === "page" ? "MESSENGER" : "INSTAGRAM";
      const accountExternalId = entry.id as string;
      for (const ev of (entry.messaging as AnyRecord[]) ?? []) {
        const message = ev.message as AnyRecord | undefined;
        if (!message || message.is_echo) continue; // تجاهل صدى رسائلنا نحن
        const sender = (ev.sender as AnyRecord)?.id as string;
        const base = {
          channel,
          accountExternalId,
          externalUserId: sender,
          externalMessageId: message.mid as string,
        };
        const text = message.text as string | undefined;
        if (text) {
          out.push({ ...base, text });
          continue;
        }
        // ماسنجر وانستقرام يرسلان رابطاً مباشراً للمرفق بدل معرّف ميديا
        const att = ((message.attachments as AnyRecord[]) ?? [])[0];
        const url = (att?.payload as AnyRecord | undefined)?.url as string | undefined;
        if (att?.type === "audio" && url) out.push({ ...base, text: "", audio: { url } });
        else out.push({ ...base, text: "", unsupportedKind: (att?.type as string) ?? "attachment" });
      }
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════
//  الإرسال
// ═══════════════════════════════════════════════════════════

/**
 * ينزّل فويساً وارداً.
 *
 * واتساب يعطي معرّف ميديا فقط، ويتطلّب نداءين: الأول يرجّع رابطاً مؤقتاً
 * والثاني يجلب البايتات — وكلاهما يحتاج الرمز، فالرابط وحده لا يكفي.
 * ماسنجر وانستقرام يعطيان الرابط مباشرة في الويبهوك.
 */
export async function downloadAudio(args: {
  mediaId?: string;
  url?: string;
  accessToken: string;
}): Promise<{ ok: true; audio: Buffer; mimeType?: string } | { ok: false; error: string }> {
  const auth = { Authorization: `Bearer ${args.accessToken}` };

  try {
    let url = args.url;
    let mimeType: string | undefined;

    if (args.mediaId) {
      const meta = await fetch(`${GRAPH()}/${args.mediaId}`, {
        headers: auth,
        signal: AbortSignal.timeout(15000),
      });
      if (!meta.ok) {
        return { ok: false, error: `جلب بيانات الميديا ${meta.status}: ${await meta.text()}` };
      }
      const info = (await meta.json()) as { url?: string; mime_type?: string };
      url = info.url;
      mimeType = info.mime_type;
    }
    if (!url) return { ok: false, error: "لا يوجد رابط للملف الصوتي" };

    const bin = await fetch(url, { headers: auth, signal: AbortSignal.timeout(30000) });
    if (!bin.ok) return { ok: false, error: `تنزيل الصوت ${bin.status}` };

    return {
      ok: true,
      audio: Buffer.from(await bin.arrayBuffer()),
      mimeType: mimeType ?? bin.headers.get("content-type") ?? undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** يرفع ملفاً صوتياً لواتساب ويرجّع معرّف الميديا الصالح ٣٠ يوماً. */
async function uploadAudio(args: {
  accountExternalId: string;
  audio: Buffer;
  mimeType: string;
  accessToken: string;
}): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", args.mimeType);
  form.append(
    "file",
    new Blob([new Uint8Array(args.audio)], { type: args.mimeType }),
    args.mimeType.includes("ogg") ? "reply.ogg" : "reply.mp3",
  );

  try {
    const res = await fetch(`${GRAPH()}/${args.accountExternalId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { ok: false, error: `رفع الصوت ${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { id?: string };
    if (!data.id) return { ok: false, error: "الرفع نجح بلا معرّف ميديا" };
    return { ok: true, mediaId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * يرسل الرد كفويس.
 *
 * واتساب فقط في الوقت الحالي: ماسنجر وانستقرام يحتاجان رابطاً عاماً للملف أو
 * رفعاً بصيغة مختلفة، وهو ما لا يستحق التعقيد قبل أن يطلبه عميل فعلاً.
 * من ينادي هذه الدالة مسؤول عن الرجوع للنص عند الفشل.
 */
export async function sendAudio(args: {
  channel: Channel;
  accountExternalId: string;
  to: string;
  audio: Buffer;
  mimeType: string;
  accessToken: string;
}): Promise<OutboundResult> {
  if (args.channel !== "WHATSAPP") {
    return { ok: false, error: `إرسال الصوت غير مدعوم على ${args.channel}` };
  }

  const up = await uploadAudio(args);
  if (!up.ok) return { ok: false, error: up.error };

  try {
    const res = await fetch(`${GRAPH()}/${args.accountExternalId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to,
        type: "audio",
        audio: { id: up.mediaId },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `إرسال الصوت ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendMessage(args: {
  channel: Channel;
  accountExternalId: string;
  to: string;
  text: string;
  accessToken: string;
}): Promise<OutboundResult> {
  const { channel, accountExternalId, to, text, accessToken } = args;
  const url = `${GRAPH()}/${accountExternalId}/messages`;

  const payload =
    channel === "WHATSAPP"
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: text },
        }
      : {
          recipient: { id: to },
          messaging_type: "RESPONSE",
          message: { text },
        };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { ok: false, error: `Meta ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
//  القوالب — الطريق الوحيد لمراسلة رقم لم يراسلنا
// ═══════════════════════════════════════════════════════════

/**
 * واتساب يمنع الرسالة الحرّة خارج نافذة الأربع وعشرين ساعة.
 *
 * القاعدة من Meta لا منّا: ما لم يراسلنا الرقم خلال اليوم الماضي، لا يُقبل
 * منّا إلا قالب وافقت عليه مسبقاً. الغرض منع الرسائل غير المرغوبة، والنتيجة
 * أن «ابدأ محادثة مع عميل جديد» ليست مسألة حقل إدخال بل قالب معتمد.
 */
export type Template = {
  name: string;
  language: string;
  category: string;
  /** نص المتن كما اعتُمد، بعلامات {{1}} في مواضع المتغيّرات */
  body: string;
  /** عدد المتغيّرات التي يجب تعبئتها قبل الإرسال */
  variables: number;
};

/** يعدّ {{1}}، {{2}} … ويرجّع أكبر رقم — لا عدد المرات، فقد يتكرر المتغيّر. */
function countVariables(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** يملأ {{n}} بالقيم — لنخزّن في السجل ما رآه العميل، لا النص الخام. */
export function renderTemplate(body: string, variables: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => variables[Number(n) - 1] ?? `{{${n}}}`);
}

/** القوالب المعتمدة فقط — المرفوض والمعلّق يفشل عند الإرسال، فلا نعرضه. */
export async function listTemplates(args: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: true; templates: Template[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${GRAPH()}/${args.wabaId}/message_templates` +
        `?fields=name,status,category,language,components&limit=100`,
      {
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return { ok: false, error: `Meta ${res.status}: ${await res.text()}` };

    const json = (await res.json()) as {
      data?: { name: string; status: string; category: string; language: string;
               components?: { type: string; text?: string }[] }[];
    };

    const templates = (json.data ?? [])
      .filter((t) => t.status === "APPROVED")
      .map((t) => {
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
        return {
          name: t.name,
          language: t.language,
          category: t.category,
          body,
          variables: countVariables(body),
        };
      });

    return { ok: true, templates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** يرسل قالباً معتمداً — المسار الوحيد لبدء محادثة مع رقم جديد. */
export async function sendTemplate(args: {
  accountExternalId: string;
  to: string;
  name: string;
  language: string;
  variables: string[];
  accessToken: string;
}): Promise<OutboundResult> {
  const { accountExternalId, to, name, language, variables, accessToken } = args;

  const payload: AnyRecord = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      // قالب بلا متغيّرات يُرفض إن أرسلنا له components فارغة
      ...(variables.length
        ? {
            components: [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };

  try {
    const res = await fetch(`${GRAPH()}/${accountExternalId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `Meta ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * ينشئ قالباً ويرسله لمراجعة Meta.
 *
 * كان إنشاء القوالب يتم في مدير Meta وحده. ذلك ممكن لمتجر واحد نديره نحن،
 * ومستحيل حين يصير لكل متجر قوالبه: لا يُعقَل أن يفتح صاحب محل لوحة Meta
 * ليكتب جملة ترحيب.
 *
 * و`example` ليست تجميلاً: Meta ترفض فوراً أي قالب فيه متغيّر بلا قيمة
 * مثال، لأن المراجع يحتاج أن يرى الجملة مكتملة ليحكم عليها.
 */
export async function createTemplate(args: {
  wabaId: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  footer?: string;
  /** قيمة مثال لكل {{n}} بالترتيب */
  examples: string[];
  accessToken: string;
}): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  const { wabaId, name, language, category, body, footer, examples, accessToken } = args;

  const components: AnyRecord[] = [
    {
      type: "BODY",
      text: body,
      // قالب بلا متغيّرات يُرفض إن أرسلنا له example فارغاً
      ...(examples.length ? { example: { body_text: [examples] } } : {}),
    },
  ];
  if (footer?.trim()) components.push({ type: "FOOTER", text: footer.trim() });

  try {
    const res = await fetch(`${GRAPH()}/${wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, language, category, components }),
      signal: AbortSignal.timeout(15000),
    });

    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { error_user_msg?: string; message?: string };
    };

    if (!res.ok) {
      // Meta تعطي رسالة موجّهة للمستخدم حين تملكها — وهي أوضح من رمز الخطأ
      const msg = json.error?.error_user_msg ?? json.error?.message ?? `Meta ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, id: json.id ?? "", status: json.status ?? "PENDING" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
