"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * تحديث تلقائي لصفحات المحادثات.
 *
 * الصفحة تُعرض على الخادم، فرسالة عميل جديدة لا تظهر إلا بتحديث يدوي — وهو
 * ما يجعل متابعة محادثة جارية مستحيلة عملياً: الموظف يقرأ، يحدّث، يقرأ.
 *
 * `router.refresh()` يعيد تشغيل مكوّنات الخادم ويدمج النتيجة في الصفحة دون
 * إعادة تحميل: لا يفقد موضع التمرير ولا ما كُتب في مربع الرد.
 */
export function LiveRefresh({
  seconds = 7,
  label = "تحديث تلقائي",
}: {
  seconds?: number;
  label?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [ago, setAgo] = useState(0);
  const tick = useRef(0);

  useEffect(() => {
    if (!on) return;

    const id = setInterval(() => {
      // لا نحدّث والتبويب مخفي: استدعاءات بلا قارئ تُرهق الخادم وقاعدة البيانات
      if (document.hidden) return;
      tick.current = 0;
      setAgo(0);
      router.refresh();
    }, seconds * 1000);

    const counter = setInterval(() => setAgo((a) => a + 1), 1000);

    // العودة للتبويب ⇒ تحديث فوري بدل انتظار الدورة التالية
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      clearInterval(counter);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, seconds, router]);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: "var(--text-3)",
      }}
    >
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="ghost"
        style={{ padding: "4px 12px", fontSize: 12.5 }}
      >
        {on ? "إيقاف التحديث" : "تشغيل التحديث"}
      </button>
      {on && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--live)",
              animation: "dot-breathe 2s ease-in-out infinite",
            }}
          />
          {label} · {ago}ث
        </span>
      )}
    </div>
  );
}
