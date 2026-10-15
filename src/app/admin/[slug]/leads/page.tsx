import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "واتساب",
  MESSENGER: "ماسنجر",
  INSTAGRAM: "انستقرام",
  WEB: "تجربة",
};

/**
 * رقما العميل: ما قاله، والرقم الذي راسلنا منه.
 *
 * ليسا واحداً بالضرورة — يترك العميل رقم مكتبه ويكتب من هاتفه — والفرق
 * يهمّ من سيتصل. فنعرض ما قاله أولاً لأنه ما اختاره للتواصل، ونُتبعه
 * بالآخر حين يختلف بدل أن نخفي أحدهما.
 *
 * و dir="ltr" معزولاً: خانة واحدة بالاتجاه الخاطئ تقلب الرقم في سياق عربي.
 */
function Phones({ said, from }: { said: string | null; from: string | null }) {
  const digits = (v: string) => v.replace(/\D/g, "");
  const wa = from ? `+${from}` : null;
  const same = said && from && digits(said).endsWith(digits(from).slice(-9));

  const Num = ({ value, muted }: { value: string; muted?: boolean }) => (
    <span
      dir="ltr"
      style={{
        unicodeBidi: "isolate",
        fontVariantNumeric: "tabular-nums",
        userSelect: "all",
        display: "block",
        ...(muted ? { color: "var(--text-3)", fontSize: ".88em" } : {}),
      }}
    >
      {value}
    </span>
  );

  if (!said && !wa) return <>—</>;
  if (said && wa && !same) {
    return (
      <>
        <Num value={said} />
        <Num value={`راسلنا من ${wa}`} muted />
      </>
    );
  }
  return <Num value={said ?? wa!} />;
}

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const leads = await prisma.lead.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  /**
   * الاسم من المحادثة حين لا يعطيه العميل للوكيل.
   *
   * `name` و`phone` في العميل المحتمل هما ما قاله العميل بكلامه، وأكثر من
   * يبدي نية شراء لا يقولهما. فكانت القائمة تعرض شرطتين وصنفاً — ولا سبيل
   * لمعرفة مَن هذا ولا كيف يُعاد الاتصال به، وهي القائمة التي بُنيت لتُتابَع.
   *
   * والمعرّف كان محفوظاً طوال الوقت: رقم واتساب الذي راسلنا منه. نصل به إلى
   * محادثته فنأخذ اسمه المعروض كذلك.
   */
  const keys = leads
    .filter((l) => l.externalUserId)
    .map((l) => ({ channel: l.channel, externalUserId: l.externalUserId! }));

  const convos = keys.length
    ? await prisma.conversation.findMany({
        where: { tenantId: tenant.id, OR: keys },
        select: { channel: true, externalUserId: true, customerName: true },
      })
    : [];

  const nameOf = new Map(
    convos.map((c) => [`${c.channel}:${c.externalUserId}`, c.customerName]),
  );

  return (
    <>
      <div className="card">
        <h3>العملاء المحتملون</h3>
        <p className="hint" style={{ margin: 0 }}>
          يسجّلهم الوكيل تلقائياً عند رصد نية شراء واضحة — بدون أن يخبر العميل. هذي أقوى
          ورقة بيع للمنتج: صاحب المحل يستيقظ على قائمة زبائن جاهزة للمتابعة.
        </p>
      </div>

      <h2>القائمة ({leads.length})</h2>

      {leads.length === 0 && (
        <div className="card">لا يوجد عملاء محتملون بعد.</div>
      )}

      {leads.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>القناة</th>
                <th>الاهتمام</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Intl.DateTimeFormat("ar-JO", { dateStyle: "short" }).format(
                      l.createdAt,
                    )}
                  </td>
                  <td>{l.name ?? nameOf.get(`${l.channel}:${l.externalUserId}`) ?? "—"}</td>
                  <td>
                    <Phones
                      said={l.phone}
                      from={l.channel === "WHATSAPP" ? l.externalUserId : null}
                    />
                  </td>
                  <td>
                    <span className="pill">{CHANNEL_LABEL[l.channel] ?? l.channel}</span>
                  </td>
                  <td>{l.interest}</td>
                  <td className="sub">{l.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
