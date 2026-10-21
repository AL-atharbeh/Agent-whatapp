import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/errors.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/features/appointments/manage/manage_screen.dart';
import 'package:hader/features/appointments/manage/reports_screen.dart';
import 'package:hader/features/appointments/manage/services_screen.dart';
import 'package:hader/features/appointments/manage/team_screen.dart';

import '../widget/appointments_widgets_test.dart' show api, settle;
import '../widget/harness.dart';

void main() {
  group('جسم الحفظ', () {
    test('الدوام بمفاتيح الخادم وساعات HH:MM، واليوم بلا فترات يُرسل فارغاً (عطلة)', () {
      final m = StaffMember.fromJson({
        'id': 'st_1',
        'name': 'رنا',
        'workingHours': {
          'sat': [
            ['10:00', '14:00'],
            ['15:00', '24:00'],
          ],
        },
        'serviceIds': ['svc_a'],
        'commissionPercent': 30,
      })!;
      final b = m.toBody();
      final hours = b['workingHours']! as Map<String, Object?>;
      expect(hours['sat'], [
        ['10:00', '14:00'],
        ['15:00', '24:00'],
      ]);
      expect(hours['fri'], isEmpty, reason: 'يوم غائب يعني «لا تغيير» عند الخادم — والمقصود عطلة');
      expect(hours.keys, containsAll(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']));
      expect(b['commissionPercent'], 30);
      expect(b['serviceIds'], ['svc_a']);
      expect(b.containsKey('id'), isFalse);
    });

    test('الخدمة بلا معرّف في الجسم', () {
      const s = ServiceOffering(id: 'svc_1', name: 'فحص', priceMin: 10, defaultMinutes: 30);
      expect(s.toBody().containsKey('id'), isFalse);
      expect(s.toBody()['priceMin'], 10);
    });

    test('التقرير يُقرأ ملفوفاً بـ report', () {
      final r = AppointmentReport.fromJson({
        'report': {
          'from': '2026-10-01',
          'to': '2026-10-21',
          'visits': 3,
          'revenue': '42.5',
          'noShows': 1,
          'noShowRate': 0.25,
          'minutesSaved': 80,
          'staff': [
            {'staffId': 's1', 'name': 'رنا', 'visits': 3, 'revenue': 42.5, 'commission': 12.75},
          ],
          'topServices': [
            {'serviceId': 'v1', 'name': 'فحص', 'visits': 3, 'revenue': 42.5},
          ],
        },
      });
      expect(r.revenue, 42.5);
      expect(r.staff.single.commission, 12.75);
      expect(r.topServices.single.name, 'فحص');
    });
  });

  group('الخادم الوهمي', () {
    test('إضافة خدمة ثم تعديلها وإيقافها — والموقوفة تبقى في قائمة الإدارة', () async {
      final a = await api();
      final created = await a.saveService(
        const ServiceOffering(id: '', name: 'كشف', priceMin: 15, priceMax: 25, defaultMinutes: 20),
      );
      expect((await a.allServices()).map((s) => s.id), contains(created.id));
      final edited = await a.saveService(
        ServiceOffering(id: created.id, name: 'كشف', priceMin: 15, defaultMinutes: 20, active: false),
        id: created.id,
      );
      expect(edited.active, isFalse);
      expect((await a.allServices()).firstWhere((s) => s.id == created.id).active, isFalse);
    });

    test('سعر أعلى أقل من الأدنى مرفوض', () async {
      final a = await api();
      expect(
        () => a.saveService(const ServiceOffering(id: '', name: 'x', priceMin: 20, priceMax: 10, defaultMinutes: 20)),
        throwsA(isA<ApiError>()),
      );
    });

    test('الصورة تُرفع وتُقرأ وتُمحى', () async {
      final a = await api();
      final st = (await a.allStaff()).first;
      final bytes = Uint8List.fromList(List.filled(100, 7));
      expect((await a.uploadStaffPhoto(st.id, bytes)).hasPhoto, isTrue);
      expect(await a.staffPhoto(st.id), bytes);
      expect((await a.deleteStaffPhoto(st.id)).hasPhoto, isFalse);
      expect(await a.staffPhoto(st.id), isNull);
    });

    test('صورة فوق ١٥٠ كيلوبايت مرفوضة', () async {
      final a = await api();
      final st = (await a.allStaff()).first;
      expect(() => a.uploadStaffPhoto(st.id, Uint8List(151 * 1024)), throwsA(isA<ApiError>()));
    });
  });

  group('الشاشات', () {
    testWidgets('الإدارة تفتح الخدمات والفريق والتقارير', (t) async {
      await t.binding.setSurfaceSize(const Size(440, 956));
      final c = testContainer(await api(), session: demoSession);
      await t.pumpWidget(testApp(c, const ManageScreen()));
      await settle(t);

      await t.tap(find.byKey(const Key('manage.services')));
      await settle(t);
      expect(find.byType(ServicesManageScreen), findsOneWidget);
      Navigator.of(t.element(find.byType(ServicesManageScreen))).pop();
      await settle(t, 20);

      await t.tap(find.byKey(const Key('manage.team')));
      await settle(t);
      expect(find.byType(TeamManageScreen), findsOneWidget);
      Navigator.of(t.element(find.byType(TeamManageScreen))).pop();
      await settle(t, 20);

      await t.tap(find.byKey(const Key('manage.reports')));
      await settle(t);
      expect(find.byType(ReportsScreen), findsOneWidget);
      expect(find.text('الدخل'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      c.dispose();
    });

    testWidgets('خدمة جديدة من الجوال تظهر في القائمة', (t) async {
      await t.binding.setSurfaceSize(const Size(440, 956));
      final fake = await api();
      final c = testContainer(fake, session: demoSession);
      await t.pumpWidget(testApp(c, const ServicesManageScreen()));
      await settle(t);

      await t.tap(find.byKey(const Key('services.add')));
      await settle(t);
      await t.enterText(find.byKey(const Key('service.name')), 'خدمة تجربة');
      await t.enterText(find.byKey(const Key('service.priceMin')), '١٢');
      await t.enterText(find.byKey(const Key('service.minutes')), '25');
      await t.ensureVisible(find.byKey(const Key('service.save')));
      await t.tap(find.byKey(const Key('service.save')));
      // انتقال الرجوع يأخذ نصف ثانية تقريباً
      await settle(t, 20);

      expect(find.byType(ServiceEditorScreen), findsNothing, reason: 'الحفظ يعيد للقائمة');
      final saved = (await fake.allServices()).firstWhere((s) => s.name == 'خدمة تجربة');
      expect(saved.priceMin, 12, reason: 'الأرقام العربية تُقبل');
      expect(saved.defaultMinutes, 25);
      expect(find.text('خدمة تجربة'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      c.dispose();
    });

    testWidgets('عضو جديد بدوام افتراضي والجمعة عطلة', (t) async {
      await t.binding.setSurfaceSize(const Size(440, 1400));
      final fake = await api();
      final c = testContainer(fake, session: demoSession);
      await t.pumpWidget(testApp(c, const TeamManageScreen()));
      await settle(t);

      await t.tap(find.byKey(const Key('team.add')));
      await settle(t);
      await t.enterText(find.byKey(const Key('staff.name')), 'سامي');
      await t.ensureVisible(find.byKey(const Key('staff.save')));
      await t.tap(find.byKey(const Key('staff.save')));
      await settle(t);

      final saved = (await fake.allStaff()).firstWhere((s) => s.name == 'سامي');
      expect(saved.workingHours['sat'], [(start: 600, end: 1080)]);
      expect(saved.workingHours['fri'] ?? const [], isEmpty);
      await t.pumpWidget(const SizedBox());
      c.dispose();
    });
  });
}
