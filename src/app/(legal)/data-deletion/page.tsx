import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "حذف البيانات — وكيل",
  description: "كيف تطلب حذف بياناتك من منصة وكيل.",
};

export default function DataDeletionPage() {
  return (
    <>
      <h1>حذف البيانات</h1>
      <p className="sub">Data Deletion Instructions</p>

      <h2>إن كنت عميلاً راسلت نشاطاً تجارياً</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          لحذف محادثاتك وأي بيانات مرتبطة بك، أرسل بريداً إلى{" "}
          <a href="mailto:bashar188yousef@gmail.com" style={{ color: "var(--accent)" }}>
            bashar188yousef@gmail.com
          </a>{" "}
          يتضمّن:
        </p>
        <ul style={{ lineHeight: 2 }}>
          <li>رقم الهاتف أو الحساب الذي راسلت منه</li>
          <li>اسم النشاط التجاري الذي راسلته</li>
          <li>عبارة «أطلب حذف بياناتي»</li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          نحذف كل محادثاتك ومعرّفك نهائياً <strong>خلال ثلاثين يوماً</strong>، ونرسل لك
          تأكيداً. الحذف نهائي وغير قابل للتراجع.
        </p>
      </div>

      <h2>إن كنت صاحب نشاط تجاري مشترك</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          يمكنك حذف كل بيانات نشاطك بنفسك من لوحة التحكم:
          <br />
          <strong>إعدادات المتجر ← منطقة الخطر ← حذف المتجر نهائياً</strong>
        </p>
        <p style={{ marginBottom: 0 }}>
          يمسح ذلك الكتالوج والأسئلة الشائعة وكل المحادثات والعملاء المحتملين ومفاتيح
          القنوات فوراً ونهائياً.
        </p>
      </div>

      <h2>ماذا يُحذف بالضبط</h2>
      <div className="card">
        <ul style={{ margin: 0, lineHeight: 2 }}>
          <li>نصوص كل الرسائل الواردة والصادرة</li>
          <li>معرّف المستخدم لدى منصة المراسلة والاسم المعروض</li>
          <li>سجلات العملاء المحتملين</li>
          <li>سجلات استخدام النموذج المرتبطة بالمحادثة</li>
        </ul>
      </div>

      {/* نسخة إنجليزية — مطلوبة لمراجعة Meta */}
      <h2 style={{ marginTop: 40 }}>Data Deletion (English)</h2>
      <div className="card" dir="ltr" style={{ textAlign: "left" }}>
        <p style={{ marginTop: 0 }}>
          <strong>End users:</strong> email{" "}
          <a href="mailto:bashar188yousef@gmail.com" style={{ color: "var(--accent)" }}>
            bashar188yousef@gmail.com
          </a>{" "}
          with the phone number or account you messaged from, the name of the business you
          contacted, and the phrase &quot;delete my data&quot;. All your conversations and
          identifiers are permanently erased within 30 days and we confirm by email.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Businesses:</strong> delete everything yourself from the dashboard —
          Store Settings → Danger Zone → Delete store permanently. This immediately and
          irreversibly removes the catalogue, FAQs, all conversations, leads, and channel
          credentials.
        </p>
      </div>
    </>
  );
}
