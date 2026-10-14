"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * متابعة حيّة للمحادثات.
 *
 * الصفحة تُعرض على الخادم، فرسالة عميل جديدة لا تظهر إلا بتحديث — وبدون ذلك
 * تصير متابعة محادثة جارية مستحيلة: الموظف يقرأ، يحدّث، يقرأ.
 *
 * ولا نعيد بناء الصفحة كل ثانية: ذلك عدة استعلامات وعرض كامل، ستين مرة في
 * الدقيقة لكل متصفح مفتوح، والجواب في معظمها «لا جديد». نسأل بدلها نقطة
 * `/api/pulse` — استعلام واحد يرجّع بصمة صغيرة — ونعيد البناء حين تتغيّر
 * فقط. فالتأخير ثانية واحدة بكلفة أقل من التحديث كل سبع.
 */
export function LiveRefresh({ slug, seconds = 1 }: { slug: string; seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [beat, setBeat] = useState(false);
  const mark = useRef<string | null>(null);
  const busy = useRef(false);

  const check = useCallback(async () => {
    // لا نُراكم الطلبات إن تأخّرت الشبكة
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/pulse/${slug}`, { cache: "no-store" });
      if (!res.ok) return;
      const { n, t } = (await res.json()) as { n: number; t: number };
      const now = `${n}:${t}`;

      if (mark.current === null) {
        mark.current = now; // أول قراءة: نسجّل الحالة ولا نحدّث
        return;
      }
      if (mark.current !== now) {
        mark.current = now;
        setBeat(true);
        setTimeout(() => setBeat(false), 900);
        router.refresh();
      }
    } catch {
      // انقطاع مؤقت — نتجاهله وتُعاد المحاولة في الدورة التالية
    } finally {
      busy.current = false;
    }
  }, [slug, router]);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(check, seconds * 1000);
    // العودة للتبويب ⇒ فحص فوري بدل انتظار الدورة
    const onVisible = () => !document.hidden && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, seconds, check]);

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="ghost"
        style={{ padding: "4px 12px", fontSize: 12.5 }}
      >
        {on ? "إيقاف المتابعة" : "تشغيل المتابعة"}
      </button>
      {on && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: beat ? "var(--live)" : "var(--text-3)",
            transition: "color .2s",
          }}
        >
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
          {beat ? "وصل جديد" : "متابعة حيّة"}
        </span>
      )}
    </div>
  );
}
