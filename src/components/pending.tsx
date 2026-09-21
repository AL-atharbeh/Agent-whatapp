"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * إشارات «الأمر قيد التنفيذ».
 *
 * بدونها يضغط المستخدم الزر، لا يتغيّر شيء على الشاشة، فيضغط ثانيةً وثالثة —
 * وقد أُرسل الطلب في كل مرة. وحين تعود الصفحة أخيراً لا يعرف أنجح الحفظ أم
 * أنه ينظر إلى القيم القديمة.
 *
 * الفجوتان مختلفتان: النماذج تُرسل إلى الخادم (SubmitButton)، والروابط تنتقل
 * بين الصفحات (RouteProgress). كلتاهما تترك المستخدم في صمت.
 */

// ═══════════════════════════════════════════════════════════
//  زر الإرسال
// ═══════════════════════════════════════════════════════════

/**
 * زر يعرف حالة النموذج الذي يحويه.
 *
 * `useFormStatus` يقرأ حالة أقرب <form> فوقه — لذلك يجب أن يكون هذا المكوّن
 * داخل النموذج لا حوله، وأن يكون مكوّن عميل منفصلاً عن الصفحة.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      {...rest}
      className={className}
      disabled={pending || rest.disabled}
      aria-busy={pending}
    >
      {pending ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Spinner />
          {pendingText ?? "لحظة…"}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        display: "inline-block",
        animation: "spin 0.6s linear infinite",
        flex: "none",
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════
//  شريط التنقّل بين الصفحات
// ═══════════════════════════════════════════════════════════

/**
 * شريط تقدّم علوي عند الانتقال بين الصفحات.
 *
 * صفحات اللوحة كلها `force-dynamic` وتقرأ من قاعدة بيانات بعيدة، فالنقر على
 * رابط قد يصمت ثانيتين قبل أن يتغيّر شيء. نلتقط النقر على أي رابط داخلي
 * ونُظهر الشريط حتى يتبدّل المسار فعلاً.
 */
export function RouteProgress() {
  const [active, setActive] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  const first = useRef(true);

  // تغيّر المسار ⇒ وصلت الصفحة ⇒ أطفئ الشريط
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setActive(false);
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // نحترم فتح الرابط في تبويب جديد أو نافذة
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const link = (e.target as HTMLElement | null)?.closest?.("a");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // نفس الصفحة — لا انتقال
      }
      setActive(true);
    };

    // إرسال نموذج يعيد التوجيه أحياناً — نُظهر الشريط له أيضاً
    const onSubmit = () => setActive(true);

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        insetInlineStart: 0,
        insetBlockStart: 0,
        height: 2,
        zIndex: 9999,
        background: "var(--live)",
        boxShadow: "0 0 10px var(--live)",
        animation: "route-progress 1.6s ease-out forwards",
        pointerEvents: "none",
      }}
    />
  );
}
