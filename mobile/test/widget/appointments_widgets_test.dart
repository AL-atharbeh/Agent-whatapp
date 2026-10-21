import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/features/appointments/appointments_controller.dart';
import 'package:hader/features/appointments/new_appointment_screen.dart';
import 'package:hader/features/home/home_shell.dart';
import 'package:hader/features/profile/profile_controller.dart';

import 'harness.dart';

Future<void> settle(WidgetTester t, [int frames = 8]) async {
  for (var i = 0; i < frames; i++) {
    await t.pump(const Duration(milliseconds: 60));
  }
}

Future<FakeHaderApi> api({bool appointments = true}) async {
  final a = FakeHaderApi(latency: Duration.zero, appointmentsEnabled: appointments);
  await a.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
  return a;
}

void main() {
  for (final enabled in [true, false]) {
    testWidgets('تبويب «المواعيد» ${enabled ? 'يظهر حين تُفعَّل الوحدة' : 'غائب تماماً حين لا تُفعَّل'}', (t) async {
      await t.binding.setSurfaceSize(const Size(440, 956));
      final fake = await api(appointments: enabled);
      final c = testContainer(fake, session: demoSession);
      await t.pumpWidget(testApp(c, const HomeShell()));
      await settle(t);
      expect(c.read(meProvider)?.appointmentsEnabled, enabled);

      final labels = ['المحادثات', if (enabled) 'المواعيد', 'الإعدادات', 'الملف'];
      for (var i = 0; i < labels.length; i++) {
        expect(find.byKey(Key('tab.label.${labels[i]}')), findsOneWidget, reason: labels[i]);
        expect(find.byKey(Key('tab.$i')), findsOneWidget);
      }
      expect(find.byKey(Key('tab.${labels.length}')), findsNothing, reason: 'لا خانة زائدة');
      if (!enabled) {
        expect(find.byKey(const Key('tab.label.المواعيد')), findsNothing);
        expect(c.read(appointmentsVisibleProvider), isFalse);
      } else {
        // فتح التبويب يشغّل استطلاع اليوم، والعودة للمحادثات توقفه.
        await t.tap(find.byKey(const Key('tab.1')));
        await settle(t);
        expect(c.read(appointmentsVisibleProvider), isTrue);
        expect(c.read(appointmentsDayProvider.notifier).isPolling, isTrue);
        // القائمة هي العرض الافتراضي على الجوال، والجدول بزرّ
        expect(find.byKey(const Key('appts.agenda')), findsOneWidget);
        await t.tap(find.text('جدول'));
        await settle(t);
        expect(find.byKey(const Key('appts.timeline')), findsOneWidget);
        await t.tap(find.byKey(const Key('tab.0')));
        await settle(t, 2);
        expect(c.read(appointmentsVisibleProvider), isFalse);
        expect(c.read(appointmentsDayProvider.notifier).isPolling, isFalse);
      }

      await t.pumpWidget(const SizedBox());
      c.dispose();
      fake.dispose();
      await t.binding.setSurfaceSize(null);
    });
  }

  testWidgets('حجز جديد: عميل ⇒ خدمة ⇒ مقدّم خدمة ⇒ وقت مقترح ⇒ احجز', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 3000));
    final fake = await api();
    final c = testContainer(fake, session: demoSession);
    final now = DateTime.now();
    final tomorrow = DateTime(now.year, now.month, now.day + 1);
    final before = fake.bookings.appointments.length;
    Appointment? result;

    await t.pumpWidget(testApp(
      c,
      Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              key: const Key('open'),
              onPressed: () async => result = await Navigator.of(context).push<Appointment?>(NewAppointmentScreen.route(date: tomorrow)),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await t.tap(find.byKey(const Key('open')));
    await settle(t);

    await t.tap(find.byKey(const Key('customer.cu_sara')));
    await settle(t, 3);
    expect(find.byKey(const Key('new.customer')), findsOneWidget);

    await t.tap(find.byKey(const Key('svc.svc_cut')));
    await settle(t, 3);
    await t.tap(find.byKey(const Key('staff.st_rana')));
    await settle(t, 4);

    expect(find.byKey(const Key('slots.estimate')), findsOneWidget);
    expect(find.textContaining('حسب زيارات العميل السابقة'), findsOneWidget);
    final slot = find.byWidgetPredicate((w) => w is ChoiceChip && (w.key is ValueKey<String>) && (w.key! as ValueKey<String>).value.startsWith('slot.st_rana.'));
    expect(slot, findsWidgets);
    await t.tap(slot.first);
    await settle(t, 2);

    await t.tap(find.byKey(const Key('new.book')));
    await settle(t);

    expect(fake.bookings.appointments.length, before + 1);
    expect(result, isNotNull);
    expect(result!.customerId, 'cu_sara');
    expect(result!.plannedMinutes, 20, reason: 'المدة المقدَّرة لسارة، لا الافتراضية ٤٥');

    await t.pumpWidget(const SizedBox());
    c.dispose();
    fake.dispose();
    await t.binding.setSurfaceSize(null);
  });
}
