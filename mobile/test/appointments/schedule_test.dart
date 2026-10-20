import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/data/schedule.dart';

/// قواعد الجدول (docs/appointments.md — ١ إلى ٤). كل التواريخ محلية عمداً:
/// المتجر والجهاز في المنطقة نفسها (انظر تقرير العقد).
void main() {
  final day = DateTime(2026, 10, 20); // ثلاثاء
  DateTime t(int h, [int m = 0]) => DateTime(2026, 10, 20, h, m);

  Appointment appt(
    String id,
    DateTime start,
    int planned, {
    AppointmentStatus status = AppointmentStatus.booked,
    DateTime? startedAt,
    DateTime? finishedAt,
    String serviceId = 'svc',
  }) =>
      Appointment(
        id: id,
        customerId: 'c',
        staffId: 's',
        serviceId: serviceId,
        startAt: start,
        plannedMinutes: planned,
        status: status,
        startedAt: startedAt,
        finishedAt: finishedAt,
      );

  const processing = ServiceOffering(
    id: 'long',
    name: 'خدمة بانتظار',
    defaultMinutes: 120,
    processingAfterMinutes: 30,
    processingMinutes: 40,
  );

  group('الانشغال (القاعدة ٢)', () {
    final now = t(13);

    test('المحجوز: المخطّط', () {
      expect(occupiedSpan(appt('a', t(10), 45), now), TimeSpan(t(10), t(10, 45)));
    });

    test('المنتهي: الفعلي — من خلص بدري حرّر وقته', () {
      final a = appt('a', t(10), 45, status: AppointmentStatus.done, startedAt: t(10, 5), finishedAt: t(10, 25));
      expect(occupiedSpan(a, now), TimeSpan(t(10, 5), t(10, 25)));
    });

    test('الجاري: يمتد للآن إن طوّل', () {
      final a = appt('a', t(12), 30, status: AppointmentStatus.inProgress, startedAt: t(12, 10));
      expect(occupiedSpan(a, now), TimeSpan(t(12, 10), t(13)));
      expect(occupiedSpan(a, t(12, 20)), TimeSpan(t(12, 10), t(12, 40)));
    });

    test('الملغى والغياب لا يشغلان الوقت', () {
      expect(occupiedSpan(appt('a', t(10), 45, status: AppointmentStatus.cancelled), now), isNull);
      expect(occupiedSpan(appt('a', t(10), 45, status: AppointmentStatus.noShow), now), isNull);
      expect(busySegments(appt('a', t(10), 45, status: AppointmentStatus.noShow), null, now), isEmpty);
    });

    test('وقت الانتظار يُستثنى من الانشغال', () {
      final a = appt('a', t(10), 120, serviceId: 'long');
      expect(processingSpan(a, processing, now), TimeSpan(t(10, 30), t(11, 10)));
      expect(busySegments(a, processing, now), [TimeSpan(t(10), t(10, 30)), TimeSpan(t(11, 10), t(12))]);
    });

    test('الفاصل يُضاف بعد الموعد', () {
      expect(busySegments(appt('a', t(10), 30), null, now, bufferMinutes: 10), [TimeSpan(t(10), t(10, 40))]);
    });

    test('موعد داخل وقت الانتظار يُقبل فقط إن وقع بكامله فيه', () {
      final parent = busySegments(appt('p', t(10), 120, serviceId: 'long'), processing, now);
      final inside = busySegments(appt('x', t(10, 35), 15), null, now);
      final straddling = busySegments(appt('y', t(11), 20), null, now);
      expect(segmentsConflict(inside, parent), isFalse);
      expect(segmentsConflict(straddling, parent), isTrue);
    });
  });

  group('مُقدِّر المدة (القاعدة ١)', () {
    test('تاريخ العميل أولاً — بالوسيط لا المتوسط', () {
      final e = estimateDuration(customerActuals: [15, 90, 18], staffActuals: [40], defaultMinutes: 45);
      expect(e.basis, DurationBasis.customer);
      expect(e.minutes, 20, reason: 'وسيط ١٥،١٨،٩٠ = ١٨ ⇒ للأعلى ٢٠');
      expect(e.samples, 3);
    });

    test('آخر ٣ زيارات فقط', () {
      final e = estimateDuration(customerActuals: [60, 60, 60, 10, 10], staffActuals: const [], defaultMinutes: 45);
      expect(e.minutes, 60);
    });

    test('ثم تاريخ مقدّم الخدمة، ثم الافتراضي', () {
      expect(estimateDuration(customerActuals: const [], staffActuals: [31, 33], defaultMinutes: 45).basis, DurationBasis.staff);
      expect(estimateDuration(customerActuals: const [], staffActuals: [31, 33], defaultMinutes: 45).minutes, 35);
      final d = estimateDuration(customerActuals: const [], staffActuals: const [], defaultMinutes: 42);
      expect(d.basis, DurationBasis.fallback);
      expect(d.minutes, 45);
    });

    test('لا يقلّ عن ٥', () {
      expect(roundUp5(1), 5);
      expect(roundUp5(0), 5);
      expect(roundUp5(25), 25);
      expect(roundUp5(25.5), 30);
    });
  });

  group('الأوقات المتاحة (القاعدة ٣)', () {
    final hours = <DayRange>[(start: 10 * 60, end: 12 * 60)];

    test('بخطوة ١٥، لا في الماضي، ولا فوق موعد', () {
      final starts = freeStarts(
        day: day,
        hours: hours,
        minutes: 30,
        serviceOf: (_) => null,
        staffAppointments: [appt('a', t(10, 30), 45)],
        now: t(10, 10),
        service: null,
      );
      expect(starts, [t(11, 15), t(11, 30)], reason: '١٠:١٥ تتداخل مع ١٠:٣٠؛ ١٠:٠٠ في الماضي؛ ١١:٣٠+٣٠=١٢:٠٠ آخرها');
    });

    test('وقت الانتظار يُعرض متاحاً لخدمة قصيرة تقع بكاملها فيه', () {
      final starts = freeStarts(
        day: day,
        hours: [(start: 10 * 60, end: 12 * 60)],
        minutes: 15,
        serviceOf: (a) => a.serviceId == 'long' ? processing : null,
        staffAppointments: [appt('p', t(10), 120, serviceId: 'long')],
        now: t(9),
        service: null,
      );
      expect(starts, [t(10, 30), t(10, 45)]);
    });
  });
}
