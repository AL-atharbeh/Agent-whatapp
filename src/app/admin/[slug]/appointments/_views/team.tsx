import { listServices, listStaff, type ServiceView, type StaffView } from "@/lib/appointments";
import { saveStaff } from "@/app/admin/appointments-actions";
import { SubmitButton } from "@/components/pending";
import { Avatar, Ctx, WEEK, type ViewProps } from "./shared";

/**
 * الفريق — الاسم، الصورة، الدوام الأسبوعي، الخدمات، العمولة.
 *
 * الدوام فترتان في اليوم كحدّ أقصى هنا (صباحية ومسائية) — يغطّي النشاط
 * بفترة واحدة وبفترتين مع استراحة. المكتبة تقبل أكثر، والجوال أو API
 * يستطيعان ضبطه إن احتاج أحد.
 */

const DEFAULT_HOURS: Record<string, [string, string][]> = {
  sat: [["10:00", "18:00"]],
  sun: [["10:00", "18:00"]],
  mon: [["10:00", "18:00"]],
  tue: [["10:00", "18:00"]],
  wed: [["10:00", "18:00"]],
  thu: [["10:00", "18:00"]],
  fri: [],
};

function StaffForm({
  slug,
  back,
  s,
  services,
}: {
  slug: string;
  back: string;
  s?: StaffView;
  services: ServiceView[];
}) {
  const key = s?.id ?? "new";
  const hours = (s?.workingHours ?? DEFAULT_HOURS) as Record<string, [string, string][] | undefined>;

  return (
    <form action={saveStaff}>
      <Ctx slug={slug} back={back} />
      {s && <input type="hidden" name="id" value={s.id} />}

      <div className="grid3">
        <label>
          <span>الاسم *</span>
          <input type="text" name="name" required defaultValue={s?.name ?? ""} />
        </label>
        <label>
          <span>الهاتف</span>
          <input type="tel" name="phone" dir="ltr" defaultValue={s?.phone ?? ""} />
        </label>
        <label>
          <span>العمولة ٪</span>
          <input type="text" inputMode="decimal" name="commissionPercent" defaultValue={s?.commissionPercent ?? ""} />
        </label>
      </div>

      <label>
        <span>الصورة (JPEG أو PNG أو WebP، حتى ١٥٠ كيلوبايت)</span>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" />
      </label>
      {s?.photoVersion && (
        <div className="checkline">
          <input type="checkbox" name="removePhoto" id={`rp-${key}`} />
          <label htmlFor={`rp-${key}`} style={{ margin: 0, color: "var(--text)" }}>
            إزالة الصورة الحالية
          </label>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>
          الدوام الأسبوعي (فارغ = عطلة)
        </div>
        <div className="hours-grid">
          {WEEK.map(({ key: d, label }) => {
            const r = hours[d] ?? [];
            return (
              <div key={d} className="hours-row">
                <span className="day">{label}</span>
                {[0, 1].map((i) => (
                  <span key={i} className="hours-pair">
                    <input type="time" name={`${d}_from${i + 1}`} defaultValue={r[i]?.[0] ?? ""} aria-label={`${label} — من (فترة ${i + 1})`} />
                    <span aria-hidden>–</span>
                    <input type="time" name={`${d}_to${i + 1}`} defaultValue={r[i]?.[1] ?? ""} aria-label={`${label} — إلى (فترة ${i + 1})`} />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>الخدمات التي يقدّمها</div>
        {services.length === 0 && <p className="hint">أضف الخدمات أولاً من «الخدمات».</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
          {services.map((sv) => (
            <div className="checkline" key={sv.id} style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                name="serviceIds"
                value={sv.id}
                id={`ss-${key}-${sv.id}`}
                defaultChecked={s?.serviceIds.includes(sv.id) ?? false}
              />
              <label htmlFor={`ss-${key}-${sv.id}`} style={{ margin: 0, color: "var(--text)" }}>
                {sv.name}
                {!sv.active && " (موقوفة)"}
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <label>
          <span>الترتيب</span>
          <input type="number" name="sortOrder" defaultValue={s?.sortOrder ?? 0} />
        </label>
        <div className="checkline" style={{ marginTop: 28 }}>
          <input type="checkbox" name="active" id={`st-${key}`} defaultChecked={s?.active ?? true} />
          <label htmlFor={`st-${key}`} style={{ margin: 0, color: "var(--text)" }}>
            يستقبل مواعيد
          </label>
        </div>
      </div>

      <SubmitButton>{s ? "حفظ التعديلات" : "إضافة للفريق"}</SubmitButton>
    </form>
  );
}

export default async function TeamView({ tenantId, slug, base }: ViewProps) {
  const back = `${base}/team`;
  const [staff, services] = await Promise.all([
    listStaff(tenantId, { includeInactive: true }),
    listServices(tenantId, { includeInactive: true }),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  return (
    <>
      <details className="card" open={staff.length === 0}>
        <summary>إضافة مقدّم خدمة</summary>
        <div style={{ marginTop: 16 }}>
          <StaffForm slug={slug} back={back} services={services} />
        </div>
      </details>

      <h2>الفريق ({staff.length})</h2>
      {staff.length === 0 && <div className="card">لا أحد في الفريق بعد.</div>}

      {staff.map((s) => (
        <details className="card" key={s.id}>
          <summary style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Avatar staff={s} size={28} />
            {s.name}
            {s.commissionPercent != null && <span className="pill">عمولة {s.commissionPercent}٪</span>}
            {!s.active && <span className="pill warn">لا يستقبل مواعيد</span>}
          </summary>
          <div style={{ marginTop: 16 }}>
            <p className="hint">
              الخدمات: {s.serviceIds.length ? s.serviceIds.map((id) => serviceName.get(id) ?? "—").join("، ") : "لا شيء بعد"}
            </p>
            <StaffForm slug={slug} back={back} s={s} services={services} />
          </div>
        </details>
      ))}
    </>
  );
}
