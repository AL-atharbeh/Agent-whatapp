import { Suspense } from "react";
import Link from "next/link";
import { safeTz, settingsOf, toLocal } from "@/lib/appointments";
import { setAppointmentsEnabled } from "../../actions";
import { saveAppointmentSettings } from "../../appointments-actions";
import { ActionError } from "@/components/action-error";
import { SubmitButton } from "@/components/pending";

/**
 * وحدة المواعيد في إعدادات المتجر — لمالك المنصة وحده.
 *
 * الوحدة اختيارية لأي نشاط بالمواعيد (عيادة، مركز صيانة، صالون…). التفعيل
 * يضيف للوكيل ثماني أدوات وتعليمات في كل رسالة، ويشغّل رسائل تذكير لعملاء
 * المتجر باسمه — قرار بكلفة، فهو هنا لا في بوابة صاحب المتجر.
 *
 * ساعة التذكير بتوقيت المتجر لا الخادم ولا المتصفح: مالك المنصة قد يكون في
 * بلد آخر، والرقم الذي يكتبه هو ما ستراه ساعة العميل.
 */
export default function AppointmentsSettings({
  slug,
  tenant,
}: {
  slug: string;
  tenant: { appointmentsEnabled: boolean; appointmentSettings: unknown; timezone: string };
}) {
  const s = settingsOf(tenant);
  const tz = safeTz(tenant.timezone);
  const now = toLocal(new Date(), tz);

  return (
    <div className="card" id="appointments">
      <Suspense fallback={null}>
        <ActionError />
      </Suspense>

      <div className="row">
        <h3 style={{ margin: 0 }}>
          وحدة المواعيد{" "}
          <span className={`pill ${tenant.appointmentsEnabled ? "ok" : ""}`}>
            {tenant.appointmentsEnabled ? "مفعّلة" : "مطفأة"}
          </span>
        </h3>
        <form action={setAppointmentsEnabled}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="enabled" value={tenant.appointmentsEnabled ? "false" : "true"} />
          <SubmitButton className={tenant.appointmentsEnabled ? "danger" : ""}>
            {tenant.appointmentsEnabled ? "إطفاء الوحدة" : "تفعيل الوحدة"}
          </SubmitButton>
        </form>
      </div>
      <p className="hint">
        لأي نشاط يعمل بالمواعيد: حجز عبر الوكيل، جدول يومي للفريق، تذكير وتنبيه تأخير، ومدة
        تتعلّم من كل عميل. مطفأة ⇒ لا أدوات ولا تعليمات إضافية للوكيل ولا مهام مجدولة. الإطفاء لا
        يحذف الخدمات ولا الفريق ولا المواعيد.
        {tenant.appointmentsEnabled && (
          <>
            {" "}
            <Link href={`/admin/${slug}/appointments`}>افتح المواعيد ←</Link>
          </>
        )}
      </p>

      {tenant.appointmentsEnabled && (
        <form action={saveAppointmentSettings}>
          <input type="hidden" name="slug" value={slug} />
          <div className="grid3">
            <label>
              <span>دقّة اقتراح الأوقات (دقيقة)</span>
              <input type="number" name="slotStepMinutes" min={5} max={120} defaultValue={s.slotStepMinutes} />
            </label>
            <label>
              <span>فاصل بين موعدين (دقيقة)</span>
              <input type="number" name="bufferMinutes" min={0} max={120} defaultValue={s.bufferMinutes} />
            </label>
            <label>
              <span>ساعة التذكير بمواعيد الغد — بتوقيت {tz}</span>
              <select name="reminderHour" defaultValue={String(s.reminderHour)}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>تأخير يستحق تنبيه العميل التالي (دقيقة)</span>
              <input type="number" name="delayNotifyMinutes" min={1} max={240} defaultValue={s.delayNotifyMinutes} />
            </label>
            <label>
              <span>غياب تلقائي بعد نهاية الموعد بـ (دقيقة)</span>
              <input type="number" name="autoNoShowMinutes" min={5} max={1440} defaultValue={s.autoNoShowMinutes} />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -6 }}>
            الساعة الآن بتوقيت المتجر: {now.time}. التذكير يُرسَل مع أول دورة للمهمة المجدولة بعد هذه الساعة.
          </p>

          <div className="grid3">
            <label>
              <span>قالب التذكير (لغته ar)</span>
              <input type="text" name="reminderTemplate" dir="ltr" defaultValue={s.reminderTemplate ?? ""} placeholder="appointment_reminder" />
            </label>
            <label>
              <span>قالب التأخير</span>
              <input type="text" name="delayTemplate" dir="ltr" defaultValue={s.delayTemplate ?? ""} placeholder="appointment_delay" />
            </label>
            <label>
              <span>قالب العودة</span>
              <input type="text" name="rebookTemplate" dir="ltr" defaultValue={s.rebookTemplate ?? ""} placeholder="rebook_reminder" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -6 }}>
            أسماء قوالب واتساب معتمدة كما في Meta. متغيّراتها بالترتيب: {"{{1}}"} اسم العميل ·{" "}
            {"{{2}}"} الخدمة · {"{{3}}"} الوقت · {"{{4}}"} التاريخ · {"{{5}}"} مقدّم الخدمة. قالب
            فارغ ⇒ لا تُرسَل تلك الرسالة.
          </p>
          <SubmitButton>حفظ إعدادات المواعيد</SubmitButton>
        </form>
      )}
    </div>
  );
}
