/**
 * أخطاء المواعيد بمعنى معروف — تُترجَم في الجوال إلى رموز العقد، وتعرض
 * اللوحة رسالتها العربية كما هي.
 *
 * NOT_FOUND يشمل «لمتجر آخر»: معرّف خدمة أو مقدّم خدمة أو عميل من متجر غير
 * متجرك يُعامل كأنه غير موجود، فلا يُستنتج وجوده من اختلاف الرد.
 */
export type AppointmentCode = "NOT_FOUND" | "INVALID_INPUT" | "SLOT_TAKEN";

export class AppointmentError extends Error {
  constructor(
    readonly code: AppointmentCode,
    message: string,
  ) {
    super(message);
    this.name = "AppointmentError";
  }
}

export const notFound = (what: string) => new AppointmentError("NOT_FOUND", `${what} غير موجود`);
export const invalid = (msg: string) => new AppointmentError("INVALID_INPUT", msg);
