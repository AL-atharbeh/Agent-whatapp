import Link from "next/link";
import { prisma } from "@/lib/db";
import { createTenant } from "./actions";
import { BUSINESS_TYPES } from "./types";
import { listPlans, SUBSCRIPTION_LABEL } from "@/lib/plans";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "نشط", cls: "ok" },
  PAUSED: { label: "بانتظار التفعيل", cls: "warn" },
  SUSPENDED: { label: "معلّق", cls: "danger" },
};

export default async function AdminHome() {
  const [tenants, totals] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: { products: true, conversations: true, leads: true, channels: true },
        },
        users: { select: { email: true }, take: 1 },
      },
    }),
    prisma.$transaction([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: "ACTIVE" } }),
      prisma.conversation.count(),
      prisma.lead.count(),
      prisma.message.count({
        where: {
          role: "AGENT",
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]),
  ]);

  const allPlans = await listPlans(true);
  const planByTier = new Map(allPlans.map((p) => [p.tier, p]));
  const [allTenants, active, convos, leads, todayReplies] = totals;
  const pending = tenants.filter((t) => t.requestedPlan);
  const mrr = tenants
    .filter((t) => t.subscription === "ACTIVE")
    .reduce((sum, t) => sum + Number(t.monthlyPrice ?? 0), 0);

  return (
    <main className="wide">
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>لوحة المنصة</h1>
        <Link className="btn ghost" href="/admin/plans">
          إدارة الباقات
        </Link>
      </div>
      <p className="sub">كل المتاجر المشتركة — بياناتها معزولة تماماً عن بعضها.</p>

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{allTenants}</div>
          <div className="stat-label">متجر</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: "var(--accent)" }}>
            {active}
          </div>
          <div className="stat-label">نشط</div>
        </div>
        <div className="stat">
          <div className="stat-value">{convos}</div>
          <div className="stat-label">محادثة</div>
        </div>
        <div className="stat">
          <div className="stat-value">{leads}</div>
          <div className="stat-label">عميل محتمل</div>
        </div>
        <div className="stat">
          <div className="stat-value">{todayReplies}</div>
          <div className="stat-label">رد اليوم</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: "var(--accent)" }}>
            {mrr}
          </div>
          <div className="stat-label">دينار / شهر</div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="alert warn">
          <strong>{pending.length} طلب اشتراك بانتظارك</strong> — راجع كل متجر من تبويب
          «الاشتراك» وفعّله بعد تأكيد الدفع.
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pending.map((t) => (
              <Link className="btn" key={t.id} href={`/admin/${t.slug}/billing`}>
                {t.name} — {planByTier.get(t.requestedPlan ?? '')?.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <details className="card">
        <summary>إضافة متجر يدوياً</summary>
        <form action={createTenant} style={{ marginTop: 18 }}>
          <div className="grid2">
            <label>
              <span>اسم المتجر *</span>
              <input type="text" name="name" required placeholder="مجوهرات الأثري" />
            </label>
            <label>
              <span>المعرّف (إنجليزي، للروابط) *</span>
              <input
                type="text"
                name="slug"
                required
                pattern="[a-z0-9\-]{2,40}"
                dir="ltr"
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
              <span>اسم الوكيل</span>
              <input type="text" name="agentName" placeholder="سند" />
            </label>
            <label>
              <span>العملة</span>
              <input type="text" name="currency" defaultValue="JOD" />
            </label>
          </div>

          <div className="grid3">
            <label>
              <span>العنوان</span>
              <input type="text" name="address" />
            </label>
            <label>
              <span>الهاتف</span>
              <input type="text" name="phone" />
            </label>
            <label>
              <span>أوقات الدوام</span>
              <input type="text" name="workingHours" />
            </label>
          </div>

          <button type="submit">إنشاء المتجر</button>
        </form>
      </details>

      <h2>المتاجر ({tenants.length})</h2>

      {tenants.length === 0 && (
        <div className="card empty">
          <div className="empty-icon">🏪</div>
          لا يوجد متاجر بعد.
        </div>
      )}

      {tenants.map((t) => {
        const st = STATUS[t.status] ?? STATUS.PAUSED;
        return (
          <div className="card" key={t.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  <strong style={{ fontSize: 15 }}>{t.name}</strong>
                  <span className={`pill ${st.cls}`}>{st.label}</span>
                  <span className="pill">
                    {BUSINESS_TYPES.find((b) => b.value === t.businessType)?.label ??
                      t.businessType}
                  </span>
                  {t._count.channels > 0 && (
                    <span className="pill">{t._count.channels} قناة</span>
                  )}
                  {(() => {
                    const sub = SUBSCRIPTION_LABEL[t.subscription];
                    const plan = planByTier.get(t.plan ?? '');
                    if (t.subscription === "ACTIVE" && plan) {
                      return (
                        <span className="pill ok">
                          {plan.name} · {Number(t.monthlyPrice ?? plan.monthlyPrice)} د
                        </span>
                      );
                    }
                    return sub?.cls ? (
                      <span className={`pill ${sub.cls}`}>{sub.label}</span>
                    ) : null;
                  })()}
                </div>
                <div className="hint" style={{ margin: "6px 0 0" }}>
                  {t.users[0]?.email ?? "بلا حساب مرتبط"} · {t._count.products} منتج ·{" "}
                  {t._count.conversations} محادثة · {t._count.leads} عميل محتمل
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link className="btn ghost" href={`/playground/${t.slug}`}>
                  تجربة
                </Link>
                <Link className="btn" href={`/admin/${t.slug}`}>
                  إدارة
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </main>
  );
}
