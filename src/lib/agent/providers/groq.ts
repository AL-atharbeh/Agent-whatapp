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

/**
 * أطول انتظار نقبله داخل المحادثة قبل أن نعلن نفاد السعة.
 *
 * الحصّة تُقاس بالتوكنات في الدقيقة، ودورة حجز واحدة (اقتراح أوقات ثم حجز)
 * تستهلك ثلاث أو أربع نداءات بتعليمات كاملة في كل منها — فتنفد الحصّة في
 * منتصف الدورة وتتجدّد بعد ثوانٍ. الاستسلام هنا كان يحوّل المحادثة لموظف
 * ويقطع الحجز من أجل انتظار قصير؛ ردّ متأخّر بنصف دقيقة أهون من حجز ضائع.
 * ما يتجاوزها نفاد حقيقي: الحصّة اليومية أو ضغط متواصل.
 */
const MAX_WAIT_MS = 30_000;

/**
 * ثواني الانتظار من رأس الرد. `retry-after` رقم ثوانٍ، أما رأس الحصّة فمدّة
 * مثل «7m12s» — قراءتها بـ parseFloat تعطي ٧ ثوانٍ بدل ٤٣٢، فننتظر ثم نفشل.
 */
function retryAfter(err: unknown): number | null {
  const h = (err as { headers?: Record<string, string> })?.headers;
  const v = String(h?.["retry-after"] ?? h?.["x-ratelimit-reset-tokens"] ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * نداء واحد للنموذج، مع محاولة ثانية بعد انتظار التجديد عند التزاحم فقط.
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
    if (wait !== null && wait * 1000 > MAX_WAIT_MS) {
      throw new CapacityError("groq", wait);
    }
    // الرأس يقول متى تتجدّد الحصّة؛ بدونه ثانيتان تكفيان لتزاحم عابر
    await new Promise((r) => setTimeout(r, wait !== null ? wait * 1000 + 250 : 2_000));
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
          // تفكير gpt-oss يُحتسب من حصّة الدقيقة كأي ناتج، وردّ خدمة عملاء
          // لا يحتاج تفكيراً متوسطاً — «low» يوفّر مئات التوكنات في كل نداء
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {}),
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
