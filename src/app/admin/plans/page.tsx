import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { ALL_CHANNELS, MODELS, SUBSCRIPTION_LABEL } from "@/lib/plans";
import { deletePlan, savePlan, syncPlanToTenants } from "@/app/(billing)/plan-actions";
import { Reveal, Counter } from "@/components/motion";
import { SubmitButton } from "@/components/pending";

export const dynamic = "force-dynamic";

type PlanRow = Awaited<ReturnType<typeof prisma.plan.findMany>>[number];

function PlanForm({ plan }: { plan?: PlanRow }) {
  const id = plan?.id ?? "new";

  return (
    <form action={savePlan}>
      {plan ? (
        <input type="hidden" name="id" value={plan.id} />
      ) : (
        <label>
          <span>المعرّف الثابت * (إنجليزي كبير — لا يتغيّر بعد الإنشاء)</span>
          <input
            type="text"
            name="tier"
            required
            dir="ltr"
            pattern="[A-Z0-9_]{2,20}"
            placeholder="STARTER"
          />
        </label>
      )}

      <div className="grid3">
        <label>
          <span>اسم الباقة *</span>
          <input type="text" name="name" required defaultValue={plan?.name ?? ""} />
        </label>
        <label>
          <span>السعر الشهري (دينار)</span>
          <input
            type="number"
            name="monthlyPrice"
            step="0.5"
            min={0}
            defaultValue={plan ? Number(plan.monthlyPrice) : 0}
          />
        </label>
        <label>
          <span>الترتيب في العرض</span>
          <input type="number" name="sortOrder" defaultValue={plan?.sortOrder ?? 0} />
        </label>
      </div>

      <label>
        <span>الجملة التسويقية</span>
        <input
          type="text"
          name="tagline"
          defaultValue={plan?.tagline ?? ""}
          placeholder="لمحل واحد يبدأ على الواتساب"
        />
      </label>

      <label>
        <span>القنوات المسموحة</span>
      </label>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {ALL_CHANNELS.map((c) => (
          <div className="checkline" key={c.value} style={{ margin: 0 }}>
            <input
              type="checkbox"
              name="channels"
              value={c.value}
              id={`ch-${id}-${c.value}`}
              defaultChecked={plan ? plan.channels.includes(c.value) : c.value === "WEB"}
            />
            <label htmlFor={`ch-${id}-${c.value}`} style={{ margin: 0, color: "var(--text)" }}>
              {c.label}
            </label>
          </div>
        ))}
      </div>

      <div className="grid2">
        <label>
          <span>سقف الردود اليومي</span>
          <input
            type="number"
            name="maxRepliesPerDay"
            min={1}
            defaultValue={plan?.maxRepliesPerDay ?? 200}
          />
        </label>
        <label>
          <span>الحد الأقصى للمنتجات</span>
          <input
            type="number"
            name="maxProducts"
            min={1}
            defaultValue={plan?.maxProducts ?? 500}
          />
        </label>
        <label>
          <span>سقف الردود في الدقيقة</span>
          <input
            type="number"
            name="maxRepliesPerMinute"
            min={1}
            defaultValue={plan?.maxRepliesPerMinute ?? 20}
          />
        </label>
      </div>

      <div className="grid2">
        <label>
          <span>النموذج المستخدم</span>
          <select name="modelId" defaultValue={plan?.modelId ?? "claude-sonnet-5-5"}>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>مستوى الجهد</span>
          <select name="effort" defaultValue={plan?.effort ?? "low"}>
            <option value="low">منخفض — الأسرع والأوفر</option>
            <option value="medium">متوسط</option>
            <option value="high">مرتفع</option>
          </select>
        </label>
      </div>

      <label>
        <span>المزايا — ميزة في كل سطر (تظهر للعميل)</span>
        <textarea
          name="features"
          rows={6}
          defaultValue={plan?.features.join("\n") ?? ""}
          placeholder={"قناة واتساب\n١٠٠ رد يومياً\nتحويل تلقائي لموظف"}
        />
      </label>

      <div className="checkline">
        <input
          type="checkbox"
          name="highlight"
          id={`hl-${id}`}
          defaultChecked={plan?.highlight ?? false}
        />
        <label htmlFor={`hl-${id}`} style={{ margin: 0, color: "var(--text)" }}>
          إبرازها كـ «الأكثر اختياراً»
        </label>
      </div>

      <div className="checkline">
        <input
          type="checkbox"
          name="active"
          id={`ac-${id}`}
          defaultChecked={plan?.active ?? true}
        />
        <label htmlFor={`ac-${id}`} style={{ margin: 0, color: "var(--text)" }}>
          معروضة للعملاء
        </label>
      </div>

      <SubmitButton>{plan ? "حفظ التعديلات" : "إنشاء الباقة"}</SubmitButton>
    </form>
  );
}

type Subscriber = {
  name: string;
  slug: string;
  subscription: string;
  monthlyPrice: unknown;
  expiresAt: Date | null;
  users: { email: string }[];
};

/**
 * مشتركو الباقة بالاسم.
 *
 * العدد وحده لا يكفي لاتخاذ قرار: رفع سعر أو تشديد حد يمسّ متاجر بعينها،
 * ومالك المنصة يحتاج أن يعرف أيّها قبل الضغط على «طبّق الحدود».
 */
function SubscriberList({ rows }: { rows: Subscriber[] }) {
  if (rows.length === 0) {
    return (
      <p className="hint" style={{ margin: "12px 0 0" }}>
        لا يوجد متاجر على هذه الباقة بعد.
      </p>
    );
  }

  const day = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("ar-JO", { dateStyle: "medium" }).format(d) : null;

  return (
    <div style={{ margin: "14px 0 4px" }}>
      <div className="hint" style={{ marginBottom: 8 }}>
        المشتركون ({rows.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((s) => {
          const st = SUBSCRIPTION_LABEL[s.subscription] ?? SUBSCRIPTION_LABEL.NONE;
          const ends = day(s.expiresAt);
          return (
            <div
              key={s.slug}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: 10,
              }}
            >
              <Link href={`/admin/${s.slug}`} style={{ fontWeight: 600, fontSize: 14 }}>
                {s.name}
              </Link>
              <span className={`pill ${st.cls}`}>{st.label}</span>
              {s.monthlyPrice != null && (
                <span className="pill">{Number(s.monthlyPrice)} د</span>
              )}
              <span className="hint" style={{ margin: 0, fontSize: 12.5 }}>
                {s.users[0]?.email ?? "بلا حساب مرتبط"}
                {ends && ` · حتى ${ends}`}
              </span>
              <Link
                className="btn ghost"
                href={`/admin/${s.slug}/billing`}
                style={{ marginInlineStart: "auto", padding: "4px 10px", fontSize: 12.5 }}
              >
                الاشتراك
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function PlansPage() {
  await requireAdmin();

  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { monthlyPrice: "asc" }],
  });

  // مشتركو كل باقة — الرقم الذي يهم فعلاً
  const grouped = await prisma.tenant.groupBy({
    by: ["plan", "subscription"],
    _count: { _all: true },
    _sum: { monthlyPrice: true },
  });

  // ومَن هم. الرقم يقول «اثنان»، وهذا يقول أيّ اثنين — وهو ما يُتصرَّف بناءً عليه
  // عند رفع سعر أو تعديل حدود.
  const subscribers = await prisma.tenant.findMany({
    where: { plan: { not: null } },
    orderBy: [{ subscription: "asc" }, { name: "asc" }],
    select: {
      name: true,
      slug: true,
      plan: true,
      subscription: true,
      monthlyPrice: true,
      expiresAt: true,
      users: { select: { email: true }, take: 1 },
    },
  });

  const statsOf = (tier: string) => {
    const rows = grouped.filter((g) => g.plan === tier);
    const active = rows.find((r) => r.subscription === "ACTIVE");
    return {
      active: active?._count._all ?? 0,
      revenue: Number(active?._sum.monthlyPrice ?? 0),
      others: rows
        .filter((r) => r.subscription !== "ACTIVE")
        .reduce((s, r) => s + r._count._all, 0),
    };
  };

  const totalRevenue = plans.reduce((s, p) => s + statsOf(p.tier).revenue, 0);
  const totalSubs = plans.reduce((s, p) => s + statsOf(p.tier).active, 0);

  return (
    <main className="wide">
      <div className="row" style={{ marginBottom: 10 }}>
        <Link href="/admin" style={{ color: "var(--text-3)", fontSize: 13.5 }}>
          ← لوحة المنصة
        </Link>
      </div>

      <h1>الباقات</h1>
      <p className="sub">
        عدّل الأسعار والحدود من هنا — التغيير فوري ويظهر للعملاء مباشرة.
      </p>

      <Reveal>
        <div className="stats">
          <div className="stat">
            <div className="stat-value"><Counter value={plans.length} /></div>
            <div className="stat-label">باقة</div>
          </div>
          <div className="stat">
            <div className="stat-value"><Counter value={totalSubs} /></div>
            <div className="stat-label">مشترك نشط</div>
          </div>
          <div className="stat">
            <div className="stat-value live"><Counter value={totalRevenue} /></div>
            <div className="stat-label">دينار / شهر</div>
          </div>
        </div>
      </Reveal>

      <details className="card">
        <summary>إضافة باقة جديدة</summary>
        <div style={{ marginTop: 18 }}>
          <PlanForm />
        </div>
      </details>

      {plans.length === 0 && (
        <div className="card empty">
          <div className="empty-icon">💳</div>
          لا يوجد باقات بعد — أنشئ أول باقة من الأعلى.
        </div>
      )}

      {plans.map((p) => {
        const st = statsOf(p.tier);
        return (
          <details className="card" key={p.id}>
            <summary>
              <strong>{p.name}</strong>
              <code>{p.tier}</code>
              <span className="pill">{Number(p.monthlyPrice)} د/شهر</span>
              <span className={`pill ${st.active > 0 ? "ok" : ""}`}>
                {st.active} مشترك
              </span>
              {st.revenue > 0 && (
                <span className="pill ok">{st.revenue} د/شهر</span>
              )}
              {p.highlight && <span className="pill ok">مُبرزة</span>}
              {!p.active && <span className="pill warn">مخفية</span>}
            </summary>

            <div style={{ marginTop: 18 }}>
              <div className="hint">
                {p.channels.length} قناة · {p.maxRepliesPerDay} رد/يوم · {p.maxRepliesPerMinute} رد/دقيقة · {p.maxProducts} منتج
                · {p.modelId}
                {st.others > 0 && ` · ${st.others} غير نشط`}
              </div>

              <SubscriberList rows={subscribers.filter((s) => s.plan === p.tier)} />

              <PlanForm plan={p} />

              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 18,
                  paddingTop: 16,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <form action={syncPlanToTenants}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="ghost">
                    طبّق الحدود على {st.active} متجر
                  </SubmitButton>
                </form>

                <form action={deletePlan}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="danger">
                    حذف الباقة
                  </SubmitButton>
                </form>
              </div>
              <p className="hint" style={{ margin: "10px 0 0" }}>
                تعديل الحدود لا يغيّر المتاجر المشتركة تلقائياً — اضغط «طبّق الحدود»
                لتحديثها، أو اتركها على حدودها القديمة حتى التجديد.
              </p>
            </div>
          </details>
        );
      })}
    </main>
  );
}
