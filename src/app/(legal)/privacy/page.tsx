import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "سياسة الخصوصية — وكيل",
  description: "كيف نجمع بيانات محادثات خدمة العملاء ونستخدمها ونحميها.",
};

const UPDATED = "٦ سبتمبر ٢٠٢٦";

export default function PrivacyPage() {
  return (
    <>
      <h1>سياسة الخصوصية</h1>
      <p className="sub">آخر تحديث: {UPDATED}</p>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          «وكيل» منصة تتيح للأنشطة التجارية الرد على استفسارات عملائها تلقائياً عبر
          واتساب وفيسبوك ماسنجر وانستقرام باستخدام الذكاء الاصطناعي. توضّح هذه الصفحة
          البيانات التي نعالجها، وسبب معالجتها، ومدة الاحتفاظ بها.
        </p>
      </div>

      <h2>١. البيانات التي نجمعها</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>أ) بيانات المحادثات</strong>
          <br />
          عندما يراسل شخص نشاطاً تجارياً مشتركاً في المنصة، نستقبل ونخزّن: نص الرسالة،
          معرّف المستخدم لدى المنصة (رقم واتساب أو معرّف الصفحة)، الاسم المعروض إن أتاحته
          المنصة، ووقت الرسالة.
        </p>
        <p>
          <strong>ب) بيانات النشاط التجاري</strong>
          <br />
          يزوّدنا صاحب النشاط بمعلومات عمله: العنوان، أوقات الدوام، الكتالوج والأسعار،
          السياسات، والأسئلة الشائعة.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>ج) بيانات تقنية</strong>
          <br />
          سجلات أخطاء ومؤشرات استخدام (عدد الرسائل، زمن الاستجابة) لتشغيل الخدمة ومراقبتها.
        </p>
      </div>

      <h2>٢. كيف نستخدمها</h2>
      <div className="card">
        <ul style={{ margin: 0, lineHeight: 2 }}>
          <li>توليد رد على استفسار العميل نيابةً عن النشاط التجاري</li>
          <li>عرض المحادثة على موظفي النشاط التجاري عند تحويلها إليهم</li>
          <li>تنبيه النشاط التجاري إلى عميل أبدى نية شراء</li>
          <li>تشغيل الخدمة وتحسين جودتها ومنع إساءة الاستخدام</li>
        </ul>
        <p className="hint" style={{ marginBottom: 0 }}>
          <strong>لا نبيع البيانات، ولا نستخدمها للإعلانات، ولا نشاركها مع أنشطة تجارية
          أخرى على المنصة.</strong> بيانات كل نشاط تجاري معزولة تماماً عن غيره.
        </p>
      </div>

      <h2>٣. مشاركة البيانات مع مزوّدي الخدمة</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          لتوليد الردود نرسل نص الرسالة ومعلومات النشاط التجاري ذات الصلة إلى مزوّد نماذج
          لغوية (Anthropic أو Groq بحسب إعداد الحساب). يعالج المزوّد الطلب لتوليد الرد
          فقط.
        </p>
        <p style={{ marginBottom: 0 }}>
          كما نستخدم مزوّد استضافة قواعد بيانات (Supabase) ومنصة نشر (Vercel) لتشغيل
          الخدمة. كل هؤلاء ملزمون تعاقدياً بحماية البيانات وعدم استخدامها لأغراضهم.
        </p>
      </div>

      <h2>٤. مدة الاحتفاظ</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          نحتفظ بالمحادثات ما دام النشاط التجاري مشتركاً في الخدمة، لتمكين موظفيه من
          متابعة سياق العميل. عند إنهاء الاشتراك تُحذف بيانات ذلك النشاط — بما فيها كل
          محادثاته — خلال ثلاثين يوماً.
        </p>
        <p style={{ marginBottom: 0 }}>
          يمكن لأي عميل نهائي طلب حذف بياناته في أي وقت (انظر القسم ٦).
        </p>
      </div>

      <h2>٥. الأمان</h2>
      <div className="card">
        <ul style={{ margin: 0, lineHeight: 2 }}>
          <li>كل الاتصالات مشفّرة عبر HTTPS</li>
          <li>مفاتيح الوصول للقنوات مخزّنة مشفّرة بـ AES-256-GCM</li>
          <li>التحقق من توقيع كل طلب وارد من Meta قبل معالجته</li>
          <li>عزل تقني صارم بين بيانات كل نشاط تجاري على مستوى قاعدة البيانات</li>
          <li>الوصول إلى لوحة التحكم محميّ بمصادقة</li>
        </ul>
      </div>

      <h2>٦. حقوقك</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          لك الحق في طلب نسخة من بياناتك، أو تصحيحها، أو حذفها نهائياً. راسلنا على البريد
          أدناه، أو اتبع{" "}
          <a href="/data-deletion" style={{ color: "var(--accent)" }}>
            تعليمات حذف البيانات
          </a>
          . نستجيب خلال ثلاثين يوماً.
        </p>
        <p style={{ marginBottom: 0 }}>
          إن راسلت نشاطاً تجارياً يستخدم «وكيل» وأردت التوقف، اكتب «إيقاف» في المحادثة
          أو احظر الرقم من تطبيق المراسلة.
        </p>
      </div>

      <h2>٧. الأطفال</h2>
      <div className="card">
        <p style={{ margin: 0 }}>
          الخدمة موجّهة للأنشطة التجارية وعملائها البالغين، وليست مخصصة لمن هم دون سن
          الثالثة عشرة. لا نجمع بيانات عن قصد من الأطفال.
        </p>
      </div>

      <h2>٨. التغييرات والتواصل</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          قد نحدّث هذه السياسة، وسيظهر تاريخ التحديث أعلى الصفحة.
        </p>
        <p style={{ marginBottom: 0 }}>
          للاستفسارات أو طلبات البيانات:{" "}
          <a href="mailto:bashar188yousef@gmail.com" style={{ color: "var(--accent)" }}>
            bashar188yousef@gmail.com
          </a>
        </p>
      </div>

      {/* نسخة إنجليزية مختصرة — مراجعو Meta قد لا يقرأون العربية */}
      <h2 style={{ marginTop: 40 }}>Privacy Policy (English summary)</h2>
      <div className="card" dir="ltr" style={{ textAlign: "left" }}>
        <p style={{ marginTop: 0 }}>
          <strong>Wakeel</strong> lets businesses answer customer enquiries automatically
          on WhatsApp, Messenger and Instagram using AI.
        </p>
        <p>
          <strong>What we process:</strong> message text, the messaging platform&apos;s
          user identifier, display name where provided, and timestamps — plus the business
          information the merchant enters (catalogue, prices, policies).
        </p>
        <p>
          <strong>Why:</strong> solely to generate a reply on the business&apos;s behalf,
          show conversations to its staff, and operate the service. We do not sell data,
          do not use it for advertising, and never share one business&apos;s data with
          another.
        </p>
        <p>
          <strong>Processors:</strong> an LLM provider (Anthropic or Groq) to generate
          replies, Supabase for database hosting, Vercel for hosting.
        </p>
        <p>
          <strong>Retention:</strong> for the life of the business&apos;s subscription;
          deleted within 30 days of termination. End users may request deletion at any
          time.
        </p>
        <p>
          <strong>Security:</strong> HTTPS everywhere, channel credentials encrypted with
          AES-256-GCM, Meta request signatures verified, strict per-business data
          isolation, authenticated admin access.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Contact:</strong>{" "}
          <a href="mailto:bashar188yousef@gmail.com" style={{ color: "var(--accent)" }}>
            bashar188yousef@gmail.com
          </a>{" "}
          · <a href="/data-deletion" style={{ color: "var(--accent)" }}>Data deletion</a>
        </p>
      </div>
    </>
  );
}
