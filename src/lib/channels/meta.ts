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
        if (text) out.push({ ...base, text });
        else out.push({ ...base, text: "", unsupportedKind: "attachment" });
      }
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════
//  الإرسال
// ═══════════════════════════════════════════════════════════

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
