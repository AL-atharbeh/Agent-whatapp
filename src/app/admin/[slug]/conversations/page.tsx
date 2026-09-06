import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { forceHandoff, resumeBot } from "../../actions";

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

      <h2>المحادثات ({convos.length})</h2>

      {convos.length === 0 && <div className="card">لا يوجد محادثات بعد.</div>}

      {convos.map((c) => (
        <details className="card" key={c.id}>
          <summary>
            {c.customerName ?? c.externalUserId}{" "}
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

            {c.status === "HUMAN" ? (
              <form action={resumeBot}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={c.id} />
                <button type="submit">إعادة المحادثة للوكيل</button>
              </form>
            ) : (
              <form action={forceHandoff}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={c.id} />
                <button type="submit" className="ghost">
                  تحويل لموظف بشري
                </button>
              </form>
            )}
          </div>
        </details>
      ))}
    </>
  );
}
