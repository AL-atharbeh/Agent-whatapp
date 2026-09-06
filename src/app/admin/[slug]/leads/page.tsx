import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "واتساب",
  MESSENGER: "ماسنجر",
  INSTAGRAM: "انستقرام",
  WEB: "تجربة",
};

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const leads = await prisma.lead.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

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
                  <td>{l.name ?? "—"}</td>
                  <td>{l.phone ?? "—"}</td>
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
