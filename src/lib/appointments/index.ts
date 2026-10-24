/**
 * وحدة المواعيد — الواجهة العامة التي تستوردها اللوحة والجوال والوكيل.
 *
 * اختيارية لكل نشاط يعمل بالمواعيد (عيادة، صالون، مركز صيانة…)، ومطفأة
 * تماماً لما عداه. المرجع: docs/appointments.md — قسم «واجهة المكتبة».
 *
 * كل دالة تأخذ tenantId أولاً، وكل معرّف آخر يُطابَق معه قبل أي قراءة أو
 * كتابة: معرّف من متجر آخر يُعامل كغير موجود (AppointmentError NOT_FOUND).
 */

export { AppointmentError, type AppointmentCode } from "./errors";
export { settingsOf, DEFAULT_SETTINGS, type AppointmentSettings } from "./settings";
export { loadApptTenant, type ApptTenant } from "./tenant";
export {
  WEEKDAYS,
  addDays,
  dayBounds,
  formatLocal,
  minutesOf,
  parseLocal,
  spokenDate,
  spokenTime,
  toLocal,
  zonedToUtc,
  type Weekday,
} from "./time";
export {
  busyIntervals,
  canTransition,
  estimateFrom,
  parseWorkingHours,
  workingHoursSchema,
  workingWindows,
  type Estimate,
  type Interval,
  type WorkingHours,
} from "./rules";
export { checkPhoto, MAX_PHOTO_BYTES } from "./photo";

export {
  createService,
  createStaff,
  getService,
  getStaff,
  getStaffPhoto,
  listServices,
  listStaff,
  serviceFields,
  servicePatch,
  setStaffPhoto,
  setStaffServices,
  staffFields,
  staffPatch,
  updateService,
  updateStaff,
  type ServiceInput,
  type ServicePatch,
  type ServiceView,
  type StaffInput,
  type StaffPatch,
  type StaffView,
} from "./catalog";

export {
  createCustomer,
  customerFields,
  customerProfile,
  getCustomer,
  searchCustomers,
  toCustomerView,
  updateCustomer,
  upsertCustomerFromContact,
  type CustomerHistoryItem,
  type CustomerInput,
  type CustomerProfile,
  type CustomerView,
  type LearnedDuration,
} from "./customers";

export {
  bookAppointment,
  cancelAppointment,
  confirmAppointment,
  dayView,
  estimateMinutes,
  findSlots,
  finishAppointment,
  getAppointment,
  inDayPart,
  markNoShow,
  rescheduleAppointment,
  sourceOfChannel,
  suggestedPrice,
  upcomingFor,
  type AppointmentView,
  type BookInput,
  type DayPart,
  type DayView,
  type Slot,
} from "./booking";

// «بدأت» من هنا لا من booking: تُجدوِل فحص التأخير المتسلسل بعد الرد
export { startAppointment, checkStaffDelay, scheduleDelayCheck } from "./delay";
export { runAppointmentsCron, runForTenant, type TenantCronResult } from "./cron";
export {
  appointmentReport,
  type AppointmentReport,
  type ServiceReport,
  type StaffReport,
} from "./reports";
export { isDateStr } from "./time";
export { safeTz } from "./time";
