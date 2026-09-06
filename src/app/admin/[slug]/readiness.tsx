import { prisma } from "@/lib/db";

/**
 * قائمة جاهزية الإطلاق لعميل واحد.
 * تجيب على سؤال واحد: هل يصلح تشغيل هذا العميل على الواتساب اليوم؟
 */

type Check = { label: string; ok: boolean; hint: string; critical: boolean };

export default async function Readiness({ slug }: { slug: string }) {
  const t = await prisma.tenant.findUnique({
    where: { slug },
    include: {
      profile: true,
      _count: { select: { products: true, faqs: true } },
      channels: true,
    },
  });
  if (!t) return null;

  const p = t.profile;
  const liveChannels = t.channels.filter((c) => c.active && c.accessTokenEnc);

  const checks: Check[] = [
    {
      label: "معلومات المتجر الأساسية",
      ok: !!(p?.address && p?.workingHours),
      hint: "العنوان وأوقات الدوام — أكثر سؤالين يتكرران على الواتساب",
      critical: true,
    },
    {
      label: "سياسات البيع",
      ok: !!(p?.deliveryPolicy || p?.returnPolicy || p?.paymentMethods),
      hint: "التوصيل أو الاسترجاع أو طرق الدفع — بدونها يحوّل الوكيل كثيراً",
      critical: false,
    },
    {
      label: "الكتالوج",
      ok: t._count.products > 0,
      hint: "بدون منتجات لا يستطيع الوكيل الإجابة عن أي سؤال سعر أو توفر",
      critical: true,
    },
    {
      label: "أسئلة شائعة (٣ على الأقل)",
      ok: t._count.faqs >= 3,
      hint: "تقلّل التحويلات للموظف بشكل كبير",
      critical: false,
    },
    {
      label: "تعليمات خاصة بالبزنس",
      ok: !!t.customPolicy?.trim(),
      hint: "قواعد التسعير والخصومات الخاصة بهذا المحل",
      critical: false,
    },
    {
      label: "كلمات التحويل لموظف",
      ok: t.handoffKeywords.length > 0,
      hint: "مثل: شكوى، مدير — تحويل فوري قبل صرف أي توكن",
      critical: false,
    },
    {
      label: "قناة مربوطة وجاهزة",
      ok: liveChannels.length > 0,
      hint: "قناة مفعّلة مع Access Token — بدونها يعمل الوكيل في صفحة التجربة فقط",
      critical: true,
    },
    {
      label: "عنوان عام للويبهوك",
      ok: !!process.env.APP_BASE_URL && !process.env.APP_BASE_URL.includes("localhost"),
      hint: "Meta لا تصل إلى localhost — تحتاج دومين منشور أو نفق ngrok",
      critical: true,
    },
    {
      label: "الاشتراك نشط",
      ok: t.status === "ACTIVE",
      hint: "الحالة PAUSED تعني أن الوكيل لن يرد على أي رسالة",
      critical: true,
    },
  ];

  const done = checks.filter((c) => c.ok).length;
  const blockers = checks.filter((c) => c.critical && !c.ok);

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>جاهزية الإطلاق</h3>
        <span className={`pill ${blockers.length === 0 ? "ok" : "warn"}`}>
          {done} / {checks.length}
          {blockers.length > 0 && ` · ${blockers.length} مانع`}
        </span>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        {blockers.length === 0
          ? "✅ هذا العميل جاهز للتشغيل على الواتساب."
          : "العناصر المعلّمة بـ (ضروري) تمنع التشغيل الحقيقي."}
      </p>

      <div style={{ marginTop: 12 }}>
        {checks.map((c) => (
          <div key={c.label} style={{ marginBottom: 10, fontSize: 14 }}>
            <span style={{ color: c.ok ? "var(--accent)" : "var(--muted)" }}>
              {c.ok ? "✓" : "○"}
            </span>{" "}
            {c.label}
            {c.critical && !c.ok && <span className="pill warn"> ضروري</span>}
            {!c.ok && <div className="hint" style={{ margin: "2px 20px 0" }}>{c.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
