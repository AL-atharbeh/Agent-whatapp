import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/store_clock.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/appointments.dart';
import 'package:hader/data/local/session_store.dart';
import 'package:hader/data/models.dart';
import 'package:hader/features/appointments/appointments_controller.dart';
import 'package:hader/features/appointments/appt_style.dart';

import '../widget/harness.dart';

void main() {
  group('ساعة المتجر', () {
    test('لحظة UTC ⇒ وقت جدار عمّان (UTC+3)', () {
      final c = StoreClock('Asia/Amman');
      expect(c.zoneName, 'Asia/Amman');
      final w = c.wall(DateTime.utc(2026, 10, 20, 7, 30));
      expect([w.year, w.month, w.day, w.hour, w.minute], [2026, 10, 20, 10, 30]);
      expect(w.isUtc, isFalse, reason: 'وقت جدار بتمثيل محلي كي يعمل كود الرسم كما هو');
    });

    test('ذهاباً وإياباً: instant(wall(x)) == x', () {
      final c = StoreClock('Asia/Dubai');
      final x = DateTime.utc(2026, 1, 5, 23, 45);
      expect(c.instant(c.wall(x)), x);
    });

    test('منتصف الليل يتبع المتجر لا الجهاز: ٢٢:٣٠ UTC هو الغد في عمّان', () {
      final w = StoreClock('Asia/Amman').wall(DateTime.utc(2026, 10, 20, 22, 30));
      expect(dayOf(w), DateTime(2026, 10, 21));
    });

    test('التوقيت الصيفي في منطقة المتجر', () {
      final c = StoreClock('Europe/Berlin');
      expect(c.wall(DateTime.utc(2026, 3, 29, 0, 30)).hour, 1);
      expect(c.wall(DateTime.utc(2026, 3, 29, 1, 30)).hour, 3);
    });

    test('منطقة مجهولة أو فارغة ⇒ منطقة الجهاز بلا انهيار', () {
      for (final name in [null, '', 'Mars/Olympus']) {
        final c = StoreClock(name);
        expect(c.zoneName, isNull);
        final x = DateTime.utc(2026, 10, 20, 7);
        expect(c.wall(x), x.toLocal());
      }
    });
  });

  group('العملة', () {
    test('رموز عربية للشائعة، والرمز نفسه لغيرها', () {
      expect(currencyLabel('JOD'), 'د.أ');
      expect(currencyLabel('sar'), 'ر.س');
      expect(currencyLabel('AED'), 'د.إ');
      expect(currencyLabel('USD'), r'$');
      expect(currencyLabel('EGP'), 'EGP');
      expect(currencyLabel(null), isNull);
    });

    test('السعر والمدى مع العملة، وبدونها الرقم وحده', () {
      expect(money(15, 'JOD'), '١٥ د.أ');
      expect(money(12.5), '١٢٫٥');
      const s = ServiceOffering(id: 's', name: 'خدمة', priceMin: 8, priceMax: 15);
      expect(priceRange(s, 'SAR'), '٨–١٥ ر.س');
      expect(priceRange(s), '٨–١٥');
    });

    test('TenantInfo: المنطقة والعملة والعلم، بتسامح', () {
      final t = TenantInfo.fromJson({
        'id': 't',
        'appointmentsEnabled': true,
        'timezone': 'Asia/Amman',
        'currency': 'jod',
      });
      expect(t.timezone, 'Asia/Amman');
      expect(t.currency, 'JOD');
      expect(t.appointmentsEnabled, isTrue);
      final bad = TenantInfo.fromJson({'id': 't', 'currency': 'دينار', 'timezone': ' '});
      expect(bad.currency, isNull);
      expect(bad.timezone, isNull);
      expect(TenantInfo.fromJson(t.toJson()).currency, 'JOD');
      expect(MeInfo.fromJson({'tenant': t.toJson()}).appointmentsEnabled, isTrue);
    });
  });

  test('يوم المواعيد يُحوَّل لوقت جدار منطقة المتجر', () async {
    final api = FakeHaderApi(latency: Duration.zero);
    await api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
    const tokyo = Session(
      token: 'fake_t',
      user: UserInfo(id: 'u', email: 'a@b.c', name: null),
      tenant: TenantInfo(id: 't', slug: 's', name: 'n', agentName: null, timezone: 'Asia/Tokyo', currency: 'JOD'),
    );
    final c = testContainer(api, session: tokyo);
    final clock = c.read(storeClockProvider);
    expect(clock.zoneName, 'Asia/Tokyo');
    expect(c.read(currencyProvider), 'JOD');

    final ctrl = c.read(appointmentsDayProvider.notifier);
    final serverDay = await api.appointmentsDay(isoDay(DateTime.now()));
    await ctrl.selectDate(DateTime.now());
    // كل موعد في الحالة = لحظة الخادم بوقت جدار طوكيو
    final shown = {for (final a in c.read(appointmentsDayProvider).items) a.id: a};
    for (final a in serverDay.items) {
      final s = shown[a.id];
      if (s == null) continue; // قد يقع في يوم آخر بتوقيت طوكيو — لا بأس
      expect(s.startAt, clock.wall(a.startAt));
    }
    c.dispose();
    api.dispose();
  });
}
