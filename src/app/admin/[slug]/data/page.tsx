import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteDataSource, saveDataSource } from "../../actions";

export const dynamic = "force-dynamic";

type Source = Awaited<ReturnType<typeof prisma.dataSource.findMany>>[number];

function ageLabel(valueAt: Date | null, staleAfter: number) {
  if (!valueAt) return { text: "لا توجد قيمة", stale: true };
  const min = (Date.now() - valueAt.getTime()) / 60000;
  const stale = min > staleAfter;
  const h = Math.floor(min / 60);
  const text = min < 60 ? `منذ ${Math.round(min)} دقيقة` : `منذ ${h} ساعة`;
  return { text, stale };
}

function SourceForm({ slug, src }: { slug: string; src?: Source }) {
  return (
    <form action={saveDataSource}>
      <input type="hidden" name="slug" value={slug} />
      {src && <input type="hidden" name="id" value={src.id} />}

      <div className="grid2">
        <label>
          <span>المفتاح (بالإنجليزي — يستخدمه الوكيل) *</span>
          <input
            type="text"
            name="key"
            required
            defaultValue={src?.key ?? ""}
            placeholder="gold_price"
          />
        </label>
        <label>
          <span>الوصف بالعربية (يقرأه الوكيل) *</span>
          <input
            type="text"
            name="label"
            required
            defaultValue={src?.label ?? ""}
            placeholder="سعر جرام الذهب اليوم حسب العيار"
          />
        </label>
      </div>

      <div className="grid2">
        <label>
          <span>نوع المصدر</span>
          <select name="kind" defaultValue={src?.kind ?? "MANUAL"}>
            <option value="MANUAL">يدوي — تحدّثه أنت من هنا</option>
            <option value="HTTP_JSON">تلقائي — يُجلب من رابط API</option>
          </select>
        </label>
        <label>
          <span>تعتبر القيمة قديمة بعد (بالدقائق)</span>
          <input
            type="number"
            name="staleAfterMinutes"
            defaultValue={src?.staleAfterMinutes ?? 720}
          />
        </label>
      </div>

      <label>
        <span>القيمة (JSON)</span>
        <textarea
          className="code"
          name="value"
          defaultValue={src?.value ? JSON.stringify(src.value, null, 2) : ""}
          placeholder={'{\n  "karat_24": 62.5,\n  "karat_21": 54.7,\n  "karat_18": 46.9\n}'}
          style={{ minHeight: 100 }}
        />
      </label>
      <p className="hint">كل حفظ للقيمة يجدّد وقت التحديث تلقائياً.</p>

      <label>
        <span>إعدادات الجلب التلقائي (JSON) — فقط لنوع HTTP_JSON</span>
        <textarea
          className="code"
          name="config"
          defaultValue={src?.config ? JSON.stringify(src.config) : ""}
          placeholder={'{"url": "https://api.example.com/gold", "headers": {}}'}
        />
      </label>

      <div className="checkline">
        <input
          type="checkbox"
          name="active"
          id={`d-${src?.id ?? "new"}`}
          defaultChecked={src?.active ?? true}
        />
        <label htmlFor={`d-${src?.id ?? "new"}`} style={{ margin: 0, color: "var(--text)" }}>
          مفعّل
        </label>
      </div>

      <button type="submit">{src ? "حفظ وتحديث الوقت" : "إضافة المصدر"}</button>
    </form>
  );
}

export default async function DataPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const sources = await prisma.dataSource.findMany({ where: { tenantId: tenant.id } });

  return (
    <>
      <div className="card">
        <h3>لماذا هذه الصفحة مهمة؟</h3>
        <p className="hint" style={{ margin: 0 }}>
          الأرقام المتغيّرة يومياً (كسعر الذهب) لا تُكتب في تعليمات الوكيل أبداً — تُخزّن هنا
          ويجلبها بأداة <code>get_live_data</code>. وإذا مرّ على القيمة أكثر من المدة
          المحدّدة، <strong>يُمنع الوكيل من ذكر الرقم</strong> ويحوّل لموظف — هذا ما يمنع
          تسعيرة خاطئة تكلّف صاحب المحل مالاً حقيقياً.
        </p>
      </div>

      <details className="card">
        <summary>إضافة مصدر بيانات</summary>
        <div style={{ marginTop: 16 }}>
          <SourceForm slug={slug} />
        </div>
      </details>

      <h2>المصادر ({sources.length})</h2>

      {sources.length === 0 && (
        <div className="card">لا يوجد مصادر. مناسب للمتاجر ذات الأسعار الثابتة.</div>
      )}

      {sources.map((d) => {
        const age = ageLabel(d.valueAt, d.staleAfterMinutes);
        return (
          <details className="card" key={d.id}>
            <summary>
              <code>{d.key}</code> — {d.label}{" "}
              <span className={`pill ${age.stale ? "warn" : "ok"}`}>
                {age.stale ? `قديمة (${age.text})` : `محدّثة ${age.text}`}
              </span>
            </summary>
            <div style={{ marginTop: 16 }}>
              <SourceForm slug={slug} src={d} />
              <form action={deleteDataSource} style={{ marginTop: 8 }}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" className="danger">
                  حذف
                </button>
              </form>
            </div>
          </details>
        );
      })}
    </>
  );
}
