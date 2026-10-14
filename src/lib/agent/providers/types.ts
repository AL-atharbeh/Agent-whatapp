import type { AgentTool } from "../tools";

/** ما يحتاجه أي مزوّد لتنفيذ دورة رد واحدة. */
export type ProviderRequest = {
  model: string;
  effort: string;
  /** تعليمات النظام — ثابتة لكل عميل (تُكاش عند المزوّدات التي تدعم الكاش) */
  system: string;
  /** سياق متغيّر (الوقت) — يوضع بعد نقطة الكاش دائماً */
  volatileContext: string;
  history: { role: "user" | "assistant"; text: string }[];
  userMessage: string;
  tools: AgentTool[];
  /** حد أقصى لجولات الأدوات، حماية من الحلقات اللانهائية */
  maxIterations: number;
};

export type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type ProviderResponse = {
  text: string;
  stopReason: string | null;
  usage: ProviderUsage;
};

export type Provider = {
  id: string;
  run: (req: ProviderRequest) => Promise<ProviderResponse>;
};

export const emptyUsage = (): ProviderUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

/**
 * تجاوز سعة المزوّد — حالة مختلفة عن العطل.
 *
 * عند `429` تنتظر مكتبة العميل المدّة التي يطلبها المزوّد ثم تعيد المحاولة.
 * بدا ذلك سليماً، لكنه في مسار واتساب يعني أن العميل يرسل سؤالاً فلا يرى
 * شيئاً دقيقة كاملة ثم يصل الرد — ولا أحد يعرف لماذا: لا سطر في السجل، ولا
 * إشارة في اللوحة، والمتجر يظن أن النظام بطيء.
 *
 * فنحدّ الانتظار ونرفع الحالة باسمها، ليقرّر خط المعالجة ماذا يقول للعميل
 * ويُسجَّل السبب الحقيقي: السعة نفدت، لا الوكيل تعطّل.
 */
export class CapacityError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(provider: string, retryAfterSeconds: number | null) {
    super(
      `تجاوز سعة المزوّد ${provider}` +
        (retryAfterSeconds ? ` — إعادة المحاولة بعد ${retryAfterSeconds}s` : ""),
    );
    this.name = "CapacityError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
