import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { forceHandoff, replyAsHuman, resumeBot } from "../../actions";
import { SubmitButton } from "@/components/pending";
import { LiveRefresh } from "@/components/live";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "واتساب",
  MESSENGER: "ماسنجر",
  INSTAGRAM: "انستقرام",
  WEB: "تجربة",
};

const ROLE_LABEL: Record<string, string> = {
  USER: "العميل",
  AGENT: "الوكيل",
  HUMAN: "موظف",
  SYSTEM: "النظام",
};

/**
 * هوية العميل في رأس المحادثة: الاسم والمعرّف معاً.
 *
 * كان الرأس يعرض الاسم وحده ويسقط للمعرّف حين يغيب. لكن الاسم في واتساب هو
 * ما يكتبه العميل في ملفه الشخصي: قد يكون نقطة، أو رمزاً، أو اسماً يتكرر بين
 * عميلين — فلا يصلح وحده للتمييز، ولا يُعاد به الاتصال. الرقم هو المعرّف
 * الثابت، وهو ما يحتاجه الموظف ليتصل أو يبحث في سجلاته.
 *
 * والرقم يُعرَض بـ dir="ltr" معزولاً: خانة واحدة بالاتجاه الخاطئ تقلب
 * الرقم كله في سياق عربي فيُقرأ معكوساً.
 */
function Identity({
  channel,
  name,
  externalId,
}: {
  channel: string;
  name: string | null;
  externalId: string;
}) {
  const trimmed = name?.trim();
  // اسم بلا حرف ولا رقم («.») ليس اسماً
  const display = trimmed && /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : null;

  if (channel === "WEB") {
    return <strong>{display ?? "زائر الموقع"}</strong>;
  }

  return (
    <>
      {display && <strong>{display}</strong>}
      <span
        dir="ltr"
        style={{
          unicodeBidi: "isolate",
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-3)",
          fontSize: ".92em",
          marginInlineStart: display ? 8 : 0,
          userSelect: "all",
        }}
      >
        {channel === "WHATSAPP" ? `+${externalId}` : externalId}
      </span>
    </>
  );
}

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const convos = await prisma.conversation.findMany({
    where: { tenantId: tenant.id },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 60 },
      _count: { select: { messages: true } },
    },
  });

  return (
    <>
      <div className="card">
        <h3>سجل كامل وقابل للتدقيق</h3>
        <p className="hint" style={{ margin: 0 }}>
          كل رد محفوظ مع الأدوات التي استدعاها الوكيل واستهلاك التوكنات. لما يسألك صاحب
          المحل «من وين جاب هالمعلومة؟» — الجواب هنا.
        </p>
      </div>

      <div
        className="row"
        style={{ alignItems: "center", gap: 14, flexWrap: "wrap" }}
      >
        <h2 style={{ margin: 0 }}>المحادثات ({convos.length})</h2>
        <LiveRefresh slug={slug} />
      </div>

      {convos.length === 0 && <div className="card">لا يوجد محادثات بعد.</div>}

      {convos.map((c) => (
        <details className="card" key={c.id}>
          <summary>
            <Identity
              channel={c.channel}
              name={c.customerName}
              externalId={c.externalUserId}
            />{" "}
            <span className="pill">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>{" "}
            <span className={`pill ${c.status === "BOT" ? "ok" : "warn"}`}>
              {c.status === "BOT" ? "الوكيل يرد" : c.status === "HUMAN" ? "محوّلة لموظف" : "مغلقة"}
            </span>{" "}
            <span className="pill">{c._count.messages} رسالة</span>
          </summary>

          <div style={{ marginTop: 14 }}>
            {c.status === "HUMAN" && c.handoffReason && (
              <p className="hint">سبب التحويل: {c.handoffReason}</p>
            )}

            <div style={{ marginBottom: 14 }}>
              {c.messages.map((m) => {
                const tools = (m.toolCalls ?? []) as { name: string; summary: string }[];
                const usage = m.usage as Record<string, number> | null;
                return (
                  <div key={m.id}>
                    <div className={`bubble ${m.role === "USER" ? "user" : "agent"}`}>
                      {m.text}
                    </div>
                    <div className="meta">
                      {ROLE_LABEL[m.role]} ·{" "}
                      {new Intl.DateTimeFormat("ar-JO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(m.createdAt)}
                      {Array.isArray(tools) && tools.length > 0 && (
                        <> · ⚙️ {tools.map((t) => `${t.name} (${t.summary})`).join("، ")}</>
                      )}
                      {usage?.output_tokens ? (
                        <>
                          {" "}
                          · إدخال {usage.input_tokens} · كاش{" "}
                          {usage.cache_read_input_tokens ?? 0} · إخراج {usage.output_tokens}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* رد الموظف — متاح فقط بعد التحويل، وإلا تصادم ردّان على العميل */}
            {c.status === "HUMAN" && c.channel !== "WEB" && (
              <form action={replyAsHuman} style={{ marginBottom: 14 }}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={c.id} />
                <label>
                  <span>ردّك كموظف (يُرسل للعميل على {CHANNEL_LABEL[c.channel] ?? c.channel})</span>
                  <textarea
                    name="text"
                    rows={3}
                    required
                    maxLength={4000}
                    placeholder="اكتب ردك هنا…"
                  />
                </label>
                <SubmitButton pendingText="يُرسل…">إرسال للعميل</SubmitButton>
              </form>
            )}

            {c.status === "HUMAN" ? (
              <form action={resumeBot}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton>إعادة المحادثة للوكيل</SubmitButton>
              </form>
            ) : (
              <form action={forceHandoff}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton className="ghost">
                  تحويل لموظف بشري
                </SubmitButton>
              </form>
            )}
          </div>
        </details>
      ))}
    </>
  );
}
