import '../../core/errors.dart';
import '../appointments.dart';
import '../schedule.dart';

/// نشاط وهمي بالمواعيد في الذاكرة، يطبّق قواعد docs/appointments.md نفسها:
/// المقدِّر بالوسيط، الانشغال بالفعلي، وقت الانتظار الحرّ، SLOT_TAKEN، ودورة
/// الحالات.
///
/// البيانات عمداً من أنشطة مختلفة (صالون، عيادة، صيانة سيارات): الوحدة لكل
/// نشاط بالمواعيد، وأي نص في الواجهة يفترض نشاطاً واحداً سيظهر غريباً هنا
/// قبل أن يظهر عند عميل حقيقي.
///
/// القواعد نفسها في `schedule.dart` تستخدمها الواجهة أيضاً، فما يقترحه هذا
/// «الخادم» هو بالضبط ما ترسمه الشاشة حرّاً.
class FakeBookings {
  FakeBookings({required this.now}) {
    _seed();
  }

  final DateTime Function() now;
  DateTime _now() => now();
  int _seq = 1;

  final Map<String, ServiceOffering> services = {};
  final List<StaffMember> staff = [];
  final Map<String, Customer> customers = {};
  final Map<String, Appointment> appointments = {};

  static const stepMinutes = 15;

  // ───────────── البذور ─────────────

  static List<DayRange> _h(String a, String b) =>
      [(start: StaffMember.parseClock(a)!, end: StaffMember.parseClock(b)!)];

  void _seed() {
    for (final s in const [
      // صالون
      ServiceOffering(id: 'svc_cut', name: 'قص شعر', category: 'شعر', priceMin: 8, priceMax: 15, defaultMinutes: 45, rebookAfterDays: 42),
      ServiceOffering(
        id: 'svc_color',
        name: 'لون كامل',
        category: 'شعر',
        priceMin: 35,
        priceMax: 60,
        defaultMinutes: 120,
        processingAfterMinutes: 30,
        processingMinutes: 40,
        rebookAfterDays: 35,
      ),
      ServiceOffering(id: 'svc_quick', name: 'خدمة سريعة (١٥ د)', category: 'شعر', priceMin: 3, defaultMinutes: 15),
      // عيادة
      ServiceOffering(id: 'svc_checkup', name: 'كشف عام', category: 'عيادة', priceMin: 15, priceMax: 25, defaultMinutes: 20),
      ServiceOffering(
        id: 'svc_dental',
        name: 'حشوة أسنان',
        category: 'عيادة',
        priceMin: 30,
        priceMax: 50,
        defaultMinutes: 60,
        // التخدير يسري: الطبيب حرّ لكشف قصير بينها
        processingAfterMinutes: 5,
        processingMinutes: 15,
      ),
      ServiceOffering(id: 'svc_cleaning', name: 'تنظيف أسنان', category: 'عيادة', priceMin: 20, defaultMinutes: 40, rebookAfterDays: 180),
      // صيانة سيارات
      ServiceOffering(id: 'svc_oil', name: 'تغيير زيت وفلاتر', category: 'سيارات', priceMin: 25, priceMax: 40, defaultMinutes: 45, rebookAfterDays: 90),
      ServiceOffering(id: 'svc_service', name: 'صيانة دورية', category: 'سيارات', priceMin: 60, priceMax: 120, defaultMinutes: 150),
    ]) {
      services[s.id] = s;
    }

    final split = [..._h('10:00', '14:00'), ..._h('16:00', '21:00')];
    final weekdays = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'];
    staff.addAll([
      StaffMember(
        id: 'st_rana',
        name: 'رنا',
        hasPhoto: false,
        workingHours: {for (final d in weekdays) d: split, 'fri': _h('12:00', '20:00')},
        serviceIds: const ['svc_cut', 'svc_color', 'svc_quick'],
      ),
      StaffMember(
        id: 'st_samer',
        name: 'د. سامر',
        hasPhoto: false,
        workingHours: {for (final d in [...weekdays, 'fri']) d: _h('11:00', '20:00')},
        serviceIds: const ['svc_checkup', 'svc_dental', 'svc_cleaning'],
        sortOrder: 1,
      ),
      StaffMember(
        id: 'st_dina',
        name: 'دينا',
        hasPhoto: false,
        workingHours: {for (final d in weekdays) d: _h('10:00', '18:00')},
        serviceIds: const ['svc_cut', 'svc_quick'],
        sortOrder: 2,
      ),
      StaffMember(
        id: 'st_khaled',
        name: 'خالد — الورشة',
        hasPhoto: false,
        workingHours: {for (final d in [...weekdays, 'fri']) d: _h('09:00', '19:00')},
        serviceIds: const ['svc_oil', 'svc_service'],
        sortOrder: 3,
      ),
    ]);

    for (final c in const [
      Customer(id: 'cu_sara', name: 'سارة الخطيب', phone: '+962791234567', notes: 'حساسية من الأمونيا — منتجات بدونها فقط.', preferredStaffId: 'st_rana'),
      Customer(id: 'cu_leen', name: 'لين حداد', phone: '+962785551122', notes: 'تفضّل المواعيد الصباحية.', preferredStaffId: 'st_dina'),
      Customer(id: 'cu_reem', name: 'ريم العلي', phone: '+962777100200'),
      Customer(id: 'cu_omar', name: 'عمر الشريف', phone: '+962790011223', notes: 'يخاف من الإبر — يحتاج وقتاً قبل التخدير.', preferredStaffId: 'st_samer'),
      Customer(id: 'cu_hala', name: 'هلا البدور', phone: '+962790001122'),
      Customer(id: 'cu_dana', name: 'دانة القيسي', phone: '+962781234000'),
      Customer(id: 'cu_mai', name: 'مي الزعبي', phone: '+962799887766'),
      Customer(id: 'cu_anon', name: null, phone: '+962776655443'),
      Customer(id: 'cu_yazan', name: 'يزن العمري', phone: '+962795554433', notes: 'تويوتا كامري 2019 — لوحة 12-34567', preferredStaffId: 'st_khaled'),
    ]) {
      customers[c.id] = c;
    }

    final now = _now().toLocal();
    final today = DateTime(now.year, now.month, now.day);

    // تاريخ يغذّي المقدِّر: قصة سارة ~١٥–٢٠ د وقصة لين ~ساعة — المشكلة كما في الوثيقة.
    void past(String cu, String st, String svc, int daysAgo, String at, int planned, int actual, {double? price, String? notes}) {
      final start = today.subtract(Duration(days: daysAgo)).add(Duration(minutes: StaffMember.parseClock(at)!));
      _add(Appointment(
        id: 'ap_${_seq++}',
        customerId: cu,
        staffId: st,
        serviceId: svc,
        startAt: start.toUtc(),
        plannedMinutes: planned,
        status: AppointmentStatus.done,
        source: AppointmentSource.whatsapp,
        startedAt: start.toUtc(),
        finishedAt: start.add(Duration(minutes: actual)).toUtc(),
        actualMinutes: actual,
        finalPrice: price ?? services[svc]!.priceMin,
        notes: notes,
      ));
    }

    past('cu_sara', 'st_rana', 'svc_cut', 70, '11:00', 45, 15, price: 10);
    past('cu_sara', 'st_rana', 'svc_cut', 40, '12:00', 45, 18, price: 10);
    past('cu_sara', 'st_rana', 'svc_color', 34, '16:00', 120, 110, price: 45, notes: 'رقم اللون 7.1 بدون أمونيا + مثبّت 6% — انتظار 35 د');
    past('cu_sara', 'st_rana', 'svc_cut', 12, '17:30', 45, 20, price: 12);
    past('cu_leen', 'st_dina', 'svc_cut', 60, '10:30', 45, 60, price: 15);
    past('cu_leen', 'st_dina', 'svc_cut', 30, '13:00', 45, 65, price: 15);
    past('cu_omar', 'st_samer', 'svc_checkup', 45, '12:00', 20, 35, price: 20, notes: 'ضغط 130/85 — مراجعة بعد شهر');
    past('cu_omar', 'st_samer', 'svc_checkup', 14, '13:00', 20, 30, price: 15, notes: 'ضغط 125/80 — تحسّن');
    past('cu_reem', 'st_dina', 'svc_cut', 25, '11:00', 45, 40);
    past('cu_mai', 'st_dina', 'svc_cut', 18, '12:30', 45, 45);
    past('cu_yazan', 'st_khaled', 'svc_oil', 95, '10:00', 45, 50, price: 32, notes: 'زيت 5W-30، فلتر هواء جديد — العدّاد 84,200 كم');
    past('cu_hala', 'st_samer', 'svc_cleaning', 190, '16:00', 40, 45, price: 20);

    final noShow = Appointment(
      id: 'ap_${_seq++}',
      customerId: 'cu_mai',
      staffId: 'st_dina',
      serviceId: 'svc_cut',
      startAt: today.subtract(const Duration(days: 6)).add(const Duration(hours: 15)).toUtc(),
      plannedMinutes: 45,
      status: AppointmentStatus.noShow,
      source: AppointmentSource.instagram,
    );
    _add(noShow);
    customers['cu_mai'] = _withCounts(customers['cu_mai']!, noShow: 1);

    // اليوم: مرسوم حول «الآن» (مقصوراً على ساعات العمل) كي تظهر كل الحالات
    // معاً في أي وقت يُفتح فيه التطبيق.
    final minuteOfDay = (now.hour * 60 + now.minute).clamp(12 * 60 + 30, 17 * 60);
    final anchor = today.add(Duration(minutes: minuteOfDay - minuteOfDay % 15));
    DateTime at(int deltaMinutes) => anchor.add(Duration(minutes: deltaMinutes));

    void todayAt(String cu, String st, String svc, int delta, int planned, AppointmentStatus status,
        {AppointmentSource source = AppointmentSource.whatsapp, int? startedDelta, int? actual, String? notes}) {
      final start = at(delta);
      final started = startedDelta == null ? null : at(startedDelta);
      _add(Appointment(
        id: 'ap_${_seq++}',
        customerId: cu,
        staffId: st,
        serviceId: svc,
        startAt: start.toUtc(),
        plannedMinutes: planned,
        status: status,
        source: source,
        startedAt: started?.toUtc(),
        finishedAt: actual == null || started == null ? null : started.add(Duration(minutes: actual)).toUtc(),
        actualMinutes: actual,
        finalPrice: status == AppointmentStatus.done ? services[svc]!.priceMin : null,
        notes: notes,
      ));
    }

    // رنا: قصة انتهت بدري، لون جارٍ وفي وقت انتظاره خدمة سريعة، ثم قصة سارة.
    todayAt('cu_reem', 'st_rana', 'svc_cut', -180, 40, AppointmentStatus.done, startedDelta: -178, actual: 35);
    todayAt('cu_dana', 'st_rana', 'svc_color', -40, 120, AppointmentStatus.inProgress, startedDelta: -40);
    todayAt('cu_anon', 'st_rana', 'svc_quick', 0, 15, AppointmentStatus.confirmed, source: AppointmentSource.phone);
    todayAt('cu_sara', 'st_rana', 'svc_cut', 105, 20, AppointmentStatus.booked);
    // د. سامر: إلغاء، كشف عمر جارٍ (أطول من المعتاد حسب تاريخه)، حشوة لاحقاً.
    todayAt('cu_mai', 'st_samer', 'svc_checkup', -120, 20, AppointmentStatus.cancelled, source: AppointmentSource.instagram);
    todayAt('cu_omar', 'st_samer', 'svc_checkup', -15, 35, AppointmentStatus.inProgress, startedDelta: -10);
    todayAt('cu_hala', 'st_samer', 'svc_dental', 60, 60, AppointmentStatus.booked, source: AppointmentSource.walkIn);
    // دينا: لين بقصة ساعة (من تاريخها) — ما كان سيؤخّر الكل لو حُجزت ٤٥ د.
    todayAt('cu_leen', 'st_dina', 'svc_cut', 30, 65, AppointmentStatus.confirmed);
    // الورشة: صيانة دورية طويلة.
    todayAt('cu_yazan', 'st_khaled', 'svc_service', -60, 150, AppointmentStatus.inProgress, startedDelta: -55);

    // غداً: ليرى المالك أن اليوم التالي ليس فارغاً.
    final tomorrow = today.add(const Duration(days: 1));
    _add(Appointment(
      id: 'ap_${_seq++}',
      customerId: 'cu_sara',
      staffId: 'st_rana',
      serviceId: 'svc_color',
      startAt: tomorrow.add(const Duration(hours: 11)).toUtc(),
      plannedMinutes: 115,
      status: AppointmentStatus.booked,
      source: AppointmentSource.whatsapp,
    ));
  }

  Appointment _add(Appointment a) {
    final svc = services[a.serviceId];
    final cu = customers[a.customerId];
    final full = Appointment(
      id: a.id,
      customerId: a.customerId,
      staffId: a.staffId,
      serviceId: a.serviceId,
      startAt: a.startAt,
      plannedMinutes: a.plannedMinutes,
      status: a.status,
      source: a.source,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      actualMinutes: a.actualMinutes,
      finalPrice: a.finalPrice,
      suggestedPrice: a.suggestedPrice ?? _suggestedPrice(a.customerId, a.serviceId),
      notes: a.notes,
      customer: cu?.ref ?? a.customer,
      service: svc ?? a.service,
      estimate: a.estimate ?? _estimateFor(a.customerId, a.staffId, a.serviceId, excludeId: a.id),
    );
    appointments[full.id] = full;
    return full;
  }

  static Customer _withCounts(Customer c, {int visit = 0, int noShow = 0, DateTime? lastVisitAt, String? notes, String? name, String? phone, String? preferredStaffId}) =>
      Customer(
        id: c.id,
        name: name ?? c.name,
        phone: phone ?? c.phone,
        notes: notes ?? c.notes,
        preferredStaffId: preferredStaffId ?? c.preferredStaffId,
        visitCount: c.visitCount + visit,
        noShowCount: c.noShowCount + noShow,
        lastVisitAt: lastVisitAt ?? c.lastVisitAt,
      );

  // ───────────── القواعد ─────────────

  List<Appointment> _doneNewestFirst(bool Function(Appointment) where) => appointments.values
      .where((a) => a.status == AppointmentStatus.done && a.actualMinutes != null && where(a))
      .toList()
    ..sort((a, b) => b.startAt.compareTo(a.startAt));

  DurationEstimate _estimateFor(String customerId, String? staffId, String serviceId, {String? excludeId}) {
    final svc = services[serviceId];
    return estimateDuration(
      customerActuals: [
        for (final a in _doneNewestFirst((a) => a.customerId == customerId && a.serviceId == serviceId && a.id != excludeId))
          a.actualMinutes!,
      ],
      staffActuals: staffId == null
          ? const []
          : [
              for (final a in _doneNewestFirst((a) => a.staffId == staffId && a.serviceId == serviceId && a.id != excludeId))
                a.actualMinutes!,
            ],
      defaultMinutes: svc?.defaultMinutes ?? 30,
    );
  }

  double? _suggestedPrice(String customerId, String serviceId) {
    final last = _doneNewestFirst((a) => a.customerId == customerId && a.serviceId == serviceId && a.finalPrice != null);
    return last.isEmpty ? services[serviceId]?.priceMin : last.first.finalPrice;
  }

  List<Appointment> _staffDay(String staffId, DateTime day) => appointments.values
      .where((a) => a.staffId == staffId && _sameDay(a.startAt.toLocal(), day))
      .toList();

  static bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  static DateTime parseDay(String date) {
    final p = date.split('-');
    final d = p.length == 3
        ? DateTime(int.tryParse(p[0]) ?? 0, int.tryParse(p[1]) ?? 1, int.tryParse(p[2]) ?? 1)
        : null;
    if (d == null || d.year < 2000) {
      throw const ApiError(ApiErrorCode.invalidInput, 'تاريخ غير صحيح.', status: 400);
    }
    return d;
  }

  // ───────────── النقاط ─────────────

  AppointmentDay day(String date) {
    final d = parseDay(date);
    final items = appointments.values.where((a) => _sameDay(a.startAt.toLocal(), d)).toList()
      ..sort((a, b) => a.startAt.compareTo(b.startAt));
    return AppointmentDay(
      staff: [...staff]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder)),
      items: items,
      services: services.values.toList(),
    );
  }

  SlotsResult slots({required String serviceId, String? staffId, required String date, String? customerId}) {
    final svc = services[serviceId];
    if (svc == null) {
      throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404);
    }
    final d = parseDay(date);
    final now = _now();
    final candidates = staff.where((s) => s.active && s.offers(serviceId) && (staffId == null || s.id == staffId));
    final out = <SlotOption>[];
    DurationEstimate? shown;
    for (final s in candidates) {
      final est = customerId == null
          ? estimateDuration(customerActuals: const [], staffActuals: const [], defaultMinutes: svc.defaultMinutes)
          : _estimateFor(customerId, s.id, serviceId);
      shown ??= est;
      for (final t in freeStarts(
        day: d,
        hours: s.hoursOn(d),
        minutes: est.minutes,
        serviceOf: (a) => services[a.serviceId],
        staffAppointments: _staffDay(s.id, d),
        now: now,
        service: svc,
        stepMinutes: stepMinutes,
      )) {
        out.add(SlotOption(startAt: t.toUtc(), staffId: s.id));
      }
    }
    out.sort((a, b) {
      final c = a.startAt.compareTo(b.startAt);
      return c != 0 ? c : a.staffId.compareTo(b.staffId);
    });
    return SlotsResult(slots: out, estimate: shown);
  }

  Appointment create(NewAppointment r) {
    final svc = services[r.serviceId];
    final st = staff.where((s) => s.id == r.staffId).firstOrNull;
    if (svc == null || st == null) {
      throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404);
    }
    if (!st.offers(svc.id)) {
      throw const ApiError(ApiErrorCode.invalidInput, 'مقدّم الخدمة هذا لا يقدّم هذه الخدمة.', status: 400);
    }
    Customer cu;
    if (r.customerId != null) {
      cu = customers[r.customerId] ??
          (throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404));
    } else if (r.newCustomerPhone != null) {
      cu = createCustomer(phone: r.newCustomerPhone!, name: r.newCustomerName);
    } else {
      throw const ApiError(ApiErrorCode.invalidInput, 'اختر زبونة أو أدخل رقمها.', status: 400);
    }
    final minutes = r.plannedMinutes ?? _estimateFor(cu.id, st.id, svc.id).minutes;
    final now = _now();
    final candidate = Appointment(
      id: '_new',
      customerId: cu.id,
      staffId: st.id,
      serviceId: svc.id,
      startAt: r.startAt.toUtc(),
      plannedMinutes: minutes,
      status: AppointmentStatus.booked,
    );
    // القاعدة ٤: إعادة فحص التداخل لحظة الإنشاء — حجزان متزامنان لا يأخذان الوقت نفسه.
    final mine = busySegments(candidate, svc, now);
    final taken = [
      for (final a in _staffDay(st.id, r.startAt.toLocal())) ...busySegments(a, services[a.serviceId], now),
    ];
    if (segmentsConflict(mine, taken)) {
      throw ApiError(ApiErrorCode.slotTaken, ApiError.defaultMessage(ApiErrorCode.slotTaken), status: 409);
    }
    return _add(Appointment(
      id: 'ap_${_seq++}',
      customerId: cu.id,
      staffId: st.id,
      serviceId: svc.id,
      startAt: r.startAt.toUtc(),
      plannedMinutes: minutes,
      status: AppointmentStatus.booked,
      source: r.source,
      notes: r.notes,
    ));
  }

  Appointment act(String id, AppointmentAction action, {double? finalPrice, String? notes}) {
    final a = appointments[id] ??
        (throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404));
    if (!AppointmentAction.allowedFor(a.status).contains(action)) {
      throw const ApiError(ApiErrorCode.unknown, 'لا يمكن هذا الإجراء في حالة الموعد الحالية.', status: 409);
    }
    final now = _now();
    Appointment next;
    switch (action) {
      case AppointmentAction.confirm:
        next = a.copyWith(status: AppointmentStatus.confirmed);
      case AppointmentAction.start:
        next = a.copyWith(status: AppointmentStatus.inProgress, startedAt: now);
      case AppointmentAction.finish:
        final started = a.startedAt ?? a.startAt;
        final actual = now.difference(started).inSeconds / 60;
        next = a.copyWith(
          status: AppointmentStatus.done,
          finishedAt: now,
          actualMinutes: actual.round().clamp(1, 24 * 60),
          finalPrice: finalPrice ?? a.suggestedPrice ?? services[a.serviceId]?.priceMin,
          notes: notes,
        );
        final cu = customers[a.customerId];
        if (cu != null) customers[cu.id] = _withCounts(cu, visit: 1, lastVisitAt: now);
      case AppointmentAction.noShow:
        next = a.copyWith(status: AppointmentStatus.noShow);
        final cu = customers[a.customerId];
        if (cu != null) customers[cu.id] = _withCounts(cu, noShow: 1);
      case AppointmentAction.cancel:
        next = a.copyWith(status: AppointmentStatus.cancelled);
    }
    appointments[id] = next;
    return next;
  }

  Appointment update(String id, {DateTime? startAt, String? staffId, int? plannedMinutes, String? notes}) {
    final a = appointments[id] ??
        (throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404));
    final next = a.copyWith(startAt: startAt?.toUtc(), staffId: staffId, plannedMinutes: plannedMinutes, notes: notes);
    if (startAt != null || staffId != null || plannedMinutes != null) {
      final now = _now();
      final mine = busySegments(next, services[next.serviceId], now);
      final taken = [
        for (final o in _staffDay(next.staffId, next.startAt.toLocal()))
          if (o.id != id) ...busySegments(o, services[o.serviceId], now),
      ];
      if (segmentsConflict(mine, taken)) {
        throw ApiError(ApiErrorCode.slotTaken, ApiError.defaultMessage(ApiErrorCode.slotTaken), status: 409);
      }
    }
    appointments[id] = next;
    return next;
  }

  List<Customer> search(String q) {
    final query = q.trim();
    final digits = query.replaceAll(RegExp(r'[^\d]'), '');
    final list = customers.values.where((c) {
      if (query.isEmpty) return true;
      if ((c.name ?? '').contains(query)) return true;
      return digits.length >= 3 && (c.phone ?? '').replaceAll('+', '').contains(digits);
    }).toList()
      ..sort((a, b) => (b.lastVisitAt ?? DateTime(0)).compareTo(a.lastVisitAt ?? DateTime(0)));
    return list.take(30).toList();
  }

  CustomerProfile profile(String id) {
    final c = customers[id] ??
        (throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404));
    final now = _now();
    final mine = appointments.values.where((a) => a.customerId == id).toList()
      ..sort((a, b) => b.startAt.compareTo(a.startAt));
    final staffName = {for (final s in staff) s.id: s.name};
    final visits = [
      for (final a in mine)
        if (a.status.isFinal)
          CustomerVisit(
            appointmentId: a.id,
            at: a.startedAt ?? a.startAt,
            status: a.status,
            serviceName: services[a.serviceId]?.name,
            staffName: staffName[a.staffId],
            actualMinutes: a.actualMinutes,
            plannedMinutes: a.plannedMinutes,
            finalPrice: a.finalPrice,
            notes: a.notes,
          ),
    ];
    final durations = <LearnedDuration>[];
    for (final svcId in {for (final a in mine) if (a.status == AppointmentStatus.done) a.serviceId}) {
      final est = estimateDuration(
        customerActuals: [
          for (final a in _doneNewestFirst((a) => a.customerId == id && a.serviceId == svcId)) a.actualMinutes!,
        ],
        staffActuals: const [],
        defaultMinutes: services[svcId]?.defaultMinutes ?? 30,
      );
      durations.add(LearnedDuration(
        serviceId: svcId,
        serviceName: services[svcId]?.name ?? 'خدمة',
        minutes: est.minutes,
        samples: est.samples,
      ));
    }
    return CustomerProfile(
      customer: c,
      visits: visits,
      durations: durations,
      upcoming: [
        for (final a in mine.reversed)
          if (!a.status.isFinal && a.startAt.isAfter(now.subtract(const Duration(hours: 3)))) a,
      ],
    );
  }

  static String? normalizePhone(String raw) {
    var d = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (d.startsWith('00')) d = '+${d.substring(2)}';
    if (d.startsWith('07') && d.length == 10) d = '+962${d.substring(1)}';
    if (!d.startsWith('+')) d = '+$d';
    return RegExp(r'^\+\d{8,15}$').hasMatch(d) ? d : null;
  }

  Customer createCustomer({required String phone, String? name, String? notes}) {
    final p = normalizePhone(phone);
    if (p == null) throw const ApiError(ApiErrorCode.invalidInput, 'رقم الهاتف غير صحيح.', status: 400);
    // رقم واحد = زبونة واحدة (@@unique tenantId+phone): نعيد الموجودة لا نكرّرها.
    final existing = customers.values.where((c) => c.phone == p).firstOrNull;
    if (existing != null) return existing;
    final trimmed = name?.trim();
    final c = Customer(
      id: 'cu_${_seq++}',
      name: trimmed == null || trimmed.isEmpty ? null : trimmed,
      phone: p,
      notes: notes,
    );
    customers[c.id] = c;
    return c;
  }

  Customer updateCustomer(String id, {String? name, String? phone, String? notes, String? preferredStaffId}) {
    final c = customers[id] ??
        (throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404));
    String? p;
    if (phone != null) {
      p = normalizePhone(phone);
      if (p == null) throw const ApiError(ApiErrorCode.invalidInput, 'رقم الهاتف غير صحيح.', status: 400);
    }
    final next = _withCounts(c, name: name, phone: p, notes: notes, preferredStaffId: preferredStaffId);
    customers[id] = next;
    return next;
  }
}
