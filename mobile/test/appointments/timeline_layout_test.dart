import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/data/schedule.dart';
import 'package:hader/features/appointments/appointments_controller.dart';
import 'package:hader/features/appointments/timeline_layout.dart';
import 'package:hader/features/appointments/timeline_view.dart';
import 'package:hader/ui/theme.dart';

void main() {
  DateTime t(int h, [int m = 0]) => DateTime(2026, 10, 20, h, m);
  const ppm = 2.0;

  Appointment appt(String id, DateTime start, int planned,
          {AppointmentStatus status = AppointmentStatus.booked, String serviceId = 'svc', DateTime? startedAt, DateTime? finishedAt}) =>
      Appointment(
        id: id,
        customerId: 'c_$id',
        staffId: 's1',
        serviceId: serviceId,
        startAt: start,
        plannedMinutes: planned,
        status: status,
        startedAt: startedAt,
        finishedAt: finishedAt,
        customer: CustomerRef(id: 'c_$id', name: 'عميل $id'),
      );

  const processing = ServiceOffering(
    id: 'long',
    name: 'خدمة بانتظار',
    defaultMinutes: 120,
    processingAfterMinutes: 30,
    processingMinutes: 40,
  );
  ServiceOffering? serviceOf(Appointment a) => a.serviceId == 'long' ? processing : null;

  const staff = StaffMember(
    id: 's1',
    name: 'مقدّم خدمة',
    hasPhoto: false,
    workingHours: {
      'tue': [(start: 10 * 60, end: 18 * 60)],
    },
  );

  group('نافذة اليوم', () {
    test('من أول دوام إلى آخره بساعات كاملة', () {
      final w = DayWindow.forDay(day: t(0), staff: [staff], spans: const []);
      expect(w.start, t(10));
      expect(w.end, t(18));
    });

    test('موعد خارج الدوام يوسّع النافذة', () {
      final w = DayWindow.forDay(day: t(0), staff: [staff], spans: [TimeSpan(t(8, 30), t(9))]);
      expect(w.start, t(8));
    });

    test('يوم عطلة فارغ ⇒ نافذة افتراضية لا صفر', () {
      final w = DayWindow.forDay(day: DateTime(2026, 10, 23), staff: [staff], spans: const []);
      expect(w.minutes, greaterThanOrEqualTo(4 * 60));
    });
  });

  group('كتل العمود', () {
    final window = DayWindow(t(10), t(18));

    test('الأعلى والارتفاع من الوقت', () {
      final b = layoutColumn(items: [appt('a', t(11), 45)], window: window, now: t(9), pxPerMinute: ppm, serviceOf: serviceOf).single;
      expect(b.top, 60 * ppm);
      expect(b.height, 45 * ppm);
      expect(b.startFraction, 0);
      expect(b.widthFraction, 1);
    });

    test('المنتهي يُرسم بمدته الفعلية، والجاري يمتد للآن', () {
      final done = appt('d', t(11), 60, status: AppointmentStatus.done, startedAt: t(11), finishedAt: t(11, 20));
      final running = appt('r', t(12), 30, status: AppointmentStatus.inProgress, startedAt: t(12));
      final blocks = layoutColumn(items: [done, running], window: window, now: t(13), pxPerMinute: ppm, serviceOf: serviceOf);
      expect(blocks.firstWhere((b) => b.appointment.id == 'd').height, 20 * ppm);
      expect(blocks.firstWhere((b) => b.appointment.id == 'r').height, 60 * ppm);
    });

    test('وقت الانتظار داخل الكتلة نسبةً لأعلاها', () {
      final b = layoutColumn(items: [appt('p', t(11), 120, serviceId: 'long')], window: window, now: t(9), pxPerMinute: ppm, serviceOf: serviceOf).single;
      expect(b.processingTop, 30 * ppm);
      expect(b.processingHeight, 40 * ppm);
    });

    test('موعد داخل وقت انتظار غيره يُرسم فوقه مزاحاً لا في مسار جانبي', () {
      final parent = appt('p', t(11), 120, serviceId: 'long');
      final child = appt('c', t(11, 35), 15);
      final blocks = layoutColumn(items: [parent, child], window: window, now: t(9), pxPerMinute: ppm, serviceOf: serviceOf);
      final p = blocks.firstWhere((b) => b.appointment.id == 'p');
      final c = blocks.firstWhere((b) => b.appointment.id == 'c');
      expect(p.widthFraction, 1, reason: 'الأب يبقى بعرضه الكامل');
      expect(c.nestedIn, 'p');
      expect(c.startFraction, greaterThan(0));
      expect(c.startFraction + c.widthFraction, closeTo(1, 1e-9));
    });

    test('تداخل حقيقي ⇒ مسارات متجاورة، وما بعده يعود للعرض الكامل', () {
      final a = appt('a', t(11), 60);
      final b = appt('b', t(11, 30), 60);
      final later = appt('z', t(14), 30);
      final blocks = layoutColumn(items: [a, b, later], window: window, now: t(9), pxPerMinute: ppm, serviceOf: serviceOf);
      final la = blocks.firstWhere((x) => x.appointment.id == 'a');
      final lb = blocks.firstWhere((x) => x.appointment.id == 'b');
      final lz = blocks.firstWhere((x) => x.appointment.id == 'z');
      expect(la.widthFraction, 0.5);
      expect(lb.widthFraction, 0.5);
      expect(la.startFraction, 0);
      expect(lb.startFraction, 0.5);
      expect(lz.widthFraction, 1);
    });

    test('الملغى يُرسم باهتاً بمدته المخطّطة ولا وقت انتظار له', () {
      final x = appt('x', t(11), 120, status: AppointmentStatus.cancelled, serviceId: 'long');
      final b = layoutColumn(items: [x], window: window, now: t(9), pxPerMinute: ppm, serviceOf: serviceOf).single;
      expect(b.faded, isTrue);
      expect(b.height, 120 * ppm);
      expect(b.processingTop, isNull);
    });

    test('ما خارج النافذة يُقصّ، وموعد قصير جداً له حدّ أدنى للّمس', () {
      final early = appt('e', t(9, 30), 60);
      final tiny = appt('t', t(15), 5);
      final blocks = layoutColumn(items: [early, tiny], window: window, now: t(8), pxPerMinute: 1, serviceOf: serviceOf);
      expect(blocks.firstWhere((b) => b.appointment.id == 'e').top, 0);
      expect(blocks.firstWhere((b) => b.appointment.id == 'e').height, 30);
      expect(blocks.firstWhere((b) => b.appointment.id == 't').height, minBlockHeight);
    });
  });

  group('الوقت الحرّ', () {
    test('الدوام ناقص الانشغال، ووقت الانتظار حرّ، ولا ماضٍ', () {
      final gaps = freeGaps(
        day: t(0),
        hours: [(start: 10 * 60, end: 14 * 60)],
        items: [appt('p', t(11), 120, serviceId: 'long')],
        now: t(10, 15),
        serviceOf: serviceOf,
      );
      expect(gaps, [
        TimeSpan(t(10, 15), t(11)),
        TimeSpan(t(11, 30), t(12, 10)),
        TimeSpan(t(13), t(14)),
      ]);
    });

    test('فجوات قصيرة تُهمل', () {
      final gaps = freeGaps(
        day: t(0),
        hours: [(start: 10 * 60, end: 11 * 60)],
        items: [appt('a', t(10, 10), 45)],
        now: t(9),
        serviceOf: serviceOf,
        minMinutes: 15,
      );
      expect(gaps, isEmpty, reason: '١٠ د قبل و٥ د بعد — أقصر من ١٥');
    });
  });

  testWidgets('RTL: المسار الأول على يمين العمود، وعمود الساعات على يمين الشاشة', (tester) async {
    await tester.binding.setSurfaceSize(const Size(440, 900));
    final state = DayState(
      date: t(0),
      staff: const [staff],
      items: [appt('a', t(11), 60), appt('b', t(11, 30), 60), appt('p', t(14), 120, serviceId: 'long')],
      services: const {'long': processing},
      loading: false,
    );
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: DayTimeline(state: state, now: t(9), onTapAppointment: (_) {}, onTapFree: (_, _) {}),
          ),
        ),
      ),
    ));
    await tester.pump();

    final a = tester.getRect(find.byKey(const ValueKey('block.a')));
    final b = tester.getRect(find.byKey(const ValueKey('block.b')));
    expect(a.center.dx, greaterThan(b.center.dx), reason: 'المسار ٠ = بداية السطر = يمين');
    expect(find.byKey(const Key('block.processing')), findsOneWidget);

    final gutterLabel = tester.getRect(find.text('١٠ ص').first);
    expect(gutterLabel.center.dx, greaterThan(440 - DayTimeline.gutterWidth));
    await tester.binding.setSurfaceSize(null);
  });
}
