# وحدة المواعيد — لكل نشاط يعمل بالمواعيد

> **حاضر منصة لكل الأنشطة، لا للصالونات.** هذه وحدة **اختيارية** تُفعَّل لأي
> نشاط يعمل بالمواعيد: صالون، حلاق، عيادة، أسنان، علاج طبيعي، مركز صيانة سيارات،
> مستشار، مدرّب… وتبقى **مطفأة تماماً** لما عداها (ذهب، ملابس، مطاعم): لا نص
> إضافي في تعليمات الوكيل، لا أدوات، لا تبويب، لا مهام مجدولة، لا استعلام زائد.
> الصالون أول عميل يطلبها — ومنه الأمثلة — لكن لا كلمة في الكود أو الواجهة أو
> تعليمات الوكيل تفترض صالوناً أو جنس العميل.

هذه الوثيقة **العقد المشترك** بين الخادم ولوحة الويب وتطبيق الجوال. يُبنى الثلاثة
عليها بالتوازي؛ أي اختلاف بينها وبين الكود خطأ في الكود.

---

## المشكلة التي نحلّها

كل نشاط بالمواعيد يحجز **بوقت ثابت لكل خدمة**، والوقت الحقيقي **يحدّده العميل**:
قصة سارة ١٥ دقيقة وقصة لين ساعة؛ كشف مريض ١٠ دقائق وآخر ٤٠؛ صيانة سيارة ساعة
وأخرى ثلاث. حجزٌ ثابت إمّا يترك وقتاً ضائعاً محجوزاً، أو يؤخّر كل من بعده. لا رقم
ثابت يحلّها — الحل أن يعرف النظام **كل عميل** ويحجز له **وقته هو**، ويتعلّم من كل
جلسة.

ومعها مشاكل تقع في كل نشاط بالمواعيد: الغياب بلا إلغاء، التأخير المتسلسل، وقت
الانتظار داخل الخدمة (صبغة تثبت، تخدير يسري، طلاء يجف)، العميل الذي لا يعود
(تجديد صبغة، تنظيف أسنان كل ٦ أشهر، صيانة دورية)، و«شو اللي عملتولي آخر مرة؟».

**اللغة محايدة**: «العميل»، «الفريق / مقدّم الخدمة»، «الخدمة»، «ملاحظات الزيارة» —
لا «الزبونة» ولا «الموظفة» ولا «الصبغة» في الكود أو الواجهة أو تعليمات الوكيل.

**بلا موقع حجز**: الحجز عبر محادثة الوكيل على واتساب/انستقرام/ماسنجر، والإدارة
من لوحة الويب وتطبيق الجوال.

---

## التفعيل

`Tenant.appointmentsEnabled Boolean @default(false)` — مالك المنصة يفعّلها
لمتجر. بدونها: لا أدوات حجز للوكيل، لا صفحات، لا تبويب في التطبيق، لا مهام مجدولة.

إعدادات المتجر (`Tenant.appointmentSettings Json?`، كلها اختيارية بقيم افتراضية):

| المفتاح | الافتراضي | المعنى |
|---|---|---|
| `slotStepMinutes` | 15 | دقّة اقتراح الأوقات |
| `bufferMinutes` | 0 | فاصل بين موعدين (تنظيف) |
| `reminderHour` | 18 | ساعة إرسال تذكير «موعدك بكرا» (بتوقيت المتجر) |
| `delayNotifyMinutes` | 10 | تأخير متوقّع يستحق تنبيه الزبونة التالية |
| `autoNoShowMinutes` | 60 | موعد لم يبدأ بعد نهايته المخطّطة بهذا القدر ⇒ غياب |
| `reminderTemplate` | null | اسم قالب التذكير (لغته `ar`) |
| `delayTemplate` | null | اسم قالب التأخير |
| `rebookTemplate` | null | اسم قالب «صار وقت التجديد» |

قالب غير مضبوط ⇒ لا إرسال (سطر في السجل)، والباقي يعمل.

---

## نموذج البيانات (إضافي فقط — لا كسر لما هو قائم)

```prisma
enum AppointmentStatus { BOOKED CONFIRMED IN_PROGRESS DONE CANCELLED NO_SHOW }
enum AppointmentSource { WHATSAPP INSTAGRAM MESSENGER WALK_IN PHONE DASHBOARD APP }

model Service {
  id, tenantId
  name            String
  category        String?
  priceMin        Decimal  @db.Decimal(10,2)
  priceMax        Decimal? @db.Decimal(10,2)   // null ⇒ سعر ثابت = priceMin
  defaultMinutes  Int                            // المدة حين لا تاريخ
  // وقت انتظار داخل الخدمة (صبغة تثبت، تخدير يسري، طلاء يجف): مقدّم الخدمة حرّ خلاله
  processingAfterMinutes Int @default(0)         // بعد كم دقيقة من البدء يبدأ الانتظار
  processingMinutes      Int @default(0)         // طول الانتظار؛ 0 ⇒ لا انتظار
  rebookAfterDays Int?                           // تذكير العودة؛ null ⇒ لا تذكير
  active Boolean @default(true), sortOrder Int @default(0), createdAt
  staff StaffService[]
}

model Staff {
  id, tenantId
  name, phone String?
  photo Bytes?, photoMime String?               // صورة مصغّرة ≤ 150KB، تُخدم من مسار مخبّأ
  workingHours Json   // { "sat": [["10:00","14:00"],["16:00","21:00"]], "fri": [] , … }
  commissionPercent Decimal? @db.Decimal(5,2)
  active Boolean @default(true), sortOrder Int @default(0), createdAt
  services StaffService[]
}

model StaffService { staffId, serviceId  @@id([staffId, serviceId]) }

model Customer {
  id, tenantId
  phone        String?   // أرقام فقط بمفتاح الدولة؛ @@unique([tenantId, phone])
  name         String?
  notes        String?  @db.Text      // ملاحظات دائمة (حساسية، تفضيلات)
  preferredStaffId String?
  visitCount   Int @default(0)
  noShowCount  Int @default(0)
  lastVisitAt  DateTime?
  createdAt
  contacts     CustomerContact[]
}

/// ربط الزبونة بقنواتها — واتساب يعطي الرقم، انستقرام وماسنجر معرّفاً فقط.
model CustomerContact {
  id, tenantId, customerId
  channel Channel, externalUserId String
  @@unique([tenantId, channel, externalUserId])
}

model Appointment {
  id, tenantId, customerId, staffId, serviceId
  startAt         DateTime
  plannedMinutes  Int            // ما حجزناه — من مُقدِّر المدة لا من الخدمة
  status          AppointmentStatus @default(BOOKED)
  source          AppointmentSource
  startedAt  DateTime?, finishedAt DateTime?
  actualMinutes   Int?           // finishedAt - startedAt، مقرّبة
  finalPrice      Decimal? @db.Decimal(10,2)
  notes           String? @db.Text   // ما حدث في الزيارة: رقم صبغة، دواء، قطعة غيار…
  confirmedAt, reminderSentAt, delayNotifiedAt, rebookSentAt, cancelledAt  DateTime?
  createdAt, updatedAt @updatedAt
  @@index([tenantId, staffId, startAt])
  @@index([tenantId, customerId, startAt])
  @@index([tenantId, status, startAt])
}
```

---

## القواعد

### ١. مُقدِّر المدة — قلب الحل

لموعد (زبونة، خدمة، موظفة)، بالترتيب، أول ما يتوفّر:

1. **تاريخ الزبونة لهذه الخدمة**: وسيط `actualMinutes` لآخر ٣ جلسات `DONE`.
2. **تاريخ الموظفة لهذه الخدمة**: وسيط آخر ١٠.
3. `Service.defaultMinutes`.

يُقرَّب للأعلى إلى ٥ دقائق، ولا يقلّ عن ٥. يرجّع
`{ minutes, basis: "customer" | "staff" | "default", samples }` — اللوحة تعرض
الأساس («حسب زياراتها السابقة») ليثق الموظف بالرقم أو يعدّله.

الوسيط لا المتوسط: جلسة شاذّة واحدة (زبونة غيّرت رأيها ٣ مرات) لا تفسد التقدير.

### ٢. انشغال الموظفة

لكل موعد غير `CANCELLED` / `NO_SHOW`:

| الحالة | الفترة المحجوزة |
|---|---|
| `DONE` | `[startedAt ?? startAt, finishedAt]` — **الفعلي**: من خلص بدري حرّر وقته |
| `IN_PROGRESS` | `[startedAt, max(now, startedAt + planned)]` — من طوّل يمتد للآن |
| `BOOKED` / `CONFIRMED` | `[startAt, startAt + planned]` |

**وقت الانتظار**: إن كان للخدمة `processingMinutes > 0`، تُستثنى من الانشغال
الفترة `[start + processingAfter, start + processingAfter + processing]` — الموظفة
حرّة فيها. موعد آخر يُقبل داخلها **فقط إن وقع بكامله فيها**.

ويُضاف `bufferMinutes` بعد كل موعد.

### ٣. الأوقات المتاحة

ساعات دوام الموظفة في ذلك اليوم (بتوقيت المتجر `Tenant.timezone`) ناقص الانشغال،
بخطوة `slotStepMinutes`، لا في الماضي، والموظفة تقدّم الخدمة. المدة من المقدِّر
لهذه الزبونة بالذات.

### ٤. الحجز بلا تضارب

حجزان متزامنان (محادثتا واتساب في اللحظة نفسها) لا يأخذان الوقت نفسه: داخل
معاملة، **قفل صف الموظفة** (`SELECT … FOR UPDATE`)، ثم إعادة فحص التداخل، ثم
الإنشاء. تداخل ⇒ خطأ `SLOT_TAKEN` والوكيل يقترح غيره.

### ٥. دورة الموعد

```
BOOKED ──تأكيد──▶ CONFIRMED ──بدأت──▶ IN_PROGRESS ──خلصت──▶ DONE
   │                  │
   └──إلغاء / غياب────┴──▶ CANCELLED / NO_SHOW
```

- **بدأت**: `startedAt = now`. إن تأخّر البدء ⇒ افحص التأخير المتسلسل (٧).
- **خلصت**: `finishedAt = now`، `actualMinutes`، `finalPrice` (اقتراح مسبق: آخر
  سعر دفعته هذه الزبونة لهذه الخدمة، وإلا `priceMin`)، `notes` اختيارية.
  يحدّث `Customer.visitCount` و`lastVisitAt`.
- **غياب**: `noShowCount++`. وتلقائياً في المهمة اليومية بعد `autoNoShowMinutes`.

### ٦. التعرّف على الزبونة — تلقائي

كل رسالة واردة في متجر مفعّل: `CustomerContact` لـ (قناة، معرّف). واتساب ⇒
`Customer.phone` = الرقم، والاسم من ملف واتساب إن كان صالحاً (`displayName` القائم).
الزبونة التي تأتي بنفسها أو تتصل ⇒ تُضاف من اللوحة/التطبيق برقمها، فتُربط تلقائياً
حين تراسل لاحقاً من الرقم نفسه.

### ٧. التأخير المتسلسل

النهاية المتوقّعة للموظفة = نهاية جلستها الجارية (أو المتأخّرة في البدء). إن
تجاوزت بداية موعدها التالي بـ `delayNotifyMinutes` فأكثر، ولم نُنبّه بعد ⇒ رسالة
للزبونة التالية: نصٌّ حرّ إن كانت نافذتها مفتوحة، وإلا `delayTemplate`.
`delayNotifiedAt` يمنع التكرار. يُفحص عند «بدأت» وفي مهمة الكنس (٨).

### ٨. المهام المجدولة

`POST /api/cron/appointments` محمي بـ `Authorization: Bearer ${CRON_SECRET}`،
آمن للتكرار، يعمل لكل متجر مفعّل:

- **التذكير** (حين تكون الساعة `reminderHour` بتوقيت المتجر أو بعدها، مرة يومياً):
  مواعيد الغد `BOOKED` بلا `reminderSentAt` ⇒ `reminderTemplate`.
- **الغياب التلقائي** (القاعدة ٥).
- **التأخير** (القاعدة ٧).
- **العودة**: `DONE` لخدمة بـ `rebookAfterDays`، مرّت المدة، بلا موعد قادم، بلا
  `rebookSentAt` ⇒ `rebookTemplate`.

Vercel Hobby يسمح بمهمة يومية فقط — تُضاف في `vercel.json` يومياً، ويُوثَّق ضبط
تكرار كل ٥ دقائق من خدمة خارجية مجانية (cron-job.org) لأجل التأخير.

### ٩. ردّ الزبونة على التذكير

«تأكيد» ⇒ الوكيل يستدعي `confirm_appointment`. «إلغاء» ⇒ `cancel_appointment`،
والوقت يتحرّر فوراً لمن يسأل.

---

## أدوات الوكيل (حين `appointmentsEnabled`)

الزبونة **دائماً** صاحبة المحادثة — لا معرّف زبونة يأتي من النموذج.

| الأداة | الغرض |
|---|---|
| `list_services` | الخدمات بأسعارها (من–إلى) ومدتها **لهذه الزبونة** |
| `find_slots(service, staff?, date, dayPart?)` | حتى ٦ أوقات متاحة بأسماء الموظفات |
| `book_appointment(serviceId, staffId, startAt)` | **فقط بعد موافقة صريحة** من الزبونة |
| `my_appointments` | مواعيدها القادمة |
| `confirm_appointment(id)` · `cancel_appointment(id)` · `reschedule_appointment(id, startAt, staffId?)` | |
| `my_history` | آخر زياراته: الخدمة، التاريخ، مقدّم الخدمة، وملاحظات الزيارة |

تعليمات تُضاف للوكيل **فقط حين تكون الوحدة مفعّلة**، بلغة محايدة لا تفترض نوع
النشاط ولا جنس العميل: يسمّي العميل باسمه إن عُرف؛ يعرض مقدّم الخدمة المفضّل له
أولاً؛ السعر «من … إلى …» حين يكون نطاقاً؛ لا يحجز ولا يلغي بلا «نعم» صريحة؛
يعيد تأكيد التفاصيل بعد الحجز.

---

## واجهة الجوال — إضافة على `docs/mobile-api.md`

نفس المصادقة والأخطاء. `404` لمتجر غير مفعّل.

```
GET    /appointments?date=YYYY-MM-DD           → { staff:[Staff], items:[Appointment] }
POST   /appointments                            → حجز من التطبيق (حضوري/هاتف)
POST   /appointments/:id/start | finish | no-show | cancel | confirm
PATCH  /appointments/:id                        → { startAt?, staffId?, plannedMinutes?, notes? }
GET    /appointments/slots?serviceId&staffId?&date&customerId?
GET    /services · GET /staff · GET /staff/:id/photo   (صورة، مخبّأة) — `?all=1` يضمّ الموقوف
POST   /services · PATCH /services/:id             → إدارة الخدمات من الجوال
POST   /staff · PATCH /staff/:id                   → إدارة الفريق (serviceIds يستبدل القائمة)
PUT    /staff/:id/photo (بايتات خام، ≤١٥٠ك) · DELETE /staff/:id/photo
GET    /appointments/reports?from&to               → { report } — نفس أرقام لوحة التقارير
GET    /customers?q=   · GET /customers/:id     → ملف كامل بالتاريخ والمدد المتعلَّمة
POST   /customers  · PATCH /customers/:id       → { name?, phone?, notes?, preferredStaffId? }
```

`finish` يقبل `{ finalPrice?, notes? }`. خطأ جديد: `409 SLOT_TAKEN`.

---

## اللوحة (ويب) — `/app/appointments` لصاحب النشاط، ونسخة في `/admin/[slug]`

تظهر **فقط** حين تكون الوحدة مفعّلة للمتجر؛ وإلا لا رابط ولا تبويب ولا صفحة.

1. **اليوم**: عمود لكل مقدّم خدمة بصورته؛ المواعيد كتل بطول مدتها، وفترة الانتظار
   مخطّطة؛ الوقت الحرّ ظاهر؛ خط «الآن»؛ أزرار بدأت/خلصت/غياب.
2. **الخدمات**: إضافة وتعديل — السعر من/إلى، المدة الافتراضية، الانتظار، العودة.
3. **الفريق**: الاسم، الصورة، الدوام لكل يوم، الخدمات، العمولة.
4. **الزبائن**: بحث بالاسم/الرقم؛ ملف فيه الزيارات، المدد المتعلَّمة لكل خدمة،
   الملاحظات، الغياب.
5. **التقارير**: دخل كل فرد وعمولته، نسبة الغياب، **الوقت الذي وفّره النظام**
   (الفرق بين المخطّط القديم والفعلي) — رقم يبيع الفكرة.

---

## خارج هذه المرحلة (موثّق لا منسيّ)

- قائمة انتظار تُخطَر تلقائياً حين يتحرّر وقت.
- عربون/دفع مسبق.
- خدمات متعدّدة متتالية بموظفات مختلفات في حجز واحد.
- تسجيل المكالمات الهاتفية العادية تلقائياً — يتطلّب رقم حاضر الصوتي.

---

## واجهة المكتبة — `src/lib/appointments` (للّوحة والجوال والوكيل)

كل شيء من `@/lib/appointments`. كل دالة تأخذ `tenantId` أولاً، وكل معرّف آخر
يُطابَق معه: معرّف لمتجر آخر ⇒ `AppointmentError("NOT_FOUND")`. الأخطاء المعروفة
`AppointmentError` بـ `code ∈ NOT_FOUND | INVALID_INPUT | SLOT_TAKEN` ورسالة عربية
جاهزة للعرض. التحقق من المدخلات بمخططات zod المصدَّرة (`serviceFields`،
`staffFields`، `customerFields`، `workingHoursSchema`).

```ts
// الإعدادات والتوقيت (صافية)
settingsOf(tenant: { appointmentSettings: unknown }): AppointmentSettings
loadApptTenant(tenantId): Promise<ApptTenant>        // timezone آمن + settings
toLocal(date, tz) · zonedToUtc("YYYY-MM-DD", "HH:MM", tz) · dayBounds(date, tz)
formatLocal(date, tz) → "YYYY-MM-DD HH:MM" · parseLocal(str, tz) → Date | null

// المقدِّر والأوقات
estimateMinutes(tenantId, { serviceId, staffId?, customerId? }): Promise<Estimate>
findSlots(tenantId, { serviceId, date, staffId?, customerId?, dayPart?, limitPerStaff?, now? }): Promise<Slot[]>
dayView(tenantId, date): Promise<{ date, timezone, staff: StaffView[], services: ServiceView[], items: AppointmentView[] }>

// الحجز ودورة الموعد — كلها ترجع AppointmentView
bookAppointment(tenantId, { customerId, serviceId, staffId, startAt: Date, source, plannedMinutes?, notes? })   // SLOT_TAKEN
startAppointment(tenantId, id)        // + يجدول فحص التأخير المتسلسل بعد الرد
finishAppointment(tenantId, id, { finalPrice?, notes? })
markNoShow(tenantId, id) · cancelAppointment(tenantId, id) · confirmAppointment(tenantId, id)
rescheduleAppointment(tenantId, id, { startAt?, staffId?, plannedMinutes?, notes? })   // SLOT_TAKEN
getAppointment(tenantId, id) · upcomingFor(tenantId, customerId) · suggestedPrice(tenantId, { customerId, serviceId })

// الخدمات والفريق
listServices(tenantId, { includeInactive? }) · getService · createService(tenantId, ServiceInput) · updateService(tenantId, id, ServicePatch)
listStaff(tenantId, { includeInactive? }) · getStaff · createStaff(tenantId, StaffInput) · updateStaff(tenantId, id, StaffPatch)
setStaffServices(tenantId, staffId, serviceIds)
setStaffPhoto(tenantId, staffId, { bytes, mime? } | null)   // ≤150KB، JPEG/PNG/WebP من البايتات نفسها
getStaffPhoto(tenantId, staffId): Promise<{ bytes, mime, etag } | null>

// العملاء
upsertCustomerFromContact(tenantId, { channel, externalUserId, name? }): Promise<Customer>
createCustomer(tenantId, CustomerInput): Promise<{ customer, existed }>   // رقم موجود ⇒ نفس العميل
updateCustomer(tenantId, id, CustomerInput) · getCustomer · searchCustomers(tenantId, q, limit?)
customerProfile(tenantId, id): Promise<{ customer, channels, history, learned, upcoming }>

// المهام
runAppointmentsCron(now?): Promise<TenantCronResult[]>
```

`StaffView.photoVersion` بصمة الصورة (null بلا صورة) — المستهلك يبني الرابط.
حُفظت البصمة في عمود إضافي `Staff.photoEtag` كي لا تُقرأ بايتات الصور في كل قائمة.

### أشكال الرد في الجوال

- `Appointment`: `{ id, customerId, staffId, serviceId, customer:{id,name,phone}, staff:{id,name}, service:{id,name,priceMin,priceMax,…}, startAt, endAt, local:{date,time}, plannedMinutes, processing:{startAt,endAt}|null, status, source, startedAt, finishedAt, actualMinutes, finalPrice, suggestedPrice, notes, confirmedAt, cancelledAt }` — `suggestedPrice` للجاري فقط.
- كائن واحد ملفوف: `{ appointment }`، `{ customer }`. القوائم: `{ items }`.
- `GET /appointments` بلا `date` ⇒ اليوم بتوقيت المتجر. يُرجع `services` أيضاً.
- `POST /appointments`: `{ serviceId, staffId, startAt (ISO), customerId | customer:{phone,name?}, plannedMinutes?, source: WALK_IN|PHONE|APP, notes? }`.
- `GET /appointments/slots` ⇒ `{ date, estimate, slots:[{ startAt, local, staffId, staffName, minutes, basis }] }`.
- `Staff` ⇒ يضيف `hasPhoto` و`photoUrl` (`/api/mobile/v1/staff/:id/photo?v=<بصمة>`، مخبّأ سنة).
- `GET /customers/:id` ⇒ `{ customer, channels, history, learned:[{serviceId, serviceName, minutes, basis, samples, defaultMinutes, recentMinutes}], upcoming }`.
- `POST /customers` ⇒ `201` جديد، أو `200` مع `existed: true` لرقم مسجّل.
- انتقال غير مسموح (مثلاً `start` لموعد منتهٍ) ⇒ `400 INVALID_INPUT` برسالة عربية.

### ملاحظات تنفيذ

- الوكيل يُلزَم بساعات الدوام؛ الحجز من الفريق (حضوري/هاتف/تطبيق/لوحة) لا.
- «خلصت» مقبولة لموعد لم يُضغط له «بدأت» — يُحسب زيارةً بلا `actualMinutes` فلا يتعلّم المقدِّر رقماً مختلَقاً.
- أدوات الحجز لا تُبنى على ساحة التجربة (WEB) ولا المكالمات: لا مصدر حجز لها.
- `/api/cron/appointments` يقبل GET أيضاً (Vercel Cron ينادي بـ GET)، بنفس `CRON_SECRET`.
- متغيّرات القوالب بالترتيب: `{{1}}` اسم العميل · `{{2}}` الخدمة · `{{3}}` الوقت · `{{4}}` التاريخ · `{{5}}` مقدّم الخدمة — مقصوصة لعدد ما يطلبه القالب.
