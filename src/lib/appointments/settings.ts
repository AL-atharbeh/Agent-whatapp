/**
 * إعدادات المواعيد لكل متجر — من Tenant.appointmentSettings بقيم افتراضية.
 *
 * الحقل Json يكتبه مالك المنصة أو اللوحة، وقيمة خاطئة واحدة فيه (نص بدل
 * رقم، خطوة صفر) كانت ستُسقط حساب الأوقات كله أو تدخل حلقة لا تنتهي. فكل
 * مفتاح يُفحص وحده، والخاطئ يسقط لافتراضيّه دون أن يُبطل الباقي.
 */

export type AppointmentSettings = {
  slotStepMinutes: number;
  bufferMinutes: number;
  reminderHour: number;
  delayNotifyMinutes: number;
  autoNoShowMinutes: number;
  reminderTemplate: string | null;
  delayTemplate: string | null;
  rebookTemplate: string | null;
};

export const DEFAULT_SETTINGS: AppointmentSettings = {
  slotStepMinutes: 15,
  bufferMinutes: 0,
  reminderHour: 18,
  delayNotifyMinutes: 10,
  autoNoShowMinutes: 60,
  reminderTemplate: null,
  delayTemplate: null,
  rebookTemplate: null,
};

const int = (v: unknown, min: number, max: number, def: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : def;

const name = (v: unknown) =>
  typeof v === "string" && /^[a-z0-9_]{1,512}$/.test(v.trim()) ? v.trim() : null;

export function settingsOf(tenant: { appointmentSettings: unknown }): AppointmentSettings {
  const raw = tenant.appointmentSettings;
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    // خطوة أقل من ٥ دقائق تولّد مئات الأوقات بلا فائدة لأحد
    slotStepMinutes: int(o.slotStepMinutes, 5, 120, d.slotStepMinutes),
    bufferMinutes: int(o.bufferMinutes, 0, 120, d.bufferMinutes),
    reminderHour: int(o.reminderHour, 0, 23, d.reminderHour),
    delayNotifyMinutes: int(o.delayNotifyMinutes, 1, 240, d.delayNotifyMinutes),
    autoNoShowMinutes: int(o.autoNoShowMinutes, 5, 24 * 60, d.autoNoShowMinutes),
    reminderTemplate: name(o.reminderTemplate),
    delayTemplate: name(o.delayTemplate),
    rebookTemplate: name(o.rebookTemplate),
  };
}
