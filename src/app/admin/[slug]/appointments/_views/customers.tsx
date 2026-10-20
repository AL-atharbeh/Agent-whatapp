import Link from "next/link";
import { loadApptTenant, searchCustomers, toLocal } from "@/lib/appointments";
import { saveCustomer } from "@/app/admin/appointments-actions";
import { SubmitButton } from "@/components/pending";
import { Ctx, type ViewProps } from "./shared";

/**
 * العملاء — بحث بالاسم أو الرقم. الأرقام العربية-الهندية تُوحَّد في
 * searchCustomers نفسها، فـ«٦٦٤٩» تجد +962770466649 كما تجدها «6649».
 */
export default async function CustomersView({ tenantId, slug, base, sp }: ViewProps) {
  const q = (sp.q ?? "").slice(0, 80);
  const [t, rows] = await Promise.all([loadApptTenant(tenantId), searchCustomers(tenantId, q, 50)]);

  return (
    <>
      <form method="get" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="ابحث بالاسم أو آخر أرقام الهاتف"
          aria-label="بحث"
          style={{ flex: "1 1 220px" }}
        />
        <button type="submit">بحث</button>
      </form>

      <details className="card">
        <summary>إضافة عميل</summary>
        <form action={saveCustomer} style={{ marginTop: 16 }}>
          <Ctx slug={slug} back={`${base}/customers`} />
          <div className="grid2">
            <label>
              <span>الهاتف</span>
              <input type="tel" name="phone" dir="ltr" placeholder="07XXXXXXXX" />
            </label>
            <label>
              <span>الاسم</span>
              <input type="text" name="name" />
            </label>
          </div>
          <label>
            <span>ملاحظات دائمة</span>
            <textarea name="notes" placeholder="حساسية، تفضيلات، ما يلزم تذكّره في كل زيارة" />
          </label>
          <p className="hint">رقم مسجّل من قبل ⇒ يُفتح ملف العميل نفسه ولا يُنشأ ثانٍ.</p>
          <SubmitButton>إضافة</SubmitButton>
        </form>
      </details>

      <h2>{q ? `نتائج «${q}» (${rows.length})` : `الأحدث زيارة (${rows.length})`}</h2>
      {rows.length === 0 && <div className="card">لا نتائج.</div>}
      {rows.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>الزيارات</th>
                <th>الغياب</th>
                <th>آخر زيارة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`${base}/customers/${c.id}`}>{c.name ?? "بلا اسم"}</Link>
                  </td>
                  <td dir="ltr" style={{ unicodeBidi: "isolate", textAlign: "end" }}>
                    {c.phone ? `+${c.phone}` : "—"}
                  </td>
                  <td>{c.visitCount}</td>
                  <td>{c.noShowCount ? <span className="pill danger">{c.noShowCount}</span> : "0"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.lastVisitAt ? toLocal(c.lastVisitAt, t.timezone).date : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
