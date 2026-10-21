import '../core/json.dart';

/// كائنات وحدة المواعيد (docs/appointments.md — «واجهة الجوال»).
///
/// العقد يسمّي النقاط ولا يثبّت شكل JSON لكل كائن؛ الأسماء هنا مأخوذة من
/// نموذج Prisma في الوثيقة نفسها، والقراءة متسامحة أكثر من بقية التطبيق:
/// الكائن قد يصل ملفوفاً (`{appointment: …}`) أو مباشرة، والسعر نصاً أو رقماً،
/// والعميل والخدمة مضمّنَين أو بمعرّفاتهما فقط. خادم يُبنى بالتوازي سيختار
/// شكلاً واحداً من هذه، والتطبيق يجب ألّا ينكسر أيّاً كان.

enum AppointmentStatus {
  booked('BOOKED', 'محجوز'),
  confirmed('CONFIRMED', 'مؤكَّد'),
  inProgress('IN_PROGRESS', 'جارٍ الآن'),
  done('DONE', 'انتهى'),
  cancelled('CANCELLED', 'ملغى'),
  noShow('NO_SHOW', 'غياب'),
  unknown('UNKNOWN', 'غير معروف');

  const AppointmentStatus(this.wire, this.label);
  final String wire;
  final String label;

  static AppointmentStatus fromWire(String? s) =>
      values.firstWhere((v) => v.wire == s, orElse: () => AppointmentStatus.unknown);

  /// ملغى أو غياب: لا يشغل وقت مقدّم الخدمة (القاعدة ٢).
  bool get releasesTime => this == cancelled || this == noShow;

  bool get isFinal => this == done || this == cancelled || this == noShow;
}

enum AppointmentSource {
  whatsapp('WHATSAPP', 'واتساب'),
  instagram('INSTAGRAM', 'إنستغرام'),
  messenger('MESSENGER', 'ماسنجر'),
  walkIn('WALK_IN', 'حضوري'),
  phone('PHONE', 'هاتف'),
  dashboard('DASHBOARD', 'لوحة الويب'),
  app('APP', 'التطبيق'),
  unknown('UNKNOWN', '');

  const AppointmentSource(this.wire, this.label);
  final String wire;
  final String label;

  static AppointmentSource fromWire(String? s) =>
      values.firstWhere((v) => v.wire == s, orElse: () => AppointmentSource.unknown);
}

/// إجراءات دورة الموعد — المسار هو `wire` (`POST /appointments/:id/<wire>`).
enum AppointmentAction {
  confirm('confirm', 'تأكيد', AppointmentStatus.confirmed),
  start('start', 'بدأت', AppointmentStatus.inProgress),
  finish('finish', 'خلصت', AppointmentStatus.done),
  noShow('no-show', 'غياب', AppointmentStatus.noShow),
  cancel('cancel', 'إلغاء', AppointmentStatus.cancelled);

  const AppointmentAction(this.wire, this.label, this.target);
  final String wire;
  final String label;

  /// الحالة بعد نجاح الإجراء — للعرض المتفائل قبل رد الخادم.
  final AppointmentStatus target;

  /// ما يُسمح به لكل حالة (الدورة في القاعدة ٥). الواجهة لا تعرض زراً
  /// سيرفضه الخادم: زر ميت أسوأ من غيابه.
  static List<AppointmentAction> allowedFor(AppointmentStatus s) => switch (s) {
        AppointmentStatus.booked => const [confirm, start, noShow, cancel],
        AppointmentStatus.confirmed => const [start, noShow, cancel],
        AppointmentStatus.inProgress => const [finish],
        _ => const [],
      };
}

enum DurationBasis {
  customer('customer', 'حسب زيارات العميل السابقة'),
  staff('staff', 'متوسط مقدّم الخدمة'),
  fallback('default', 'المدة الافتراضية'),
  unknown('', 'المدة المحجوزة');

  const DurationBasis(this.wire, this.label);
  final String wire;
  final String label;

  static DurationBasis fromWire(String? s) =>
      values.firstWhere((v) => v.wire == s && s != '', orElse: () => DurationBasis.unknown);
}

/// ناتج مُقدِّر المدة (القاعدة ١).
class DurationEstimate {
  const DurationEstimate({required this.minutes, required this.basis, this.samples = 0});

  static DurationEstimate? fromJson(JsonMap m) {
    final minutes = readInt(m, 'minutes');
    if (minutes <= 0) return null;
    return DurationEstimate(
      minutes: minutes,
      basis: DurationBasis.fromWire(readStringOrNull(m, 'basis')),
      samples: readInt(m, 'samples'),
    );
  }

  final int minutes;
  final DurationBasis basis;
  final int samples;

  JsonMap toJson() => {'minutes': minutes, 'basis': basis.wire, 'samples': samples};
}

/// فترة يومية بالدقائق من منتصف الليل (ساعات الدوام).
typedef DayRange = ({int start, int end});

class ServiceOffering {
  const ServiceOffering({
    required this.id,
    required this.name,
    this.category,
    this.priceMin = 0,
    this.priceMax,
    this.defaultMinutes = 30,
    this.processingAfterMinutes = 0,
    this.processingMinutes = 0,
    this.rebookAfterDays,
    this.active = true,
  });

  static ServiceOffering? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return ServiceOffering(
      id: id,
      name: readNonEmptyOrNull(m, 'name') ?? 'خدمة',
      category: readNonEmptyOrNull(m, 'category'),
      priceMin: readDoubleOrNull(m, 'priceMin') ?? 0,
      priceMax: readDoubleOrNull(m, 'priceMax'),
      defaultMinutes: readInt(m, 'defaultMinutes', fallback: 30).clamp(5, 24 * 60),
      processingAfterMinutes: readInt(m, 'processingAfterMinutes').clamp(0, 24 * 60),
      processingMinutes: readInt(m, 'processingMinutes').clamp(0, 24 * 60),
      rebookAfterDays: m['rebookAfterDays'] == null ? null : readInt(m, 'rebookAfterDays'),
      active: readBool(m, 'active', fallback: true),
    );
  }

  final String id;
  final String name;
  final String? category;
  final double priceMin;
  final double? priceMax;
  final int defaultMinutes;
  final int processingAfterMinutes;
  final int processingMinutes;
  final int? rebookAfterDays;
  final bool active;

  bool get hasProcessing => processingMinutes > 0;

  JsonMap toJson() => {
        'id': id,
        'name': name,
        'category': category,
        'priceMin': priceMin,
        'priceMax': priceMax,
        'defaultMinutes': defaultMinutes,
        'processingAfterMinutes': processingAfterMinutes,
        'processingMinutes': processingMinutes,
        'rebookAfterDays': rebookAfterDays,
        'active': active,
      };

  /// جسم POST/PATCH /services — بلا المعرّف (هو في المسار).
  JsonMap toBody() => toJson()..remove('id');
}

class StaffMember {
  const StaffMember({
    required this.id,
    required this.name,
    this.phone,
    this.hasPhoto = false,
    this.workingHours = const {},
    this.serviceIds,
    this.active = true,
    this.sortOrder = 0,
    this.commissionPercent,
  });

  static const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  static StaffMember? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    final hoursRaw = asMap(m['workingHours']);
    final hours = <String, List<DayRange>>{};
    for (final e in hoursRaw.entries) {
      final key = e.key.toLowerCase();
      final day = dayKeys.firstWhere((k) => key.startsWith(k), orElse: () => '');
      if (day.isEmpty) continue;
      hours[day] = [
        for (final r in asList(e.value)) ?_range(r),
      ];
    }
    final services = m.containsKey('serviceIds')
        ? readStringList(m, 'serviceIds')
        : (m.containsKey('services')
            ? [
                for (final s in asList(m['services']))
                  if (s is String) s else ?readNonEmptyOrNull(asMap(s), 'id'),
              ]
            : null);
    return StaffMember(
      id: id,
      name: readNonEmptyOrNull(m, 'name') ?? 'مقدّم خدمة',
      phone: readNonEmptyOrNull(m, 'phone'),
      // الصورة لا تأتي في القائمة (bytes). إن أرسل الخادم مؤشراً نتبعه؛ وإلا
      // نجرّب المسار مرة، والنتيجة (ولو «لا صورة») تُخبّأ فلا يتكرّر الطلب.
      hasPhoto: m.containsKey('hasPhoto') ? readBool(m, 'hasPhoto') : true,
      workingHours: hours,
      serviceIds: services,
      active: readBool(m, 'active', fallback: true),
      sortOrder: readInt(m, 'sortOrder'),
      commissionPercent: readDoubleOrNull(m, 'commissionPercent'),
    );
  }

  /// دقائق ⇒ «HH:MM» كما يقبلها الخادم (و«24:00» لنهاية اليوم).
  static String clock(int minutes) =>
      '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';

  /// جسم POST/PATCH /staff. الأيام بلا فترات تُرسل فارغة صراحةً: يوم محذوف من
  /// الخريطة يبقى بدوامه القديم عند الخادم، والمقصود «عطلة».
  JsonMap toBody() => {
        'name': name,
        'phone': phone,
        'workingHours': {
          for (final d in dayKeys)
            d: [
              for (final r in workingHours[d] ?? const <DayRange>[]) [clock(r.start), clock(r.end)],
            ],
        },
        'commissionPercent': commissionPercent,
        'active': active,
        'sortOrder': sortOrder,
        'serviceIds': ?serviceIds,
      };

  /// «10:00»–«14:00» ⇒ دقائق. فترة مقلوبة أو تالفة تُسقط وحدها.
  static DayRange? _range(Object? raw) {
    final l = asList(raw);
    if (l.length < 2) return null;
    final a = parseClock(l[0]);
    final b = parseClock(l[1]);
    if (a == null || b == null || b <= a) return null;
    return (start: a, end: b);
  }

  static int? parseClock(Object? v) {
    if (v is! String) return null;
    final p = v.trim().split(':');
    if (p.length < 2) return null;
    final h = int.tryParse(p[0]);
    final m = int.tryParse(p[1]);
    if (h == null || m == null || h < 0 || h > 24 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  final String id;
  final String name;
  final String? phone;
  final bool hasPhoto;
  final Map<String, List<DayRange>> workingHours;

  /// الخدمات التي تقدّمها؛ null = غير معروف (لا نُخفي أحداً بسبب نقص بيانات).
  final List<String>? serviceIds;
  final bool active;
  final int sortOrder;

  /// نسبة مقدّم الخدمة من دخل زياراته — للتقارير.
  final double? commissionPercent;

  List<DayRange> hoursOn(DateTime day) => workingHours[dayKeys[day.weekday - 1]] ?? const [];

  bool offers(String serviceId) => serviceIds == null || serviceIds!.contains(serviceId);
}

/// العميل كما يُضمَّن في الموعد.
class CustomerRef {
  const CustomerRef({required this.id, this.name, this.phone});

  static CustomerRef? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return CustomerRef(id: id, name: readNonEmptyOrNull(m, 'name'), phone: readNonEmptyOrNull(m, 'phone'));
  }

  final String id;
  final String? name;
  final String? phone;
}

class Appointment {
  const Appointment({
    required this.id,
    required this.customerId,
    required this.staffId,
    required this.serviceId,
    required this.startAt,
    required this.plannedMinutes,
    required this.status,
    this.source = AppointmentSource.unknown,
    this.startedAt,
    this.finishedAt,
    this.actualMinutes,
    this.finalPrice,
    this.suggestedPrice,
    this.notes,
    this.customer,
    this.service,
    this.estimate,
  });

  static Appointment? fromJson(JsonMap raw) {
    // ملفوف أو مباشر
    final m = raw.containsKey('appointment') ? asMap(raw['appointment']) : raw;
    final id = readNonEmptyOrNull(m, 'id');
    final startAt = readDateOrNull(m, 'startAt');
    if (id == null || startAt == null) return null;
    final customer = CustomerRef.fromJson(asMap(m['customer']));
    final service = ServiceOffering.fromJson(asMap(m['service']));
    final staff = asMap(m['staff']);
    return Appointment(
      id: id,
      customerId: readNonEmptyOrNull(m, 'customerId') ?? customer?.id ?? '',
      staffId: readNonEmptyOrNull(m, 'staffId') ?? readString(staff, 'id'),
      serviceId: readNonEmptyOrNull(m, 'serviceId') ?? service?.id ?? '',
      startAt: startAt,
      plannedMinutes: readInt(m, 'plannedMinutes', fallback: service?.defaultMinutes ?? 30).clamp(5, 24 * 60),
      status: AppointmentStatus.fromWire(readStringOrNull(m, 'status')),
      source: AppointmentSource.fromWire(readStringOrNull(m, 'source')),
      startedAt: readDateOrNull(m, 'startedAt'),
      finishedAt: readDateOrNull(m, 'finishedAt'),
      actualMinutes: m['actualMinutes'] == null ? null : readInt(m, 'actualMinutes'),
      finalPrice: readDoubleOrNull(m, 'finalPrice'),
      suggestedPrice: readDoubleOrNull(m, 'suggestedPrice'),
      notes: readNonEmptyOrNull(m, 'notes'),
      customer: customer,
      service: service,
      estimate: DurationEstimate.fromJson(asMap(m['estimate'])),
    );
  }

  final String id;
  final String customerId;
  final String staffId;
  final String serviceId;
  final DateTime startAt;
  final int plannedMinutes;
  final AppointmentStatus status;
  final AppointmentSource source;
  final DateTime? startedAt;
  final DateTime? finishedAt;
  final int? actualMinutes;
  final double? finalPrice;

  /// اقتراح السعر عند «خلصت» (آخر ما دفعته لهذه الخدمة) إن أرسله الخادم.
  final double? suggestedPrice;
  final String? notes;
  final CustomerRef? customer;
  final ServiceOffering? service;

  /// أساس المدة المحجوزة إن أرسله الخادم — ليثق الفريق بالرقم.
  final DurationEstimate? estimate;

  DateTime get plannedEnd => startAt.add(Duration(minutes: plannedMinutes));

  Appointment copyWith({
    AppointmentStatus? status,
    DateTime? startedAt,
    DateTime? finishedAt,
    int? actualMinutes,
    double? finalPrice,
    String? notes,
    DateTime? startAt,
    String? staffId,
    int? plannedMinutes,
  }) =>
      Appointment(
        id: id,
        customerId: customerId,
        staffId: staffId ?? this.staffId,
        serviceId: serviceId,
        startAt: startAt ?? this.startAt,
        plannedMinutes: plannedMinutes ?? this.plannedMinutes,
        status: status ?? this.status,
        source: source,
        startedAt: startedAt ?? this.startedAt,
        finishedAt: finishedAt ?? this.finishedAt,
        actualMinutes: actualMinutes ?? this.actualMinutes,
        finalPrice: finalPrice ?? this.finalPrice,
        suggestedPrice: suggestedPrice,
        notes: notes ?? this.notes,
        customer: customer,
        service: service,
        estimate: estimate,
      );
}

extension AppointmentTimes on Appointment {
  /// نسخة بكل أوقاتها محوّلة — لتحويل لحظات الخادم إلى وقت جدار المتجر.
  Appointment mapTimes(DateTime Function(DateTime) f) => Appointment(
        id: id,
        customerId: customerId,
        staffId: staffId,
        serviceId: serviceId,
        startAt: f(startAt),
        plannedMinutes: plannedMinutes,
        status: status,
        source: source,
        startedAt: startedAt == null ? null : f(startedAt!),
        finishedAt: finishedAt == null ? null : f(finishedAt!),
        actualMinutes: actualMinutes,
        finalPrice: finalPrice,
        suggestedPrice: suggestedPrice,
        notes: notes,
        customer: customer,
        service: service,
        estimate: estimate,
      );
}

class AppointmentDay {
  const AppointmentDay({required this.staff, required this.items, this.services = const []});

  factory AppointmentDay.fromJson(JsonMap m) => AppointmentDay(
        staff: readList(m, 'staff', StaffMember.fromJson),
        items: readList(m, 'items', Appointment.fromJson),
        services: readList(m, 'services', ServiceOffering.fromJson),
      );

  final List<StaffMember> staff;
  final List<Appointment> items;

  /// قد يضمّنها الخادم لتوفير طلب؛ وإلا تأتي من GET /services.
  final List<ServiceOffering> services;
}

class SlotOption {
  const SlotOption({required this.startAt, required this.staffId});

  static SlotOption? fromJson(JsonMap m) {
    final at = readDateOrNull(m, 'startAt');
    if (at == null) return null;
    return SlotOption(startAt: at, staffId: readString(m, 'staffId'));
  }

  final DateTime startAt;
  final String staffId;
}

class SlotsResult {
  const SlotsResult({required this.slots, this.estimate});

  factory SlotsResult.fromJson(JsonMap m) => SlotsResult(
        slots: readList(m, m.containsKey('slots') ? 'slots' : 'items', SlotOption.fromJson),
        estimate: DurationEstimate.fromJson(asMap(m['estimate'])),
      );

  final List<SlotOption> slots;
  final DurationEstimate? estimate;
}

class Customer {
  const Customer({
    required this.id,
    this.name,
    this.phone,
    this.notes,
    this.preferredStaffId,
    this.visitCount = 0,
    this.noShowCount = 0,
    this.lastVisitAt,
  });

  static Customer? fromJson(JsonMap raw) {
    final m = raw.containsKey('customer') ? asMap(raw['customer']) : raw;
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return Customer(
      id: id,
      name: readNonEmptyOrNull(m, 'name'),
      phone: readNonEmptyOrNull(m, 'phone'),
      notes: readNonEmptyOrNull(m, 'notes'),
      preferredStaffId: readNonEmptyOrNull(m, 'preferredStaffId'),
      visitCount: readInt(m, 'visitCount').clamp(0, 1 << 30),
      noShowCount: readInt(m, 'noShowCount').clamp(0, 1 << 30),
      lastVisitAt: readDateOrNull(m, 'lastVisitAt'),
    );
  }

  final String id;
  final String? name;
  final String? phone;
  final String? notes;
  final String? preferredStaffId;
  final int visitCount;
  final int noShowCount;
  final DateTime? lastVisitAt;

  CustomerRef get ref => CustomerRef(id: id, name: name, phone: phone);
}

class CustomerVisit {
  const CustomerVisit({
    required this.appointmentId,
    required this.at,
    required this.status,
    this.serviceName,
    this.staffName,
    this.actualMinutes,
    this.plannedMinutes,
    this.finalPrice,
    this.notes,
  });

  static CustomerVisit? fromJson(JsonMap m) {
    final a = Appointment.fromJson(m);
    final at = readDateOrNull(m, 'startAt') ?? readDateOrNull(m, 'at');
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null || at == null) return null;
    return CustomerVisit(
      appointmentId: id,
      at: at,
      status: AppointmentStatus.fromWire(readStringOrNull(m, 'status')),
      serviceName: readNonEmptyOrNull(m, 'serviceName') ?? a?.service?.name,
      staffName: readNonEmptyOrNull(m, 'staffName') ?? readNonEmptyOrNull(asMap(m['staff']), 'name'),
      actualMinutes: m['actualMinutes'] == null ? null : readInt(m, 'actualMinutes'),
      plannedMinutes: m['plannedMinutes'] == null ? null : readInt(m, 'plannedMinutes'),
      finalPrice: readDoubleOrNull(m, 'finalPrice'),
      notes: readNonEmptyOrNull(m, 'notes'),
    );
  }

  final String appointmentId;
  final DateTime at;
  final AppointmentStatus status;
  final String? serviceName;
  final String? staffName;
  final int? actualMinutes;
  final int? plannedMinutes;
  final double? finalPrice;
  final String? notes;
}

/// المدة المتعلَّمة لهذا العميل في خدمة.
class LearnedDuration {
  const LearnedDuration({required this.serviceId, required this.serviceName, required this.minutes, this.samples = 0});

  static LearnedDuration? fromJson(JsonMap m) {
    final minutes = readInt(m, 'minutes');
    if (minutes <= 0) return null;
    return LearnedDuration(
      serviceId: readString(m, 'serviceId'),
      serviceName: readNonEmptyOrNull(m, 'serviceName') ?? readNonEmptyOrNull(asMap(m['service']), 'name') ?? 'خدمة',
      minutes: minutes,
      samples: readInt(m, 'samples'),
    );
  }

  final String serviceId;
  final String serviceName;
  final int minutes;
  final int samples;
}

class CustomerProfile {
  const CustomerProfile({
    required this.customer,
    this.visits = const [],
    this.durations = const [],
    this.upcoming = const [],
  });

  static CustomerProfile? fromJson(JsonMap m) {
    final c = Customer.fromJson(m);
    if (c == null) return null;
    return CustomerProfile(
      customer: c,
      visits: readList(m, m.containsKey('visits') ? 'visits' : 'history', CustomerVisit.fromJson),
      durations: readList(m, m.containsKey('durations') ? 'durations' : 'learned', LearnedDuration.fromJson),
      upcoming: readList(m, 'upcoming', Appointment.fromJson),
    );
  }

  final Customer customer;
  final List<CustomerVisit> visits;
  final List<LearnedDuration> durations;
  final List<Appointment> upcoming;
}

/// جسم POST /appointments من التطبيق (حضوري/هاتف).
class NewAppointment {
  const NewAppointment({
    required this.serviceId,
    required this.staffId,
    required this.startAt,
    this.customerId,
    this.newCustomerPhone,
    this.newCustomerName,
    this.plannedMinutes,
    this.source = AppointmentSource.walkIn,
    this.notes,
  });

  final String serviceId;
  final String staffId;
  final DateTime startAt;
  final String? customerId;
  final String? newCustomerPhone;
  final String? newCustomerName;
  final int? plannedMinutes;
  final AppointmentSource source;
  final String? notes;

  JsonMap toJson() => {
        'serviceId': serviceId,
        'staffId': staffId,
        'startAt': startAt.toUtc().toIso8601String(),
        'customerId': ?customerId,
        if (customerId == null && newCustomerPhone != null)
          'customer': {'phone': newCustomerPhone, 'name': ?newCustomerName},
        'plannedMinutes': ?plannedMinutes,
        'source': source.wire,
        if (notes != null && notes!.trim().isNotEmpty) 'notes': notes!.trim(),
      };
}

/// تاريخ اليوم بصيغة العقد (`YYYY-MM-DD`) — بتوقيت الجهاز (انظر تقرير العقد).
String isoDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// تقرير فترة (GET /appointments/reports) — نفس أرقام لوحة التقارير.
class AppointmentReport {
  const AppointmentReport({
    required this.from,
    required this.to,
    this.visits = 0,
    this.revenue = 0,
    this.noShows = 0,
    this.cancelled = 0,
    this.noShowRate = 0,
    this.minutesSaved = 0,
    this.staff = const [],
    this.topServices = const [],
  });

  factory AppointmentReport.fromJson(JsonMap raw) {
    final m = raw.containsKey('report') ? asMap(raw['report']) : raw;
    return AppointmentReport(
      from: readString(m, 'from'),
      to: readString(m, 'to'),
      visits: readInt(m, 'visits'),
      revenue: readDoubleOrNull(m, 'revenue') ?? 0,
      noShows: readInt(m, 'noShows'),
      cancelled: readInt(m, 'cancelled'),
      noShowRate: readDoubleOrNull(m, 'noShowRate') ?? 0,
      minutesSaved: readInt(m, 'minutesSaved'),
      staff: [
        for (final s in asList(m['staff']))
          (
            staffId: readString(asMap(s), 'staffId'),
            name: readString(asMap(s), 'name'),
            visits: readInt(asMap(s), 'visits'),
            revenue: readDoubleOrNull(asMap(s), 'revenue') ?? 0,
            commission: readDoubleOrNull(asMap(s), 'commission') ?? 0,
          ),
      ],
      topServices: [
        for (final s in asList(m['topServices']))
          (
            serviceId: readString(asMap(s), 'serviceId'),
            name: readString(asMap(s), 'name'),
            visits: readInt(asMap(s), 'visits'),
            revenue: readDoubleOrNull(asMap(s), 'revenue') ?? 0,
          ),
      ],
    );
  }

  final String from;
  final String to;
  final int visits;
  final double revenue;
  final int noShows;
  final int cancelled;

  /// من ٠ إلى ١.
  final double noShowRate;
  final int minutesSaved;
  final List<({String staffId, String name, int visits, double revenue, double commission})> staff;
  final List<({String serviceId, String name, int visits, double revenue})> topServices;
}
