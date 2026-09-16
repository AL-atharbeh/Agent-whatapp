import { prisma } from "./db";
import { decrypt } from "./crypto";
import { planAllowsChannel } from "./plans";
import { runAgentTurn } from "./agent/engine";
import { downloadAudio, sendAudio, sendMessage } from "./channels/meta";
import { MAX_TTS_CHARS, synthesize, transcribe } from "./speech";
import type { InboundMessage } from "./channels/types";
import {
  loadTenantById,
  resolveTenantByChannelAccount,
  tenantScope,
} from "./tenancy";

/**
 * خط المعالجة: من رسالة واردة إلى رد مُرسل.
 *
 * كل البوابات الدفاعية هنا، قبل أي نداء للنموذج:
 * حل العميل ← حالة الاشتراك ← تكرار ← تحويل بشري نشط ← سقف يومي ← كلمات تحويل.
 */

// قفل لكل محادثة: لو أرسل العميل ثلاث رسائل متتالية بسرعة، تُعالَج بالترتيب
// بدل أن يتسابق ردّان على نفس التاريخ.
// (نسخة واحدة من الخادم. للتوسّع الأفقي: Redis lock — انظر README.)
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}).finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    }),
  );
  return next;
}

const UNSUPPORTED_REPLY =
  "وصلني مرفقك بس ما بقدر أشوفه هون. ممكن تكتبلي طلبك بالكلام؟ أو بحوّلك لموظف يساعدك 🙏";

const VOICE_FAILED_REPLY =
  "وصلني الفويس بس ما قدرت أسمعه منيح. ممكن تعيده أو تكتبلي طلبك؟ 🙏";

export async function handleInbound(msg: InboundMessage): Promise<void> {
  // 1) حلّ العميل من حساب القناة. لا وجود لحساب ⇒ رسالة ليست لنا.
  const account = await resolveTenantByChannelAccount(msg.channel, msg.accountExternalId);
  if (!account || !account.active) {
    console.warn("[pipeline] حساب قناة غير معروف:", msg.channel, msg.accountExternalId);
    return;
  }

  const tenant = await loadTenantById(account.tenantId);
  if (!tenant || tenant.status !== "ACTIVE") return;

  // 1ب) الاشتراك — الحدود المعلنة في الباقة تُطبَّق هنا فعلاً، لا في الواجهة فقط
  if (tenant.subscription !== "ACTIVE") {
    console.warn(`[pipeline] اشتراك غير نشط: ${tenant.slug} (${tenant.subscription})`);
    return;
  }
  if (tenant.expiresAt && tenant.expiresAt < new Date()) {
    console.warn(`[pipeline] اشتراك منتهٍ: ${tenant.slug}`);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { subscription: "EXPIRED", status: "PAUSED" },
    });
    return;
  }
  if (!(await planAllowsChannel(tenant.plan, msg.channel))) {
    console.warn(`[pipeline] قناة ${msg.channel} خارج باقة ${tenant.plan} — ${tenant.slug}`);
    return;
  }

  const scope = tenantScope(tenant.id);

  await withLock(`${tenant.id}:${msg.channel}:${msg.externalUserId}`, async () => {
    // 2) منع المعالجة المكرّرة (Meta تعيد الإرسال عند عدم استلام 200)
    if (msg.externalMessageId && (await scope.isDuplicate(msg.externalMessageId))) return;

    const convo = await scope.getOrCreateConversation(
      msg.channel,
      msg.externalUserId,
      msg.customerName,
    );

    // 2ب) فويس وارد ⇒ نفرّغه ونكمل به كأنه نص. يسبق تخزين الرسالة حتى
    // يظهر في «المحادثات» نصاً مقروءاً لا سطراً مبهماً.
    let transcript: string | null = null;
    if (msg.audio) {
      transcript = await transcribeInbound(tenant.id, msg, tenant.locale);
    }

    const userText =
      transcript ?? msg.text?.trim() ?? "";
    const storedText =
      transcript ? `🎤 ${transcript}` : userText || `[${msg.unsupportedKind ?? "غير نصي"}]`;

    await scope.addMessage({
      conversationId: convo.id,
      role: "USER",
      text: storedText,
      externalId: msg.externalMessageId,
    });

    // 3) المحادثة محوّلة لموظف بشري ⇒ الوكيل يصمت تماماً.
    if (convo.status === "HUMAN") return;

    // الرد بفويس لمن أرسل فويس فقط — ومن كتب نصاً يبقى رده مكتوباً.
    const speak = Boolean(transcript) && tenant.voiceReplies;

    const reply = async (text: string) => {
      await scope.addMessage({ conversationId: convo.id, role: "AGENT", text });
      await deliver(tenant.id, msg, text, speak);
    };

    // 4ب) فويس وصل لكن تفريغه فشل — نعتذر بدل الصمت
    if (msg.audio && !transcript) {
      await reply(VOICE_FAILED_REPLY);
      return;
    }

    // 4) مرفق غير مدعوم
    if (msg.unsupportedKind || !userText) {
      await reply(UNSUPPORTED_REPLY);
      return;
    }

    // 5) كلمات تفرض التحويل فوراً (قبل صرف أي توكن)
    const lowered = userText.toLowerCase();
    const hit = tenant.handoffKeywords.find((k) => lowered.includes(k.toLowerCase()));
    if (hit) {
      await scope.handoff(convo.id, `كلمة مفتاحية: ${hit}`);
      await reply("تمام، رح أحوّلك لأحد الزملاء يتواصل معك حالاً 🙏");
      return;
    }

    // 6) سقف الحماية اليومي
    if ((await scope.repliesToday()) >= tenant.maxRepliesPerDay) {
      await scope.handoff(convo.id, "تجاوز السقف اليومي للردود");
      console.warn("[pipeline] تجاوز السقف اليومي:", tenant.slug);
      return;
    }

    // 7) تشغيل الوكيل
    const history = (await scope.recentMessages(convo.id, 20))
      .filter((m) => m.role === "USER" || m.role === "AGENT")
      .slice(0, -1) // آخر رسالة هي رسالة المستخدم الحالية، تُمرّر منفصلة
      .map((m) => ({ role: m.role, text: m.text }));

    let result;
    try {
      result = await runAgentTurn({
        tenant,
        scope,
        channel: msg.channel,
        externalUserId: msg.externalUserId,
        history,
        userMessage: userText,
      });
    } catch (err) {
      console.error("[pipeline] فشل الوكيل:", err);
      await scope.handoff(convo.id, "خطأ تقني في الوكيل");
      await reply("صار عندي خلل بسيط، رح يتواصل معك أحد الزملاء 🙏");
      return;
    }

    await scope.addMessage({
      conversationId: convo.id,
      role: "AGENT",
      text: result.reply,
      toolCalls: result.toolCalls,
      usage: result.usage,
    });

    if (result.handoff?.requested) {
      await scope.handoff(convo.id, result.handoff.reason);
    }

    await deliver(tenant.id, msg, result.reply);
  });
}

/** ينزّل الفويس الوارد ويفرّغه. يرجّع null عند أي فشل — والمنادي يقرر الرد. */
async function transcribeInbound(
  tenantId: string,
  msg: InboundMessage,
  locale: string,
): Promise<string | null> {
  const account = await tenantScope(tenantId).channelAccount(msg.channel);
  if (!account?.accessTokenEnc) {
    console.error("[pipeline] لا يوجد رمز وصول لتنزيل الصوت:", msg.channel, tenantId);
    return null;
  }

  const file = await downloadAudio({
    mediaId: msg.audio?.mediaId,
    url: msg.audio?.url,
    accessToken: decrypt(account.accessTokenEnc),
  });
  if (!file.ok) {
    console.error("[pipeline] فشل تنزيل الفويس:", file.error);
    return null;
  }

  const out = await transcribe({
    audio: file.audio,
    mimeType: file.mimeType ?? msg.audio?.mimeType,
    locale,
  });
  if (!out.ok) {
    console.error("[pipeline] فشل تفريغ الفويس:", out.error);
    return null;
  }
  return out.value;
}

async function deliver(
  tenantId: string,
  msg: InboundMessage,
  text: string,
  speak = false,
) {
  if (msg.channel === "WEB") return; // واجهة الويب تقرأ الرد من الاستجابة مباشرة

  const scope = tenantScope(tenantId);
  const account = await scope.channelAccount(msg.channel);
  if (!account?.accessTokenEnc) {
    console.error("[pipeline] لا يوجد رمز وصول للقناة:", msg.channel, tenantId);
    return;
  }
  const accessToken = decrypt(account.accessTokenEnc);

  // الصوت محاولة أولى لا التزام: أي تعثّر — نص طويل، موديل محجوب، رفض من ميتا —
  // يسقط للنص بدل أن يضيع الرد على العميل.
  if (speak && msg.channel === "WHATSAPP" && text.length <= MAX_TTS_CHARS) {
    const voice = await synthesize({ text });
    if (voice.ok) {
      const res = await sendAudio({
        channel: msg.channel,
        accountExternalId: account.externalId,
        to: msg.externalUserId,
        audio: voice.value.audio,
        mimeType: voice.value.mimeType,
        accessToken,
      });
      if (res.ok) return;
      console.error("[pipeline] فشل إرسال الفويس، يرجع للنص:", res.error);
    } else {
      console.error("[pipeline] فشل توليد الفويس، يرجع للنص:", voice.error);
    }
  }

  const res = await sendMessage({
    channel: msg.channel,
    accountExternalId: account.externalId,
    to: msg.externalUserId,
    text,
    accessToken,
  });
  if (!res.ok) console.error("[pipeline] فشل الإرسال:", res.error);
}

/**
 * مسار مختصر للتجربة (سكربت المحاكاة وواجهة الويب): نفس المحرك ونفس العزل،
 * بدون قنوات خارجية.
 */
export async function chatOnce(args: {
  tenantSlug: string;
  sessionId: string;
  text: string;
}): Promise<
  | {
      reply: string;
      toolCalls: unknown[];
      usage: unknown;
      provider: string;
      handedOff?: boolean;
    }
  | { error: string }
> {
  const { loadTenantBySlug } = await import("./tenancy");
  const tenant = await loadTenantBySlug(args.tenantSlug);
  if (!tenant) return { error: "لا يوجد عميل بهذا المعرّف" };

  const scope = tenantScope(tenant.id);
  const convo = await scope.getOrCreateConversation("WEB", args.sessionId);

  await scope.addMessage({ conversationId: convo.id, role: "USER", text: args.text });

  // المحادثة محوّلة لموظف ⇒ الوكيل يصمت، تماماً كما في مسار الواتساب.
  // بدون هذا الفحص كانت التجربة تخالف سلوك الإنتاج وتكرّر رسالة التحويل.
  if (convo.status === "HUMAN") {
    return {
      reply: "",
      toolCalls: [],
      usage: {},
      provider: "—",
      handedOff: true,
    };
  }

  const history = (await scope.recentMessages(convo.id, 20))
    .filter((m) => m.role === "USER" || m.role === "AGENT")
    .slice(0, -1)
    .map((m) => ({ role: m.role, text: m.text }));

  const result = await runAgentTurn({
    tenant,
    scope,
    channel: "WEB",
    externalUserId: args.sessionId,
    history,
    userMessage: args.text,
  });

  await scope.addMessage({
    conversationId: convo.id,
    role: "AGENT",
    text: result.reply,
    toolCalls: result.toolCalls,
    usage: result.usage,
  });

  if (result.handoff?.requested) await scope.handoff(convo.id, result.handoff.reason);

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    usage: result.usage,
    provider: result.provider,
  };
}
