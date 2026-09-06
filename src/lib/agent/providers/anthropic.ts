import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { emptyUsage, type Provider, type ProviderRequest } from "./types";

/**
 * مزوّد Claude — مسار الإنتاج.
 *
 * مزاياه على البدائل هنا تحديداً:
 *  - كاش تعليمات النظام: نص البزنس ثابت عبر آلاف الرسائل ⇒ ~١٠٪ من سعر الإدخال.
 *  - tool runner مدمج: لا نكتب حلقة الأدوات يدوياً.
 *  - جودة العربية — وهي جوهر قيمة المنتج.
 */

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export const anthropicProvider: Provider = {
  id: "anthropic",

  async run(req: ProviderRequest) {
    const tools = req.tools.map((t) =>
      betaZodTool({
        name: t.name,
        description: t.description,
        // الأدوات محايدة الصيغة؛ هنا فقط نلبسها شكل Anthropic
        inputSchema: t.schema as never,
        run: t.run as never,
      }),
    );

    const messages: Anthropic.Beta.BetaMessageParam[] = req.history.map((h) => ({
      role: h.role,
      content: h.text,
    }));
    messages.push({ role: "user", content: req.userMessage });

    // العنصر الأول ثابت ⇒ يُكاش. العنصر الثاني متغيّر ⇒ بعد نقطة الكاش.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      { type: "text", text: req.volatileContext },
    ];

    const params = {
      model: req.model,
      max_tokens: 8000,
      system,
      messages,
      tools,
      max_iterations: req.maxIterations,
      thinking: { type: "adaptive" as const },
      output_config: {
        effort: req.effort as "low" | "medium" | "high" | "xhigh" | "max",
      },
    };

    const usage = emptyUsage();
    let final: Anthropic.Beta.BetaMessage | undefined;

    const drive = async (withFallback: boolean) => {
      const runner = getClient().beta.messages.toolRunner(
        withFallback
          ? {
              ...params,
              // عند رفض النموذج لأسباب سلامة، يُعاد الطلب تلقائياً على نموذج
              // بديل داخل نفس النداء بدل أن تتوقف المحادثة.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            }
          : params,
      );

      for await (const message of runner) {
        usage.input_tokens += message.usage.input_tokens ?? 0;
        usage.output_tokens += message.usage.output_tokens ?? 0;
        usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
        usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
        final = message;
      }
    };

    try {
      await drive(true);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        console.warn("[anthropic] تعذّر تفعيل fallback، إعادة المحاولة بدونه:", err.message);
        await drive(false);
      } else {
        throw err;
      }
    }

    const text =
      final?.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim() ?? "";

    return { text, stopReason: final?.stop_reason ?? null, usage };
  },
};
