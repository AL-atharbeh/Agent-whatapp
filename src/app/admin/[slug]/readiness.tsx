import { prisma } from "@/lib/db";
import { loadTenantBySlug } from "@/lib/tenancy";
import { buildSystemPrompt } from "@/lib/agent/prompt";

/**
 * قائمة جاهزية الإطلاق لعميل واحد.
 * تجيب على سؤال واحد: هل يصلح تشغيل هذا العميل على الواتساب اليوم؟
 */

type Check = {
  label: string;
  ok: boolean;
  hint: string;
  critical: boolean;
  /** قيمة تُعرَض حتى عند النجاح — للبنود التي الرقم فيها هو الفائدة. */
  note?: string;
};

/**
 * سقف تعليمات الوكيل قبل التحذير.
 *
 * كل ما يُكتَب في «نبذة» و«الأسئلة الشائعة» و«التعليمات الخاصة» يُرسَل إلى
 * النموذج **مع كل رسالة**، لا مرة واحدة. ولصق صفحة تعريفية كاملة في «نبذة»
 * يبدو بلا ثمن، لكنه يضاعف حمولة كل رد: تُستنفد حصّة الدقيقة عند المزوّد
 * فيبدأ التأخير، وترتفع الكلفة بنفس النسبة — وكلاهما بلا سبب ظاهر لصاحب
 * المتجر، لأن لا شيء في اللوحة كان يربط ما كتبه بما يدفعه وينتظره.
 */
const PROMPT_WARN_TOKENS = 3000;

export default async function Readiness({
  slug,
  hideChannels = false,
}: {
  slug: string;
  /** بوابة العميل تخفي بنود القنوات — إعدادها مسؤولية مالك المنصة. */
  hideChannels?: boolean;
}) {
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

  // تقدير تقريبي: العربية ~٣ حروف للتوكن. الدقة هنا غير مهمة — المهم أن
  // يرى صاحب المتجر الرقم يكبر حين يلصق نصاً طويلاً.
  const ctx = await loadTenantBySlug(slug);
  const promptTokens = ctx ? Math.round(buildSystemPrompt(ctx).length / 3) : 0;

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
      label: "حجم تعليمات الوكيل",
      ok: promptTokens <= PROMPT_WARN_TOKENS,
      note: `${promptTokens.toLocaleString("ar-JO")} توكن مع كل رسالة`,
      hint:
        `ما تكتبه في «نبذة» و«الأسئلة الشائعة» و«التعليمات الخاصة» يُرسَل للنموذج ` +
        `في كل رسالة لا مرة واحدة. تجاوز ${PROMPT_WARN_TOKENS.toLocaleString("ar-JO")} ` +
        `توكن يبطّئ الردود ويرفع الكلفة. اختصر «نبذة» إلى سطرين — التفاصيل مكانها الأسئلة الشائعة.`,
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

  const visible = hideChannels
    ? checks.filter(
        (c) => !c.label.includes("قناة") && !c.label.includes("ويبهوك") && !c.label.includes("الاشتراك"),
      )
    : checks;

  const done = visible.filter((c) => c.ok).length;
  const blockers = visible.filter((c) => c.critical && !c.ok);

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>جاهزية الإطلاق</h3>
        <span className={`pill ${blockers.length === 0 ? "ok" : "warn"}`}>
          {done} / {visible.length}
          {blockers.length > 0 && ` · ${blockers.length} مانع`}
        </span>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        {blockers.length === 0
          ? "✅ هذا العميل جاهز للتشغيل على الواتساب."
          : "العناصر المعلّمة بـ (ضروري) تمنع التشغيل الحقيقي."}
      </p>

      <div style={{ marginTop: 14 }}>
        {visible.map((c) => (
          <div className="check-item" key={c.label}>
            <span
              className="check-mark"
              style={{ color: c.ok ? "var(--live)" : "var(--text-3)" }}
            >
              {c.ok ? "✓" : "○"}
            </span>
            <div style={{ flex: 1 }}>
              {c.label}
              {c.note && (
                <span
                  className={`pill ${c.ok ? "ok" : "warn"}`}
                  style={{ marginInlineStart: 8 }}
                >
                  {c.note}
                </span>
              )}
              {c.critical && !c.ok && (
                <span className="pill warn" style={{ marginInlineStart: 8 }}>
                  ضروري
                </span>
              )}
              {!c.ok && (
                <div className="hint" style={{ margin: "2px 0 0" }}>
                  {c.hint}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
