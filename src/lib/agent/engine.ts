import type { Channel, MessageRole } from "@prisma/client";
import type { TenantContext, TenantScope } from "../tenancy";
import { addDays, toLocal } from "../appointments/time";
import { buildSystemPrompt } from "./prompt";
import { VOICE_STYLE } from "./voice-style";
import { buildTools, type RunState } from "./tools";
import { anthropicProvider } from "./providers/anthropic";
import { groqProvider } from "./providers/groq";
import type { Provider, ProviderUsage } from "./providers/types";

/**
 * محرك الوكيل: يحوّل رسالة عميل واحدة إلى رد.
 *
 * المحرك واحد لكل المنصة، لكن كل استدعاء يُبنى بالكامل من بيانات عميل واحد:
 * تعليمات النظام من صفّه، الأدوات مربوطة بنطاقه، والتاريخ من محادثته فقط.
 *
 * المزوّد قابل للتبديل عبر AGENT_PROVIDER — Claude للإنتاج، Groq للتجربة المجانية.
 * منطق العزل والحواجز مشترك بين الاثنين ولا يتغيّر بتغيّر المزوّد.
 */

const PROVIDERS: Record<string, Provider> = {
  anthropic: anthropicProvider,
  groq: groqProvider,
};

/**
 * المزوّد يُشتق من معرّف النموذج، لا من متغيّر بيئة.
 *
 * كان `AGENT_PROVIDER` يحسم المزوّد للمنصة كلها، فاختيار النموذج في الباقة
 * بلا أثر: تختار Groq فيذهب الطلب إلى Anthropic أو العكس. والاشتقاق من
 * المعرّف يجعل كل باقة — بل كل متجر — تختار مزوّدها فعلاً، ويسمح بتشغيل
 * متاجر مجانية ومدفوعة جنباً إلى جنب.
 *
 * `AGENT_PROVIDER` يبقى متاحاً كتجاوز صريح للتجربة المحلية.
 */
function providerFor(modelId: string): Provider {
  const forced = process.env.AGENT_PROVIDER?.toLowerCase();
  if (forced) {
    const p = PROVIDERS[forced];
    if (!p) {
      throw new Error(
        `AGENT_PROVIDER غير معروف: "${forced}". المتاح: ${Object.keys(PROVIDERS).join(" | ")}`,
      );
    }
    return p;
  }
  return modelId.startsWith("claude-") ? anthropicProvider : groqProvider;
}

export type AgentTurnResult = {
  reply: string;
  handoff: { requested: boolean; reason: string } | null;
  toolCalls: RunState["toolCalls"];
  usage: ProviderUsage;
  stopReason: string | null;
  provider: string;
};

export type HistoryItem = { role: MessageRole; text: string };

/**
 * سقف حروف التاريخ المُرسَل مع كل رسالة (≈ ٨٠٠ توكن).
 *
 * خدمة العملاء تعيش في آخر بضع رسائل؛ ما قبلها نادراً ما يغيّر الرد، بينما
 * كلفته تُدفع في كل نداء.
 */
const MAX_HISTORY_CHARS = 2400;

/**
 * «اليوم/بكرا/بعد بكرا» بتواريخها صراحةً.
 *
 * من «الوقت الآن» وحده يحسب النموذج الأيام بنفسه ويخطئ: قال «بكرا الجمعة»
 * والجمعة بعد بكرا، ثم «بكرا الخميس» في الرد نفسه. سطران بعد نقطة الكاش
 * أرخص من حجز يصل العميل بيوم خاطئ.
 */
function dayNames(tz: string): string {
  const today = toLocal(new Date(), tz).date;
  const label = (d: string) =>
    `${new Date(`${d}T12:00:00Z`).toLocaleDateString("ar", { weekday: "long", timeZone: "UTC" })} ${d}`;
  return [
    `اليوم: ${label(today)}`,
    `بكرا: ${label(addDays(today, 1))}`,
    `بعد بكرا: ${label(addDays(today, 2))}`,
  ].join(" · ");
}

export async function runAgentTurn(args: {
  tenant: TenantContext;
  scope: TenantScope;
  channel: Channel;
  externalUserId: string;
  history: HistoryItem[];
  userMessage: string;
}): Promise<AgentTurnResult> {
  const { tenant, scope, channel, externalUserId, history, userMessage } = args;

  const state: RunState = { handoff: null, toolCalls: [] };
  const tools = buildTools({ scope, tenant, channel, externalUserId, state });
  const provider = providerFor(tenant.modelId);

  // التاريخ: نص فقط. لا نعيد إرسال نداءات الأدوات القديمة — تكلفة بلا فائدة
  // في محادثة خدمة عملاء، وتُبقي البادئة مستقرة للكاش.
  //
  // ونقصّه بميزانية حروف لا بعدد رسائل: عشرون رسالة قد تكون مئتي حرف أو
  // ستة آلاف، فالعدد وحده لا يحدّ شيئاً. وفي محادثة طويلة ينتفخ التاريخ حتى
  // يبتلع حصّة الدقيقة عند المزوّد فتبدأ الردود تتأخّر بلا سبب ظاهر —
  // الأحدث أهم دائماً، فنُبقيه ونُسقط الأقدم.
  const kept: HistoryItem[] = [];
  let budget = MAX_HISTORY_CHARS;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h.text?.trim()) continue;
    budget -= h.text.length;
    if (budget < 0) break;
    kept.unshift(h);
  }

  const cleanHistory = kept.map((h) => ({
    role: (h.role === "USER" ? "user" : "assistant") as "user" | "assistant",
    text: h.text,
  }));

  const now = new Date().toLocaleString("ar-JO", {
    timeZone: tenant.timezone,
    dateStyle: "full",
    timeStyle: "short",
  });

  const res = await provider.run({
    // نموذج العميل من قاعدة البيانات؛ مزوّد Groq يتجاهله ويقرأ GROQ_MODEL
    model: tenant.modelId,
    effort: tenant.effort,
    // طبقة الأسلوب المنطوق تُضاف فوق التعليمات ولا تستبدلها: المعرفة والعزل
    // والأدوات تبقى واحدة عبر كل القنوات، والمتغيّر هو شكل الرد فقط.
    system:
      channel === "VOICE"
        ? buildSystemPrompt(tenant) + VOICE_STYLE
        : buildSystemPrompt(tenant),
    volatileContext: `الوقت الآن: ${now}\n${dayNames(tenant.timezone)}`,
    history: cleanHistory,
    userMessage,
    tools,
    maxIterations: 6,
    fast: channel === "VOICE",
  });

  // رفض من النموذج ⇒ لا نرسل نصاً غامضاً للعميل، نحوّل لموظف.
  if (res.stopReason === "refusal") {
    return {
      reply: "خليني أحوّلك لأحد الزملاء يساعدك بهالموضوع 🙏",
      handoff: { requested: true, reason: "رفض النموذج معالجة الطلب" },
      toolCalls: state.toolCalls,
      usage: res.usage,
      stopReason: res.stopReason,
      provider: provider.id,
    };
  }

  return {
    reply: res.text || "عذراً، ما وصلتني رسالتك تمام. ممكن تعيدها؟",
    handoff: state.handoff,
    toolCalls: state.toolCalls,
    usage: res.usage,
    stopReason: res.stopReason,
    provider: provider.id,
  };
}
