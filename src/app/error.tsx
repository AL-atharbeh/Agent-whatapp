"use client";

/** شاشة خطأ مفهومة بدل رسالة Vercel العامة. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <h1>صار خطأ في الخادم</h1>
      <p className="sub">
        غالباً السبب أن متغيّرات البيئة غير مضبوطة، أو تعذّر الاتصال بقاعدة البيانات.
      </p>

      <div className="card">
        <h3>الخطوة الأولى: افحص الإعداد</h3>
        <p className="hint">
          افتح <code>/api/health</code> — يخبرك بالضبط أي متغيّر ناقص وهل قاعدة البيانات
          متصلة، بدون كشف أي قيمة.
        </p>
        <a className="btn" href="/api/health">
          فحص الإعداد الآن
        </a>
      </div>

      <div className="card">
        <h3>المتغيّرات المطلوبة</h3>
        <ul className="sub" style={{ lineHeight: 2 }}>
          <li>
            <code>DATABASE_URL</code> و <code>DIRECT_URL</code> — من Supabase
          </li>
          <li>
            <code>ENCRYPTION_KEY</code> — ٦٤ حرف hex
          </li>
          <li>
            <code>AGENT_PROVIDER</code> مع <code>ANTHROPIC_API_KEY</code> أو{" "}
            <code>GROQ_API_KEY</code>
          </li>
          <li>
            <code>APP_BASE_URL</code> — عنوان موقعك المنشور
          </li>
        </ul>
      </div>

      {error.digest && <p className="hint">معرّف الخطأ: {error.digest}</p>}

      <button onClick={reset}>إعادة المحاولة</button>
    </main>
  );
}
