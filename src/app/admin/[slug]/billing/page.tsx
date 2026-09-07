import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PLAN_LIST, planOf, SUBSCRIPTION_LABEL } from "@/lib/plans";
import {
  activateSubscription,
  extendSubscription,
  suspendSubscription,
} from "@/app/(billing)/actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("ar-JO", { dateStyle: "medium" }).format(d) : "—";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await prisma.tenant.findUnique({ where: { slug } });
  if (!t) notFound();

  const current = planOf(t.plan);
  const requested = planOf(t.requestedPlan);
  const st = SUBSCRIPTION_LABEL[t.subscription] ?? SUBSCRIPTION_LABEL.NONE;

  const daysLeft = t.expiresAt
    ? Math.ceil((t.expiresAt.getTime() - Date.now()) / 86400_000)
    : null;

  return (
    <>
      {/* ── طلب معلّق ── */}
      {requested && (
        <div className="alert warn">
          <strong>طلب اشتراك جديد: باقة {requested.name}</strong> ({requested.monthlyPrice}{" "}
          دينار/شهر) — طُلب في {fmt(t.requestedAt)}. فعّله بعد تأكيد الدفع.
        </div>
      )}

      {/* ── الحالة ── */}
      <div className="card">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>
              {current ? `باقة ${current.name}` : "بلا اشتراك"}
            </h3>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              {t.monthlyPrice ? `${Number(t.monthlyPrice)} دينار شهرياً · ` : ""}
              مفعّل من {fmt(t.activatedAt)} · ينتهي {fmt(t.expiresAt)}
              {daysLeft !== null &&
                (daysLeft > 0 ? ` (${daysLeft} يوم متبقٍ)` : " — منتهٍ")}
            </p>
          </div>
          <span className={`pill ${st.cls}`}>{st.label}</span>
        </div>

        {t.billingNote && (
          <p className="hint" style={{ margin: "12px 0 0" }}>
            ملاحظة: {t.billingNote}
          </p>
        )}
      </div>

      {/* ── تفعيل / تغيير ── */}
      <div className="card">
        <h3>{t.subscription === "ACTIVE" ? "تغيير الاشتراك" : "تفعيل الاشتراك"}</h3>
        <p className="hint">
          التفعيل يضبط حدود الباقة على المتجر فعلياً (سقف الردود، النموذج، القنوات
          المسموحة) ويشغّل الوكيل على قنواته.
        </p>

        <form action={activateSubscription}>
          <input type="hidden" name="slug" value={slug} />

          <div className="grid3">
            <label>
              <span>الباقة</span>
              <select name="plan" defaultValue={t.requestedPlan ?? t.plan ?? "GROWTH"}>
                {PLAN_LIST.map((p) => (
                  <option key={p.tier} value={p.tier}>
                    {p.name} — {p.monthlyPrice} د · {p.maxRepliesPerDay} رد/يوم
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>السعر الشهري (تجاوز اختياري)</span>
              <input
                type="number"
                name="monthlyPrice"
                step="0.5"
                placeholder="سعر الباقة الافتراضي"
                defaultValue={t.monthlyPrice ? Number(t.monthlyPrice) : ""}
              />
            </label>
            <label>
              <span>المدة (أشهر)</span>
              <input type="number" name="months" min={1} defaultValue={1} />
            </label>
          </div>

          <label>
            <span>ملاحظة داخلية (لا يراها العميل)</span>
            <input
              type="text"
              name="billingNote"
              defaultValue={t.billingNote ?? ""}
              placeholder="دفع كاش · تحويل كليك · فاتورة رقم ..."
            />
          </label>

          <button type="submit">
            {t.subscription === "ACTIVE" ? "حفظ التغييرات" : "فعّل الاشتراك"}
          </button>
        </form>
      </div>

      {/* ── إجراءات سريعة ── */}
      {t.subscription === "ACTIVE" && (
        <div className="card">
          <h3>إجراءات</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <form action={extendSubscription} style={{ display: "flex", gap: 8 }}>
              <input type="hidden" name="slug" value={slug} />
              <input
                type="number"
                name="months"
                min={1}
                defaultValue={1}
                style={{ width: 80 }}
              />
              <button type="submit" className="ghost">
                تمديد (أشهر)
              </button>
            </form>

            <form action={suspendSubscription}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="danger">
                إيقاف الاشتراك
              </button>
            </form>
          </div>
          <p className="hint" style={{ margin: "12px 0 0" }}>
            الإيقاف يُصمت الوكيل فوراً على كل القنوات — بلا حذف أي بيانات.
          </p>
        </div>
      )}
    </>
  );
}
