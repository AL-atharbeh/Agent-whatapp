import type { Channel, MessageRole } from "@prisma/client";
import type { TenantContext, TenantScope } from "../tenancy";
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
  const cleanHistory = history
    .filter((h) => h.text?.trim())
    .map((h) => ({
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
    volatileContext: `الوقت الآن: ${now}`,
    history: cleanHistory,
    userMessage,
    tools,
    maxIterations: 6,
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
