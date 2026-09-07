import { requireOwnTenant } from "@/lib/session";
import { PLAN_LIST, planOf, SUBSCRIPTION_LABEL } from "@/lib/plans";
import { requestPlan } from "@/app/(billing)/actions";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("ar-JO", { dateStyle: "long" }).format(d) : "—";

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string }>;
}) {
  const sp = await searchParams;
  const { tenant } = await requireOwnTenant();

  const current = planOf(tenant.plan);
  const requested = planOf(tenant.requestedPlan);
  const st = SUBSCRIPTION_LABEL[tenant.subscription] ?? SUBSCRIPTION_LABEL.NONE;

  return (
    <>
      <h1>الاشتراك</h1>
      <p className="sub">اختر الباقة المناسبة لحجم متجرك — وغيّرها متى شئت.</p>

      {sp.requested && (
        <div className="alert ok">
          <strong>وصلنا طلبك ✅</strong> سنتواصل معك لتأكيد الدفع، ثم يبدأ وكيلك بالرد على
          قنواتك مباشرة. تقدر تكمّل تجهيز كتالوجك الآن.
        </div>
      )}

      {/* ── الحالة الحالية ── */}
      <div className="card">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>
              {current ? `باقة ${current.name}` : "لا يوجد اشتراك بعد"}
            </h3>
            {current && (
              <p className="hint" style={{ margin: "4px 0 0" }}>
                {current.monthlyPrice} دينار شهرياً · تنتهي في {fmtDate(tenant.expiresAt)}
              </p>
            )}
          </div>
          <span className={`pill ${st.cls}`}>{st.label}</span>
        </div>

        {requested && tenant.subscription === "REQUESTED" && (
          <div className="alert warn" style={{ margin: "14px 0 0" }}>
            طلبك على <strong>باقة {requested.name}</strong> قيد المراجعة — بانتظار تأكيد
            الدفع.
          </div>
        )}

        {tenant.subscription !== "ACTIVE" && (
          <p className="hint" style={{ margin: "12px 0 0" }}>
            💡 وكيلك لن يرد على القنوات حتى يُفعّل الاشتراك — لكن تقدر تجرّبه الآن من
            تبويب «تجربة الوكيل» بلا حدود.
          </p>
        )}
      </div>

      {/* ── الباقات ── */}
      <h2>الباقات</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {PLAN_LIST.map((p) => {
          const isCurrent = tenant.plan === p.tier && tenant.subscription === "ACTIVE";
          const isRequested = tenant.requestedPlan === p.tier;

          return (
            <div
              className="card"
              key={p.tier}
              style={{
                margin: 0,
                display: "flex",
                flexDirection: "column",
                borderColor: p.highlight ? "var(--accent)" : undefined,
                borderWidth: p.highlight ? 2 : 1,
              }}
            >
              <div className="row" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                {p.highlight && <span className="pill ok">الأكثر اختياراً</span>}
                {isCurrent && <span className="pill ok">باقتك</span>}
              </div>

              <p className="hint" style={{ margin: "0 0 12px" }}>
                {p.tagline}
              </p>

              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {p.monthlyPrice}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 14 }}> دينار / شهر</span>
              </div>

              <ul
                style={{
                  margin: "0 0 18px",
                  padding: 0,
                  listStyle: "none",
                  fontSize: 13.5,
                  lineHeight: 2,
                  flex: 1,
                }}
              >
                {p.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: "var(--accent)", flex: "none" }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <form action={requestPlan}>
                <input type="hidden" name="plan" value={p.tier} />
                <button
                  type="submit"
                  className={p.highlight && !isCurrent ? "block" : "block ghost"}
                  disabled={isCurrent}
                >
                  {isCurrent
                    ? "باقتك الحالية"
                    : isRequested
                      ? "طلبك قيد المراجعة — أعد الإرسال"
                      : tenant.plan
                        ? "غيّر لهذي الباقة"
                        : "اختر هذي الباقة"}
                </button>
              </form>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>كيف يتم التفعيل؟</h3>
        <p className="hint" style={{ margin: 0, lineHeight: 2 }}>
          ١) تختار الباقة من هنا · ٢) نتواصل معك لتأكيد الدفع · ٣) نربط قنواتك (واتساب
          وماسنجر وانستقرام) · ٤) يبدأ وكيلك بالرد على عملائك.
          <br />
          الاشتراك شهري ويمكن إيقافه في أي وقت.
        </p>
      </div>
    </>
  );
}
