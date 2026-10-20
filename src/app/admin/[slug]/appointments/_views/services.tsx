import { listServices, listStaff, loadApptTenant, type ServiceView } from "@/lib/appointments";
import { saveService } from "@/app/admin/appointments-actions";
import { SubmitButton } from "@/components/pending";
import { Ctx, minutesLabel, priceRange, type ViewProps } from "./shared";

/**
 * الخدمات — السعر من/إلى، المدة الافتراضية، وقت الانتظار الاختياري، والعودة.
 *
 * المدة الافتراضية نقطة البداية فقط: المقدِّر يتجاوزها حين يتعلّم من زيارات
 * العميل ومقدّم الخدمة. لذلك يُشرح هنا أنها «حين لا تاريخ».
 */

function ServiceForm({ slug, back, s }: { slug: string; back: string; s?: ServiceView }) {
  const key = s?.id ?? "new";
  return (
    <form action={saveService}>
      <Ctx slug={slug} back={back} />
      {s && <input type="hidden" name="id" value={s.id} />}

      <div className="grid2">
        <label>
          <span>اسم الخدمة *</span>
          <input type="text" name="name" required defaultValue={s?.name ?? ""} />
        </label>
        <label>
          <span>التصنيف</span>
          <input type="text" name="category" defaultValue={s?.category ?? ""} />
        </label>
      </div>

      <div className="grid3">
        <label>
          <span>السعر من *</span>
          <input type="text" inputMode="decimal" name="priceMin" required defaultValue={s?.priceMin ?? ""} />
        </label>
        <label>
          <span>السعر إلى (فارغ = سعر ثابت)</span>
          <input type="text" inputMode="decimal" name="priceMax" defaultValue={s?.priceMax ?? ""} />
        </label>
        <label>
          <span>المدة الافتراضية بالدقائق *</span>
          <input type="number" name="defaultMinutes" min={5} max={720} required defaultValue={s?.defaultMinutes ?? 30} />
        </label>
      </div>

      <fieldset style={{ border: "1px dashed var(--border-2)", borderRadius: "var(--r-sm)", padding: "12px 14px", marginBottom: 16 }}>
        <legend className="hint" style={{ padding: "0 6px" }}>
          وقت انتظار داخل الخدمة — اختياري
        </legend>
        <p className="hint" style={{ marginTop: 0 }}>
          مثل مادة تحتاج وقتاً لتثبت، أو تخدير يسري، أو طلاء يجف. مقدّم الخدمة حرّ خلاله،
          فيُقبل موعد قصير آخر يقع بكامله فيه. اتركه صفراً إن لم يوجد.
        </p>
        <div className="grid2">
          <label>
            <span>يبدأ بعد (دقيقة من بداية الخدمة)</span>
            <input type="number" name="processingAfterMinutes" min={0} max={720} defaultValue={s?.processingAfterMinutes ?? 0} />
          </label>
          <label>
            <span>مدة الانتظار (دقيقة)</span>
            <input type="number" name="processingMinutes" min={0} max={720} defaultValue={s?.processingMinutes ?? 0} />
          </label>
        </div>
      </fieldset>

      <div className="grid2">
        <label>
          <span>تذكير العودة بعد (يوم) — فارغ = بلا تذكير</span>
          <input type="number" name="rebookAfterDays" min={1} max={730} defaultValue={s?.rebookAfterDays ?? ""} />
        </label>
        <label>
          <span>الترتيب</span>
          <input type="number" name="sortOrder" defaultValue={s?.sortOrder ?? 0} />
        </label>
      </div>

      <div className="checkline">
        <input type="checkbox" name="active" id={`sv-${key}`} defaultChecked={s?.active ?? true} />
        <label htmlFor={`sv-${key}`} style={{ margin: 0, color: "var(--text)" }}>
          متاحة للحجز
        </label>
      </div>
      <SubmitButton>{s ? "حفظ التعديلات" : "إضافة الخدمة"}</SubmitButton>
    </form>
  );
}

export default async function ServicesView({ tenantId, slug, base }: ViewProps) {
  const back = `${base}/services`;
  const [t, services, staff] = await Promise.all([
    loadApptTenant(tenantId),
    listServices(tenantId, { includeInactive: true }),
    listStaff(tenantId, { includeInactive: true }),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <>
      <details className="card" open={services.length === 0}>
        <summary>إضافة خدمة</summary>
        <div style={{ marginTop: 16 }}>
          <ServiceForm slug={slug} back={back} />
        </div>
      </details>

      <h2>الخدمات ({services.length})</h2>
      {services.length === 0 && <div className="card">لا خدمات بعد — أضف أول خدمة من الأعلى.</div>}

      {services.map((s) => (
        <details className="card" key={s.id}>
          <summary>
            {s.name} <span className="pill">{priceRange(s.priceMin, s.priceMax, t.currency)}</span>{" "}
            <span className="pill">{minutesLabel(s.defaultMinutes)}</span>
            {s.processingMinutes > 0 && <span className="pill">انتظار {minutesLabel(s.processingMinutes)}</span>}
            {!s.active && <span className="pill warn">موقوفة</span>}
          </summary>
          <div style={{ marginTop: 16 }}>
            <p className="hint">
              يقدّمها: {s.staffIds.length ? s.staffIds.map((id) => staffName.get(id) ?? "—").join("، ") : "لا أحد بعد — اربطها من «الفريق»"}
            </p>
            <ServiceForm slug={slug} back={back} s={s} />
          </div>
        </details>
      ))}
    </>
  );
}
