import OpenAI from "openai";
import { z } from "zod";
import { CapacityError, emptyUsage, type Provider, type ProviderRequest } from "./types";

/**
 * مزوّد Groq — للتجربة المجانية فقط.
 *
 * Groq يقدّم واجهة متوافقة مع OpenAI، فنستخدم حزمة openai موجّهة لعنوانه.
 *
 * فروق جوهرية عن مسار الإنتاج (Claude) — مهمة عند تفسير نتائج التجربة:
 *  - لا يوجد كاش لتعليمات النظام ⇒ نص البزنس يُحتسب كاملاً في كل رسالة.
 *  - جودة العربية أضعف؛ توقّع لهجة أقل طبيعية وأخطاء صرفية.
 *  - حلقة الأدوات مكتوبة يدوياً هنا (لا يوجد tool runner).
 *
 * لذلك: هذا المسار يثبت أن السباكة والأدوات والعزل تعمل، لا أن المنتج جاهز للبيع.
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * بلا إعادة محاولة تلقائية، وبمهلة قصيرة.
 *
 * السلوك الافتراضي للمكتبة عند `429` أن تنتظر ما يطلبه المزوّد — وقد يبلغ
 * دقيقة — ثم تعيد المحاولة بصمت. في واجهة برمجية هذا تصرّف سليم؛ في محادثة
 * واتساب هو أسوأ الاحتمالات: العميل كتب سؤالاً ولا يرى شيئاً، والرد يصل بعد
 * أن يكون قد غادر. الانتظار الطويل لا يُنقذ الرد، يؤجّله فقط.
 */
let client: OpenAI | null = null;
const getClient = () =>
  (client ??= new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: GROQ_BASE_URL,
    maxRetries: 0,
    timeout: 25_000,
  }));

/** ثانية واحدة تكفي لابتلاع تزاحم عابر؛ ما بعدها نفاد سعة حقيقي. */
const BRIEF_RETRY_MS = 1_000;

function retryAfter(err: unknown): number | null {
  const h = (err as { headers?: Record<string, string> })?.headers;
  const v = h?.["retry-after"] ?? h?.["x-ratelimit-reset-tokens"];
  if (!v) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * نداء واحد للنموذج، مع محاولة ثانية قصيرة عند التزاحم فقط.
 *
 * نميّز `429` عن بقية الأخطاء: الأولى سعة نفدت والثانية عطل. ودمجهما تحت
 * «خطأ تقني» يُخفي عن صاحب المتجر أن باقته هي ما ضاق، لا أن النظام معطوب.
 */
async function callOnce(
  create: () => Promise<OpenAI.Chat.Completions.ChatCompletion>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  try {
    return await create();
  } catch (err) {
    if ((err as { status?: number })?.status !== 429) throw err;

    const wait = retryAfter(err);
    if (wait !== null && wait * 1000 > BRIEF_RETRY_MS) {
      throw new CapacityError("groq", wait);
    }
    await new Promise((r) => setTimeout(r, BRIEF_RETRY_MS));
    try {
      return await create();
    } catch (err2) {
      if ((err2 as { status?: number })?.status === 429) {
        throw new CapacityError("groq", retryAfter(err2));
      }
      throw err2;
    }
  }
}

export const groqProvider: Provider = {
  id: "groq",

  async run(req: ProviderRequest) {
    // النموذج من باقة المتجر أولاً — وإلا بقي اختيار الباقة بلا أثر.
    //
    // معرّف Claude يصل إلى هنا فقط حين يُجبر AGENT_PROVIDER المزوّد على Groq
    // بينما الباقة تطلب Claude؛ عندها نسقط إلى GROQ_MODEL ثم إلى افتراضي
    // معروف. والافتراضي القديم (llama-3.3-70b-versatile) لم يعد موجوداً على
    // Groq، فكان يكسر المسار بصمت.
    const fromPlan = req.model && !req.model.startsWith("claude-") ? req.model : null;
    const model = fromPlan ?? process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";

    const toolMap = new Map(req.tools.map((t) => [t.name, t]));
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(t.schema) as Record<string, unknown>,
      },
    }));

    // لا يوجد كاش هنا، فنجمع الثابت والمتغيّر في رسالة نظام واحدة.
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: `${req.system}\n\n${req.volatileContext}` },
      ...req.history.map((h) => ({ role: h.role, content: h.text }) as const),
      { role: "user", content: req.userMessage },
    ];

    const usage = emptyUsage();
    let text = "";
    let stopReason: string | null = null;

    for (let i = 0; i < req.maxIterations; i++) {
      const res = await callOnce(() =>
        getClient().chat.completions.create({
          model,
          messages,
          tools,
          max_tokens: 2048,
          temperature: 0.3,
        }),
      );

      usage.input_tokens += res.usage?.prompt_tokens ?? 0;
      usage.output_tokens += res.usage?.completion_tokens ?? 0;

      const choice = res.choices[0];
      const msg = choice?.message;
      stopReason = choice?.finish_reason ?? null;
      if (!msg) break;

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        text = msg.content?.trim() ?? "";
        break;
      }

      messages.push(msg);

      for (const call of calls) {
        if (call.type !== "function") continue;
        const tool = toolMap.get(call.function.name);
        let result: string;
        if (!tool) {
          result = JSON.stringify({ error: `أداة غير معروفة: ${call.function.name}` });
        } else {
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            // نتحقّق من المُدخل بنفس مخطط الأداة — النماذج الأصغر تخطئ في الوسائط
            const validated = tool.schema.parse(parsed);
            result = await tool.run(validated as never);
          } catch (err) {
            result = JSON.stringify({
              error: "وسائط غير صالحة أو فشل التنفيذ",
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    return { text, stopReason, usage };
  },
};
