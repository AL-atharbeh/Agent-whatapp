import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/errors.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/data/models.dart';
import 'package:hader/data/schedule.dart';
import 'package:hader/features/appointments/appointments_controller.dart';

import '../widget/harness.dart';

/// «الآن» ثابت: الثلاثاء ٢٠ تشرين الأول ١٣:٠٧ محلياً. البيانات الوهمية
/// مرسومة حول الساعة ١٣:٠٠ (رنا: لون جارٍ بدأ ١٢:٢٠ ووقت انتظاره ١٢:٥٠–١٣:٣٠).
final fixedNow = DateTime(2026, 10, 20, 13, 7);
final today = DateTime(2026, 10, 20);

Future<FakeHaderApi> loggedInApi({bool appointments = true}) async {
  final api = FakeHaderApi(latency: Duration.zero, now: () => fixedNow.toUtc(), appointmentsEnabled: appointments);
  await api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
  return api;
}

void main() {
  group('الإجراءات المسموحة لكل حالة', () {
    test('دورة الموعد كما في القاعدة ٥', () {
      expect(AppointmentAction.allowedFor(AppointmentStatus.booked), [
        AppointmentAction.confirm,
        AppointmentAction.start,
        AppointmentAction.noShow,
        AppointmentAction.cancel,
      ]);
      expect(AppointmentAction.allowedFor(AppointmentStatus.confirmed), isNot(contains(AppointmentAction.confirm)));
      expect(AppointmentAction.allowedFor(AppointmentStatus.inProgress), [AppointmentAction.finish]);
      for (final s in [AppointmentStatus.done, AppointmentStatus.cancelled, AppointmentStatus.noShow]) {
        expect(AppointmentAction.allowedFor(s), isEmpty, reason: s.wire);
      }
      expect(AppointmentAction.noShow.wire, 'no-show', reason: 'مسار العقد');
    });
  });

  group('يوم المواعيد — إجراءات متفائلة', () {
    late FakeHaderApi api;
    late ProviderContainer c;
    late AppointmentsDayController ctrl;

    setUp(() async {
      api = await loggedInApi();
      c = testContainer(api, session: demoSession);
      ctrl = c.read(appointmentsDayProvider.notifier)..now = () => fixedNow;
      await ctrl.selectDate(today);
    });

    tearDown(() {
      c.dispose();
      api.dispose();
    });

    Appointment find(String customerId, AppointmentStatus status) =>
        c.read(appointmentsDayProvider).items.firstWhere((a) => a.customerId == customerId && a.status == status);

    test('تحميل اليوم: الفريق والمواعيد والخدمات', () {
      final s = c.read(appointmentsDayProvider);
      expect(s.loading, isFalse);
      expect(s.staff.length, 4);
      expect(s.items.where((a) => a.status == AppointmentStatus.inProgress), isNotEmpty);
      expect(s.services, isNotEmpty);
      expect(s.items.every((a) => dayOf(a.startAt) == today), isTrue);
    });

    test('تأكيد: الحالة تتغيّر فوراً قبل رد الخادم، ثم تثبت', () async {
      final a = find('cu_sara', AppointmentStatus.booked);
      final f = ctrl.act(a.id, AppointmentAction.confirm);
      final mid = c.read(appointmentsDayProvider);
      expect(mid.items.firstWhere((x) => x.id == a.id).status, AppointmentStatus.confirmed);
      expect(mid.pending, contains(a.id));
      expect(await f, isNull);
      expect(c.read(appointmentsDayProvider).pending, isEmpty);
      expect(api.bookings.appointments[a.id]!.status, AppointmentStatus.confirmed);
    });

    test('بدأت ثم خلصت بسعر وملاحظات الزيارة', () async {
      final a = find('cu_leen', AppointmentStatus.confirmed);
      expect(await ctrl.act(a.id, AppointmentAction.start), isNull);
      expect(c.read(appointmentsDayProvider).items.firstWhere((x) => x.id == a.id).startedAt, isNotNull);
      final visitsBefore = api.bookings.customers['cu_leen']!.visitCount;
      expect(await ctrl.act(a.id, AppointmentAction.finish, finalPrice: 17.5, notes: 'تفضّل الطول كما هو'), isNull);
      final done = c.read(appointmentsDayProvider).items.firstWhere((x) => x.id == a.id);
      expect(done.status, AppointmentStatus.done);
      expect(done.finalPrice, 17.5);
      expect(done.notes, 'تفضّل الطول كما هو');
      expect(api.bookings.customers['cu_leen']!.visitCount, visitsBefore + 1);
    });

    test('فشل الشبكة ⇒ تراجع للحالة السابقة ورسالة واضحة', () async {
      final a = find('cu_sara', AppointmentStatus.booked);
      api.offline = true;
      final msg = await ctrl.act(a.id, AppointmentAction.start);
      expect(msg, contains('لا اتصال'));
      final after = c.read(appointmentsDayProvider);
      expect(after.items.firstWhere((x) => x.id == a.id).status, AppointmentStatus.booked);
      expect(after.pending, isEmpty);
    });

    test('إجراء يرفضه الخادم ⇒ تراجع ورسالة الخادم', () async {
      final a = find('cu_sara', AppointmentStatus.booked);
      final msg = await ctrl.act(a.id, AppointmentAction.finish);
      expect(msg, isNotNull);
      expect(c.read(appointmentsDayProvider).items.firstWhere((x) => x.id == a.id).status, AppointmentStatus.booked);
    });

    test('غياب يزيد عدّاد العميل', () async {
      final a = find('cu_sara', AppointmentStatus.booked);
      final before = api.bookings.customers['cu_sara']!.noShowCount;
      expect(await ctrl.act(a.id, AppointmentAction.noShow), isNull);
      expect(api.bookings.customers['cu_sara']!.noShowCount, before + 1);
    });

    test('رسائل الأخطاء بلغة المالك', () {
      expect(AppointmentsDayController.messageFor(const ApiError(ApiErrorCode.slotTaken, 'x')), contains('أُخذ هذا الوقت'));
      expect(AppointmentsDayController.messageFor(const ApiError(ApiErrorCode.notFound, 'x')), contains('لم يعد موجوداً'));
    });
  });

  group('الأوقات والحجز (الخادم الوهمي يطبّق القواعد)', () {
    late FakeHaderApi api;
    setUp(() async => api = await loggedInApi());
    tearDown(() => api.dispose());

    test('كل وقت مقترح: في المستقبل، ضمن الدوام، ولا يتعارض مع أي انشغال', () async {
      final r = await api.appointmentSlots(serviceId: 'svc_cut', staffId: 'st_rana', date: isoDay(today), customerId: 'cu_sara');
      final day = await api.appointmentsDay(isoDay(today));
      final services = {for (final s in day.services) s.id: s};
      final rana = day.staff.firstWhere((s) => s.id == 'st_rana');
      final taken = [
        for (final a in day.items.where((a) => a.staffId == 'st_rana')) ...busySegments(a, services[a.serviceId], fixedNow),
      ];
      expect(r.slots, isNotEmpty);
      for (final s in r.slots) {
        final start = s.startAt.toLocal();
        expect(start.isBefore(fixedNow), isFalse);
        final m = start.hour * 60 + start.minute;
        expect(rana.hoursOn(today).any((h) => m >= h.start && m + r.estimate!.minutes <= h.end), isTrue);
        final mine = [TimeSpan(start, start.add(Duration(minutes: r.estimate!.minutes)))];
        expect(segmentsConflict(mine, taken), isFalse, reason: '$start');
      }
    });

    test('المدة تُقدَّر لهذا العميل: قصة سارة ٢٠ د من زيارات العميل السابقة', () async {
      final r = await api.appointmentSlots(serviceId: 'svc_cut', staffId: 'st_rana', date: isoDay(today), customerId: 'cu_sara');
      expect(r.estimate!.basis, DurationBasis.customer);
      expect(r.estimate!.minutes, 20);
      final leen = await api.appointmentSlots(serviceId: 'svc_cut', staffId: 'st_dina', date: isoDay(today), customerId: 'cu_leen');
      expect(leen.estimate!.minutes, 65, reason: 'لين: ٦٠ و٦٥ ⇒ الوسيط ٦٢٫٥ ⇒ ٦٥');
      final anon = await api.appointmentSlots(serviceId: 'svc_cut', date: isoDay(today));
      expect(anon.estimate!.basis, DurationBasis.fallback);
    });

    test('خدمة قصيرة تُقترح داخل وقت انتظار خدمة جارية', () async {
      final r = await api.appointmentSlots(serviceId: 'svc_quick', staffId: 'st_rana', date: isoDay(today));
      final starts = r.slots.map((s) => s.startAt.toLocal()).toList();
      expect(starts, contains(DateTime(2026, 10, 20, 13, 15)), reason: 'الانتظار ١٢:٥٠–١٣:٣٠ والسريعة ١٣:٠٠–١٣:١٥');
      expect(starts, isNot(contains(DateTime(2026, 10, 20, 13, 30))), reason: '١٣:٣٠ عاد مشغولاً');
    });

    test('«أيّ أحد»: أوقات من كل من يقدّم الخدمة فقط', () async {
      final r = await api.appointmentSlots(serviceId: 'svc_cut', date: isoDay(today.add(const Duration(days: 1))));
      expect(r.slots.map((s) => s.staffId).toSet(), {'st_rana', 'st_dina'});
    });

    test('الحجز ينجح في وقت مقترح، ويُرفض بـSLOT_TAKEN فوق موعد قائم', () async {
      final r = await api.appointmentSlots(serviceId: 'svc_cut', staffId: 'st_dina', date: isoDay(today), customerId: 'cu_reem');
      final slot = r.slots.first;
      final a = await api.createAppointment(NewAppointment(
        customerId: 'cu_reem',
        serviceId: 'svc_cut',
        staffId: slot.staffId,
        startAt: slot.startAt,
        source: AppointmentSource.phone,
      ));
      expect(a.status, AppointmentStatus.booked);
      expect(a.source, AppointmentSource.phone);
      expect((await api.appointmentsDay(isoDay(today))).items.map((x) => x.id), contains(a.id));

      // الوقت نفسه مرة ثانية (حجزان متزامنان)
      await expectLater(
        api.createAppointment(NewAppointment(customerId: 'cu_hala', serviceId: 'svc_cut', staffId: slot.staffId, startAt: slot.startAt)),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ApiErrorCode.slotTaken)),
      );
    });

    test('عميل جديد بالرقم: نفس الرقم لا يُنشئ عميلاً ثانياً', () async {
      final a = await api.createCustomer(phone: '0791112233', name: 'كريم');
      final b = await api.createCustomer(phone: '+962791112233');
      expect(a.id, b.id);
      expect(a.phone, '+962791112233');
      expect((await api.customers('كريم')).single.id, a.id);
      expect((await api.customers('1112')).map((c) => c.id), contains(a.id));
    });

    test('ملف العميل: الزيارات بملاحظاتها والمدد المتعلَّمة', () async {
      final p = await api.customerProfile('cu_sara');
      expect(p.visits.any((v) => (v.notes ?? '').contains('رقم اللون')), isTrue);
      expect(p.durations.firstWhere((d) => d.serviceId == 'svc_cut').minutes, 20);
      expect(p.upcoming, isNotEmpty);
      final updated = await api.updateCustomer('cu_sara', notes: 'ملاحظة جديدة');
      expect(updated.notes, 'ملاحظة جديدة');
    });

    test('وحدة غير مفعّلة ⇒ 404 كما في العقد', () async {
      final off = await loggedInApi(appointments: false);
      await expectLater(
        off.appointmentsDay(isoDay(today)),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ApiErrorCode.notFound)),
      );
      expect((await off.me()).appointmentsEnabled, isFalse);
      expect((await api.me()).appointmentsEnabled, isTrue);
      off.dispose();
    });
  });

  group('قراءة متسامحة', () {
    test('MeInfo: العلم من أعلى الرد أو من tenant أو features، وغيابه = مطفأ', () {
      expect(MeInfo.fromJson({'appointmentsEnabled': true}).appointmentsEnabled, isTrue);
      expect(MeInfo.fromJson({'tenant': {'appointmentsEnabled': true}}).appointmentsEnabled, isTrue);
      expect(MeInfo.fromJson({'features': {'appointments': 'true'}}).appointmentsEnabled, isTrue);
      expect(MeInfo.fromJson(const {}).appointmentsEnabled, isFalse);
      expect(MeInfo.fromJson({'appointmentsEnabled': 'yes'}).appointmentsEnabled, isFalse);
    });

    test('Appointment ملفوف، بسعر نصي، وعميل وخدمة مضمّنين', () {
      final a = Appointment.fromJson({
        'appointment': {
          'id': 'a1',
          'startAt': '2026-10-20T10:00:00Z',
          'plannedMinutes': '45',
          'status': 'CONFIRMED',
          'source': 'WALK_IN',
          'finalPrice': '12.50',
          'customer': {'id': 'c1', 'name': null, 'phone': '+962790000000'},
          'service': {'id': 's1', 'name': 'كشف', 'priceMin': '15', 'processingMinutes': 10},
          'staffId': 'st1',
          'estimate': {'minutes': 40, 'basis': 'customer', 'samples': 3},
        },
      })!;
      expect(a.customerId, 'c1');
      expect(a.serviceId, 's1');
      expect(a.plannedMinutes, 45);
      expect(a.finalPrice, 12.5);
      expect(a.service!.priceMin, 15);
      expect(a.service!.hasProcessing, isTrue);
      expect(a.estimate!.basis, DurationBasis.customer);
      expect(a.source, AppointmentSource.walkIn);
    });

    test('موعد بلا id أو بلا وقت يُسقط؛ حالة مجهولة لا تكسر', () {
      expect(Appointment.fromJson({'startAt': '2026-10-20T10:00:00Z'}), isNull);
      expect(Appointment.fromJson({'id': 'x'}), isNull);
      expect(Appointment.fromJson({'id': 'x', 'startAt': '2026-10-20T10:00:00Z', 'status': 'RESCHEDULED'})!.status,
          AppointmentStatus.unknown);
    });

    test('ساعات الدوام: فترات تالفة تُسقط وحدها', () {
      final s = StaffMember.fromJson({
        'id': 's',
        'name': 'مقدّم خدمة',
        'workingHours': {
          'sat': [
            ['10:00', '14:00'],
            ['16:00', '15:00'],
            ['bad'],
          ],
          'friday': <Object>[],
          'xyz': [
            ['10:00', '11:00'],
          ],
        },
        'services': [
          {'id': 'a'},
          'b',
        ],
      })!;
      expect(s.workingHours['sat'], [(start: 600, end: 840)]);
      expect(s.workingHours['fri'], isEmpty);
      expect(s.workingHours.containsKey('xyz'), isFalse);
      expect(s.serviceIds, ['a', 'b']);
      expect(s.hasPhoto, isTrue, reason: 'بلا مؤشر نجرّب المسار مرة');
      expect(StaffMember.fromJson({'id': 'x', 'hasPhoto': false})!.offers('anything'), isTrue);
    });

    test('Slots وCustomerProfile بمفاتيح بديلة', () {
      final r = SlotsResult.fromJson({
        'items': [
          {'startAt': '2026-10-20T10:00:00Z', 'staffId': 's'},
          {'staffId': 's'},
        ],
      });
      expect(r.slots.length, 1);
      expect(r.estimate, isNull);
      final p = CustomerProfile.fromJson({
        'customer': {'id': 'c', 'visitCount': '3'},
        'history': [
          {'id': 'v', 'startAt': '2026-10-01T10:00:00Z', 'status': 'DONE', 'service': {'id': 's', 'name': 'كشف'}},
        ],
        'learned': [
          {'serviceId': 's', 'serviceName': 'كشف', 'minutes': 25},
        ],
      })!;
      expect(p.customer.visitCount, 3);
      expect(p.visits.single.serviceName, 'كشف');
      expect(p.durations.single.minutes, 25);
    });

    test('جسم الحجز: عميل جديد بالرقم، والوقت بـUTC', () {
      final j = NewAppointment(
        serviceId: 's',
        staffId: 'st',
        startAt: DateTime.utc(2026, 10, 20, 10),
        newCustomerPhone: '+962790000000',
        source: AppointmentSource.phone,
        notes: '  ',
      ).toJson();
      expect(j['customer'], {'phone': '+962790000000'});
      expect(j['startAt'], '2026-10-20T10:00:00.000Z');
      expect(j['source'], 'PHONE');
      expect(j.containsKey('notes'), isFalse);
      expect(isoDay(DateTime(2026, 3, 7)), '2026-03-07');
    });
  });
}
