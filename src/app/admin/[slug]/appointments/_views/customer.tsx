import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppointmentError,
  customerProfile,
  listStaff,
  loadApptTenant,
  toLocal,
  type CustomerProfile,
} from "@/lib/appointments";
import { saveCustomer } from "@/app/admin/appointments-actions";
import { SubmitButton } from "@/components/pending";
import { CHANNEL, Ctx, STATUS, minutesLabel, money, type ViewProps } from "./shared";

const BASIS: Record<string, string> = {
  customer: "حسب زياراته السابقة",
  staff: "حسب مقدّم الخدمة",
  default: "المدة الافتراضية",
};

/**
 * ملف العميل — القنوات، الزيارات بملاحظاتها، المدد المتعلَّمة، القادم، والغياب.
 * «شو عملتولي آخر مرة؟» يُجاب من هنا بنظرة: ملاحظات الزيارة مع كل سطر.
 */
export default async function CustomerView({ tenantId, slug, base, id }: ViewProps & { id: string }) {
  let p: CustomerProfile;
  try {
    p = await customerProfile(tenantId, id);
  } catch (err) {
    if (err instanceof AppointmentError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [t, staff] = await Promise.all([loadApptTenant(tenantId), listStaff(tenantId, { includeInactive: true })]);
  const c = p.customer;
  const back = `${base}/customers/${c.id}`;
  const date = (iso: string) => toLocal(new Date(iso), t.timezone);

  return (
    <>
      <p style={{ marginTop: 0 }}>
        <Link href={`${base}/customers`} style={{ color: "var(--text-3)", fontSize: 13.5 }}>
          ← كل العملاء
        </Link>
      </p>

      <div className="card">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>{c.name ?? "عميل بلا اسم"}</h3>
            {c.phone && (
              <span dir="ltr" style={{ unicodeBidi: "isolate", color: "var(--text-3)" }}>
                +{c.phone}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {p.channels.map((ch) => (
              <span key={`${ch.channel}:${ch.externalUserId}`} className="pill">
                {CHANNEL[ch.channel] ?? ch.channel}
              </span>
            ))}
          </div>
        </div>
        <div className="stats" style={{ marginTop: 16, marginBottom: 0 }}>
          <div className="stat">
            <div className="stat-value">{c.visitCount}</div>
            <div className="stat-label">زيارة</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={c.noShowCount ? { color: "var(--danger)" } : undefined}>
              {c.noShowCount}
            </div>
            <div className="stat-label">غياب</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ fontSize: 20 }}>
              {c.lastVisitAt ? date(c.lastVisitAt).date : "—"}
            </div>
            <div className="stat-label">آخر زيارة</div>
          </div>
        </div>
      </div>

      <details className="card">
        <summary>تعديل البيانات والملاحظات الدائمة</summary>
        <form action={saveCustomer} style={{ marginTop: 16 }}>
          <Ctx slug={slug} back={back} />
          <input type="hidden" name="id" value={c.id} />
          <div className="grid3">
            <label>
              <span>الاسم</span>
              <input type="text" name="name" defaultValue={c.name ?? ""} />
            </label>
            <label>
              <span>الهاتف</span>
              <input type="tel" name="phone" dir="ltr" defaultValue={c.phone ? `+${c.phone}` : ""} />
            </label>
            <label>
              <span>مقدّم الخدمة المفضّل</span>
              <select name="preferredStaffId" defaultValue={c.preferredStaffId ?? ""}>
                <option value="">بلا تفضيل</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>ملاحظات دائمة</span>
            <textarea name="notes" defaultValue={c.notes ?? ""} placeholder="حساسية، تفضيلات، ما يلزم تذكّره في كل زيارة" />
          </label>
          <SubmitButton>حفظ</SubmitButton>
        </form>
      </details>

      {c.notes && (
        <div className="alert ok">
          <strong>ملاحظات دائمة:</strong> {c.notes}
        </div>
      )}

      <h2>القادم ({p.upcoming.length})</h2>
      {p.upcoming.length === 0 && <div className="card">لا مواعيد قادمة.</div>}
      {p.upcoming.map((a) => (
        <div className="card" key={a.id}>
          <strong>
            {a.local.date} {a.local.time}
          </strong>{" "}
          <span className={`pill ${STATUS[a.status]?.cls ?? ""}`}>{STATUS[a.status]?.label ?? a.status}</span>
          <div className="hint" style={{ margin: "4px 0 0" }}>
            {a.service.name} · {a.staff.name} · {minutesLabel(a.plannedMinutes)} ·{" "}
            <Link href={`${base}?date=${a.local.date}#a-${a.id}`}>في جدول اليوم</Link>
          </div>
        </div>
      ))}

      <h2>المدد المتعلَّمة</h2>
      {p.learned.length === 0 ? (
        <div className="card">لا زيارات مكتملة بعد — يُحجز له بالمدة الافتراضية لكل خدمة.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>الخدمة</th>
                <th>يُحجز له</th>
                <th>الأساس</th>
                <th>الافتراضية</th>
                <th>آخر المدد</th>
              </tr>
            </thead>
            <tbody>
              {p.learned.map((l) => (
                <tr key={l.serviceId}>
                  <td>{l.serviceName}</td>
                  <td>
                    <strong>{minutesLabel(l.minutes)}</strong>
                  </td>
                  <td className="sub">{BASIS[l.basis]}</td>
                  <td>{minutesLabel(l.defaultMinutes)}</td>
                  <td className="sub">{l.recentMinutes.join("، ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>الزيارات ({p.history.length})</h2>
      {p.history.length === 0 ? (
        <div className="card">لا زيارات بعد.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الخدمة</th>
                <th>مقدّم الخدمة</th>
                <th>الحالة</th>
                <th>المدة</th>
                <th>السعر</th>
                <th>ملاحظات الزيارة</th>
              </tr>
            </thead>
            <tbody>
              {p.history.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{date(h.startAt).date}</td>
                  <td>{h.serviceName}</td>
                  <td>{h.staffName}</td>
                  <td>
                    <span className={`pill ${STATUS[h.status]?.cls ?? ""}`}>{STATUS[h.status]?.label ?? h.status}</span>
                  </td>
                  <td>{h.actualMinutes != null ? minutesLabel(h.actualMinutes) : "—"}</td>
                  <td>{money(h.finalPrice, t.currency)}</td>
                  <td>{h.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
