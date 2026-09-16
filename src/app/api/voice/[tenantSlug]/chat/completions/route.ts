import { prisma } from "@/lib/db";
import { runAgentTurn } from "@/lib/agent/engine";
import { loadTenantById, tenantScope } from "@/lib/tenancy";
import { planAllowsChannel } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * نقطة الوكيل الصوتية — بصيغة OpenAI Chat Completions.
 *
 * منصات المكالمات (Vapi وRetell وغيرهما) تتيح توجيه «نموذج مخصّص» إلى أي
 * عنوان يتكلّم هذه الصيغة. فنعرض وكيلنا بها بدل أن نبني تياراً صوتياً بأنفسنا:
 * المنصة تتولّى الصوت والمقاطعة وزمن الاستجابة، ونحن نتولّى ما نُحسنه —
 * المعرفة والعزل والأدوات.
 *
 * ونتيجة جانبية مقصودة: لا حاجة لخادم دائم يحمل WebSocket، فيبقى كل شيء
 * على Vercel، وتبديل منصة المكالمات لا يمسّ سطراً من منطق الوكيل.
 *
 *   POST /api/voice/<slug>/chat/completions
 *   Authorization: Bearer <voiceToken>
 */

type ChatMessage = { role: string; content: unknown };

/** المنصات ترسل المحتوى نصاً أو مصفوفة أجزاء — نقبل الشكلين. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? "")))
      .join(" ");
  }
  return "";
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * يقسّم الرد إلى جمل.
 *
 * المنصة تبدأ النطق فور وصول أول قطعة، فإرسال الرد جملةً جملةً يقصّر الصمت
 * الذي يسمعه المتصل قبل أول صوت — وهو أهم رقم في المكالمة.
 */
function sentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?؟،:\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await ctx.params;

  // ── المصادقة ──
  // النقطة عامة بالضرورة (منصة خارجية تناديها)، فبدون سرّ يستطيع أي أحد
  // تشغيل وكيل العميل وصرف رصيده. السرّ لكل متجر لا للمنصة كلها.
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return err(401, "ينقص ترويسة Authorization");

  const row = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, voiceToken: true, status: true, subscription: true, plan: true },
  });

  // رسالة واحدة للمتجر غير الموجود وللسرّ الخاطئ — حتى لا تكشف الاستجابة
  // أي المتاجر موجودة عند من يجرّب عشوائياً.
  if (!row?.voiceToken || row.voiceToken !== token) {
    return err(401, "متجر غير معروف أو سرّ غير صحيح");
  }
  if (row.status !== "ACTIVE") return err(403, "المتجر غير نشط");
  if (row.subscription !== "ACTIVE") return err(403, "الاشتراك غير مفعّل");
  if (!(await planAllowsChannel(row.plan, "VOICE"))) {
    return err(403, "المكالمات خارج باقة هذا المتجر");
  }

  let body: { messages?: ChatMessage[]; stream?: boolean; user?: string };
  try {
    body = await req.json();
  } catch {
    return err(400, "جسم الطلب ليس JSON صالحاً");
  }

  const messages = body.messages ?? [];
  // تعليمات المنصة (system) تُتجاهل عمداً: تعليمات الوكيل تُبنى من بيانات
  // المتجر وحدها، ولا تُحقن من طرف خارجي.
  const turns = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const last = turns.at(-1);
  const userMessage = last?.role === "user" ? textOf(last.content).trim() : "";
  if (!userMessage) return err(400, "لا توجد رسالة مستخدم");

  const history = turns.slice(0, -1).map((m) => ({
    role: (m.role === "user" ? "USER" : "AGENT") as "USER" | "AGENT",
    text: textOf(m.content),
  }));

  const tenant = await loadTenantById(row.id);
  if (!tenant) return err(404, "تعذّر تحميل المتجر");

  // معرّف المتصل من المنصة — يربط الأدوات (تسجيل عميل محتمل مثلاً) بمتصل بعينه
  const caller = typeof body.user === "string" && body.user ? body.user : "voice-caller";

  let reply: string;
  try {
    const result = await runAgentTurn({
      tenant,
      scope: tenantScope(tenant.id),
      channel: "VOICE",
      externalUserId: caller,
      history,
      userMessage,
    });
    reply = result.reply;
  } catch (e) {
    console.error("[voice] فشل الوكيل:", e);
    // لا نرجع خطأ HTTP: المنصة ستُسمع المتصل نغمة عطل. جملة مفهومة أفضل.
    reply = "صار عندي خلل بسيط، ممكن تعيد سؤالك؟";
  }

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = tenant.modelId;

  if (body.stream === false) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
      ],
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        controller.enqueue(
          enc.encode(
            sse({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finish }],
            }),
          ),
        );

      chunk({ role: "assistant" });
      for (const s of sentences(reply)) chunk({ content: s + " " });
      chunk({}, "stop");
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function err(status: number, message: string) {
  return Response.json({ error: { message, type: "invalid_request_error" } }, { status });
}
