import { prisma } from "./db";
import { decrypt } from "./crypto";
import { planAllowsChannel } from "./plans";
import { runAgentTurn } from "./agent/engine";
import { sendMessage } from "./channels/meta";
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

    const userText = msg.text?.trim() || `[${msg.unsupportedKind ?? "غير نصي"}]`;
    await scope.addMessage({
      conversationId: convo.id,
      role: "USER",
      text: userText,
      externalId: msg.externalMessageId,
    });

    // 3) المحادثة محوّلة لموظف بشري ⇒ الوكيل يصمت تماماً.
    if (convo.status === "HUMAN") return;

    const reply = async (text: string) => {
      await scope.addMessage({ conversationId: convo.id, role: "AGENT", text });
      await deliver(tenant.id, msg, text);
    };

    // 4) مرفق غير مدعوم
    if (msg.unsupportedKind) {
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

async function deliver(tenantId: string, msg: InboundMessage, text: string) {
  if (msg.channel === "WEB") return; // واجهة الويب تقرأ الرد من الاستجابة مباشرة

  const scope = tenantScope(tenantId);
  const account = await scope.channelAccount(msg.channel);
  if (!account?.accessTokenEnc) {
    console.error("[pipeline] لا يوجد رمز وصول للقناة:", msg.channel, tenantId);
    return;
  }

  const res = await sendMessage({
    channel: msg.channel,
    accountExternalId: account.externalId,
    to: msg.externalUserId,
    text,
    accessToken: decrypt(account.accessTokenEnc),
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
