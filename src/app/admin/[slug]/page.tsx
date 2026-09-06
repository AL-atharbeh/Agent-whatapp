import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteTenant, updateProfile, updateTenant } from "../actions";
import { BUSINESS_TYPES } from "../types";
import Readiness from "./readiness";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await prisma.tenant.findUnique({
    where: { slug },
    include: { profile: true },
  });
  if (!t) notFound();
  const p = t.profile;

  return (
    <>
      <Readiness slug={slug} />

      {/* ── معلومات البزنس ── */}
      <div className="card">
        <h3>معلومات المتجر</h3>
        <p className="hint">
          كل ما تكتبه هنا يدخل مباشرة في تعليمات الوكيل. الحقول الفارغة = الوكيل يقول
          صراحةً إنه لا يملك المعلومة (ولا يخترعها).
        </p>

        <form action={updateProfile}>
          <input type="hidden" name="slug" value={slug} />

          <label>
            <span>نبذة عن المتجر</span>
            <textarea name="about" defaultValue={p?.about ?? ""} />
          </label>

          <div className="grid2">
            <label>
              <span>العنوان</span>
              <input type="text" name="address" defaultValue={p?.address ?? ""} />
            </label>
            <label>
              <span>رابط الموقع على خرائط جوجل</span>
              <input type="text" name="mapsUrl" defaultValue={p?.mapsUrl ?? ""} />
            </label>
            <label>
              <span>الهاتف</span>
              <input type="text" name="phone" defaultValue={p?.phone ?? ""} />
            </label>
            <label>
              <span>الموقع الإلكتروني</span>
              <input type="text" name="websiteUrl" defaultValue={p?.websiteUrl ?? ""} />
            </label>
          </div>

          <label>
            <span>أوقات الدوام</span>
            <input
              type="text"
              name="workingHours"
              defaultValue={p?.workingHours ?? ""}
              placeholder="السبت–الخميس ١٠:٠٠ص – ٩:٠٠م، الجمعة مغلق"
            />
          </label>

          <div className="grid2">
            <label>
              <span>سياسة التوصيل</span>
              <textarea name="deliveryPolicy" defaultValue={p?.deliveryPolicy ?? ""} />
            </label>
            <label>
              <span>سياسة الاسترجاع والاستبدال</span>
              <textarea name="returnPolicy" defaultValue={p?.returnPolicy ?? ""} />
            </label>
          </div>

          <label>
            <span>طرق الدفع</span>
            <input type="text" name="paymentMethods" defaultValue={p?.paymentMethods ?? ""} />
          </label>

          <button type="submit">حفظ معلومات المتجر</button>
        </form>
      </div>

      {/* ── إعدادات الوكيل ── */}
      <div className="card">
        <h3>إعدادات الوكيل</h3>

        <form action={updateTenant}>
          <input type="hidden" name="slug" value={slug} />

          <div className="grid3">
            <label>
              <span>اسم المتجر</span>
              <input type="text" name="name" defaultValue={t.name} />
            </label>
            <label>
              <span>نوع النشاط</span>
              <select name="businessType" defaultValue={t.businessType}>
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>اسم الوكيل</span>
              <input type="text" name="agentName" defaultValue={t.agentName} />
            </label>
          </div>

          <label>
            <span>نبرة الحديث</span>
            <input type="text" name="tone" defaultValue={t.tone} />
          </label>

          <label>
            <span>تعليمات خاصة (قواعد إضافية يلتزم بها الوكيل)</span>
            <textarea
              name="customPolicy"
              defaultValue={t.customPolicy ?? ""}
              placeholder="مثال: سعر أي قطعة = وزنها × سعر الجرام حسب عيارها + المصنعية. لا توافق على أي خصم."
            />
          </label>

          <label>
            <span>كلمات تفرض التحويل لموظف فوراً (افصل بفاصلة)</span>
            <input
              type="text"
              name="handoffKeywords"
              defaultValue={t.handoffKeywords.join("، ")}
              placeholder="شكوى، مدير، استرجاع"
            />
          </label>

          <div className="grid3">
            <label>
              <span>العملة</span>
              <input type="text" name="currency" defaultValue={t.currency} />
            </label>
            <label>
              <span>اللهجة</span>
              <input type="text" name="locale" defaultValue={t.locale} />
            </label>
            <label>
              <span>المنطقة الزمنية</span>
              <input type="text" name="timezone" defaultValue={t.timezone} />
            </label>
          </div>

          <div className="grid3">
            <label>
              <span>النموذج (عند استخدام Claude)</span>
              <select name="modelId" defaultValue={t.modelId}>
                <option value="claude-opus-5">claude-opus-5 (الأقوى)</option>
                <option value="claude-sonnet-5">claude-sonnet-5 (أوفر)</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5 (الأسرع)</option>
              </select>
            </label>
            <label>
              <span>مستوى الجهد</span>
              <select name="effort" defaultValue={t.effort}>
                <option value="low">منخفض — الأسرع والأوفر</option>
                <option value="medium">متوسط</option>
                <option value="high">مرتفع</option>
              </select>
            </label>
            <label>
              <span>سقف الردود اليومي</span>
              <input type="number" name="maxRepliesPerDay" defaultValue={t.maxRepliesPerDay} />
            </label>
          </div>

          <label>
            <span>حالة الاشتراك</span>
            <select name="status" defaultValue={t.status}>
              <option value="ACTIVE">نشط — الوكيل يرد</option>
              <option value="PAUSED">متوقف — لا يرد</option>
              <option value="SUSPENDED">معلّق</option>
            </select>
          </label>

          <button type="submit">حفظ إعدادات الوكيل</button>
        </form>
      </div>

      {/* ── حذف ── */}
      <div className="card">
        <h3>منطقة الخطر</h3>
        <p className="hint">حذف المتجر يمسح كتالوجه ومحادثاته وكل بياناته نهائياً.</p>
        <form action={deleteTenant}>
          <input type="hidden" name="slug" value={slug} />
          <button type="submit" className="danger">
            حذف المتجر نهائياً
          </button>
        </form>
      </div>
    </>
  );
}
