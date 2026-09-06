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
