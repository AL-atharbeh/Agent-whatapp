import { addDays, appointmentReport, isDateStr, loadApptTenant, toLocal } from "@/lib/appointments";
import { minutesLabel, money, type ViewProps } from "./shared";

/**
 * التقارير — دخل كل فرد وعمولته، الغياب، أكثر الخدمات، والوقت الذي وفّره
 * النظام. الأرقام كلها من appointmentReport في المكتبة: الجوال سيعرض
 * الأرقام نفسها، وحسابان للعمولة يختلفان في التقريب يظهران رقمين لنفس الشهر.
 */
export default async function ReportsView({ tenantId, sp }: ViewProps) {
  const t = await loadApptTenant(tenantId);
  const today = toLocal(new Date(), t.timezone).date;
  let to = sp.to && isDateStr(sp.to) ? sp.to : today;
  let from = sp.from && isDateStr(sp.from) ? sp.from : addDays(to, -29);
  if (from > to) [from, to] = [to, from];

  const r = await appointmentReport(tenantId, from, to);
  const pct = (x: number) => `${Math.round(x * 100)}٪`;

  return (
    <>
      <form method="get" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ margin: 0 }}>
          <span>من</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label style={{ margin: 0 }}>
          <span>إلى</span>
          <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit">اعرض</button>
      </form>

      <div className="stats">
        <div className="stat">
          <div className="stat-value live">{money(r.revenue, t.currency)}</div>
          <div className="stat-label">الدخل</div>
        </div>
        <div className="stat">
          <div className="stat-value">{r.visits}</div>
          <div className="stat-label">زيارة مكتملة</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={r.noShowRate > 0.1 ? { color: "var(--danger)" } : undefined}>
            {pct(r.noShowRate)}
          </div>
          <div className="stat-label">
            نسبة الغياب ({r.noShows} غياب · {r.cancelled} إلغاء)
          </div>
        </div>
        <div className="stat">
          <div className="stat-value live">{minutesLabel(r.minutesSaved)}</div>
          <div className="stat-label">وقت وفّره النظام عن المدد الثابتة</div>
        </div>
      </div>

      <h2>الفريق</h2>
      {r.staff.length === 0 ? (
        <div className="card">لا زيارات مكتملة في هذه الفترة.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>مقدّم الخدمة</th>
                <th>الزيارات</th>
                <th>الدخل</th>
                <th>العمولة</th>
              </tr>
            </thead>
            <tbody>
              {r.staff.map((s) => (
                <tr key={s.staffId}>
                  <td>{s.name}</td>
                  <td>{s.visits}</td>
                  <td>{money(s.revenue, t.currency)}</td>
                  <td>
                    {s.commissionPercent == null
                      ? "—"
                      : `${money(s.commission, t.currency)} (${s.commissionPercent}٪)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>أكثر الخدمات</h2>
      {r.topServices.length === 0 ? (
        <div className="card">لا شيء بعد.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>الخدمة</th>
                <th>الزيارات</th>
                <th>الدخل</th>
              </tr>
            </thead>
            <tbody>
              {r.topServices.map((s) => (
                <tr key={s.serviceId}>
                  <td>{s.name}</td>
                  <td>{s.visits}</td>
                  <td>{money(s.revenue, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        «الوقت الذي وفّره النظام» = مجموع الفرق بين المدة الافتراضية لكل خدمة والمدة التي حُجزت
        فعلاً بعد أن تعلّم النظام من زيارات كل عميل — وقتٌ كان سيبقى محجوزاً فارغاً.
      </p>
    </>
  );
}
