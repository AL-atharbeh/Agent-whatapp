import type { StaffView, Weekday } from "@/lib/appointments";

/**
 * مشترك بين صفحات المواعيد في البوابتين (مالك المنصة وصاحب النشاط).
 *
 * المجلد `_views` خاص — لا يصير مساراً. الصفحات في /admin/[slug]/appointments
 * و/app/appointments أغلفة رفيعة تستدعي هذه العروض بمسارها الأساسي، فالواجهة
 * واحدة والفرق الوحيد إلى أين يعود الإجراء.
 */

export type ViewProps = {
  tenantId: string;
  slug: string;
  /** /admin/<slug>/appointments أو /app/appointments */
  base: string;
  sp: Record<string, string | undefined>;
};

export const STATUS: Record<string, { label: string; cls: string }> = {
  BOOKED: { label: "محجوز", cls: "" },
  CONFIRMED: { label: "مؤكَّد", cls: "ok" },
  IN_PROGRESS: { label: "جارٍ الآن", cls: "warn" },
  DONE: { label: "انتهى", cls: "" },
  CANCELLED: { label: "ملغى", cls: "danger" },
  NO_SHOW: { label: "غياب", cls: "danger" },
};

export const SOURCE: Record<string, string> = {
  WHATSAPP: "واتساب",
  INSTAGRAM: "انستقرام",
  MESSENGER: "ماسنجر",
  WALK_IN: "حضوري",
  PHONE: "هاتف",
  DASHBOARD: "اللوحة",
  APP: "التطبيق",
};

export const CHANNEL: Record<string, string> = {
  WHATSAPP: "واتساب",
  INSTAGRAM: "انستقرام",
  MESSENGER: "ماسنجر",
};

/** أسبوع العمل كما يُقرأ هنا: يبدأ بالسبت. */
export const WEEK: { key: Weekday; label: string }[] = [
  { key: "sat", label: "السبت" },
  { key: "sun", label: "الأحد" },
  { key: "mon", label: "الإثنين" },
  { key: "tue", label: "الثلاثاء" },
  { key: "wed", label: "الأربعاء" },
  { key: "thu", label: "الخميس" },
  { key: "fri", label: "الجمعة" },
];

const CURRENCY: Record<string, string> = { JOD: "دينار", SAR: "ريال", AED: "درهم", USD: "دولار" };

const fmt = (n: number) => new Intl.NumberFormat("ar-JO", { maximumFractionDigits: 2 }).format(n);
const cur = (c: string) => CURRENCY[c] ?? c;

export function money(n: number | null | undefined, currency: string): string {
  return n == null ? "—" : `${fmt(n)} ${cur(currency)}`;
}

/** «من … إلى …» حين يكون نطاقاً، ورقماً واحداً حين يكون ثابتاً — كما يقوله الوكيل. */
export function priceRange(min: number, max: number | null, currency: string): string {
  return max != null && max !== min ? `من ${fmt(min)} إلى ${fmt(max)} ${cur(currency)}` : money(min, currency);
}

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} س ${r} د` : `${h} ساعة`;
}

/** حقول مخفية يحتاجها كل إجراء: المتجر، ومسار العودة. */
export function Ctx({ slug, back }: { slug: string; back: string }) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}

export const photoUrl = (s: Pick<StaffView, "id" | "photoVersion">) =>
  s.photoVersion ? `/api/appointments/staff-photo/${s.id}?v=${s.photoVersion}` : null;

/** صورة مقدّم الخدمة، أو أول حرف من اسمه — الحرف بديل كامل لا خانة فارغة. */
export function Avatar({ staff, size = 32 }: { staff: Pick<StaffView, "id" | "name" | "photoVersion">; size?: number }) {
  const url = photoUrl(staff);
  const style = { width: size, height: size };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- صورة مصغّرة من مسارنا المخبّأ، لا داعي لمحسّن الصور
    <img className="appt-avatar" src={url} alt="" style={style} loading="lazy" />
  ) : (
    <span className="appt-avatar" style={style} aria-hidden>
      {Array.from(staff.name.trim())[0] ?? "؟"}
    </span>
  );
}
