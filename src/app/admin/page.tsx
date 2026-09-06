import Link from "next/link";
import { prisma } from "@/lib/db";
import { createTenant } from "./actions";
import { BUSINESS_TYPES } from "./types";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { products: true, conversations: true, leads: true, channels: true } },
    },
  });

  return (
    <main className="wide">
      <h1>لوحة التحكم</h1>
      <p className="sub">أضف متجرك، عبّي بياناته، وجرّب وكيله — كل شي من هون.</p>

      <details className="card">
        <summary>إضافة متجر جديد</summary>
        <form action={createTenant} style={{ marginTop: 16 }}>
          <div className="grid2">
            <label>
              <span>اسم المتجر *</span>
              <input type="text" name="name" required placeholder="مثال: مجوهرات بشار" />
            </label>
            <label>
              <span>المعرّف (بالإنجليزي، يستخدم في الروابط) *</span>
              <input
                type="text"
                name="slug"
                required
                pattern="[a-z0-9\-]{2,40}"
                placeholder="gold-bashar"
              />
            </label>
          </div>

          <div className="grid3">
            <label>
              <span>نوع النشاط</span>
              <select name="businessType" defaultValue="gold">
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>اسم الوكيل (كيف يعرّف عن نفسه)</span>
              <input type="text" name="agentName" placeholder="سند" />
            </label>
            <label>
              <span>العملة</span>
              <input type="text" name="currency" defaultValue="JOD" />
            </label>
          </div>

          <label>
            <span>نبذة عن المتجر</span>
            <textarea name="about" placeholder="محل ذهب ومجوهرات، بيع وشراء، عيار 18 و21 و24." />
          </label>

          <div className="grid3">
            <label>
              <span>العنوان</span>
              <input type="text" name="address" placeholder="عمّان — شارع الوكالات" />
            </label>
            <label>
              <span>الهاتف</span>
              <input type="text" name="phone" placeholder="+962 7 ..." />
            </label>
            <label>
              <span>أوقات الدوام</span>
              <input type="text" name="workingHours" placeholder="السبت–الخميس ١٠ص–٩م" />
            </label>
          </div>

          <button type="submit">إنشاء المتجر</button>
        </form>
      </details>

      <h2>المتاجر ({tenants.length})</h2>

      {tenants.length === 0 && <div className="card">لا يوجد متاجر بعد.</div>}

      {tenants.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <div>
              <strong>{t.name}</strong>{" "}
              <span className="pill">
                {BUSINESS_TYPES.find((b) => b.value === t.businessType)?.label ?? t.businessType}
              </span>{" "}
              <span className={`pill ${t.status === "ACTIVE" ? "ok" : "warn"}`}>
                {t.status === "ACTIVE" ? "نشط" : t.status === "PAUSED" ? "متوقف" : "معلّق"}
              </span>
              <div className="sub" style={{ margin: "6px 0 0" }}>
                {t._count.products} منتج · {t._count.channels} قناة ·{" "}
                {t._count.conversations} محادثة · {t._count.leads} عميل محتمل
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link className="btn" href={`/admin/${t.slug}`}>
                إدارة
              </Link>
              <Link className="btn" href={`/playground/${t.slug}`}>
                تجربة
              </Link>
            </div>
          </div>
        </div>
      ))}
    </main>
  );
}
