"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * يعرض سبب فشل الإجراء.
 *
 * كانت الإجراءات ترمي رسائل عربية دقيقة — «رقم غير صالح»، «رفضت Meta
 * القالب: المتغيّر لا يكون في آخر النص» — ولا تصل أيّها المستخدم: Next.js
 * تحجب نص الخطأ في الإنتاج وتعرض صفحة «صار خطأ في الخادم» مع رقم معرّف.
 *
 * فيرى صاحب المتجر عطلاً في النظام حيث كان هناك شرطٌ لم يستوفِه، ويعيد
 * المحاولة بنفس المُدخَل. والرسالة التي كُتبت له موجودة في سجلّ لا يقرأه.
 *
 * فننقلها في عنوان الصفحة بعد إعادة التوجيه، ونعرضها هنا — ثم ننظّف العنوان
 * حتى لا يبقى الخطأ معلّقاً عند التحديث أو تُشارَك نسخةٌ منه.
 */
export function ActionError() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("err");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!raw) return;
    setMessage(raw);

    const url = new URL(window.location.href);
    url.searchParams.delete("err");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [raw, router]);

  if (!message) return null;

  return (
    <div className="alert warn" role="alert" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <strong style={{ flex: 1 }}>{message}</strong>
        <button
          type="button"
          className="ghost"
          onClick={() => setMessage(null)}
          aria-label="إخفاء"
          style={{ padding: "2px 10px", fontSize: 12.5, flex: "none" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
