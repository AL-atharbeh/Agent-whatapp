import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/features/conversations/conversations_tab.dart';
import 'package:hader/features/conversations/inbox_controller.dart';

import 'harness.dart';

Future<void> _settle(WidgetTester t, [int frames = 8]) async {
  for (var i = 0; i < frames; i++) {
    await t.pump(const Duration(milliseconds: 80));
  }
}

void main() {
  testWidgets('القائمة بعرض الشاشة، والدائرة تجمع الشارات وتبدّل القناة', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 956));
    final api = FakeHaderApi(latency: Duration.zero);
    await api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
    final c = testContainer(api, session: demoSession);

    await t.pumpWidget(testApp(c, const Scaffold(body: ConversationsTab())));
    await c.read(inboxProvider.notifier).refresh();
    await _settle(t, 5);

    // لا شريط جانبي: الصف يملأ العرض تقريباً
    final row = t.getRect(find.byKey(const Key('conv.c_wa_unknown')));
    expect(row.width, greaterThan(400));

    // الدائرة يساراً فوق القاع، وعليها مجموع التحويلات بالأحمر + نقطة غير المقروء
    final orb = find.byKey(const Key('picker.orb'));
    expect(t.getRect(orb).left, lessThan(60));
    expect(find.descendant(of: orb, matching: find.byKey(const Key('badge.handoff'))), findsOneWidget);
    expect(find.descendant(of: orb, matching: find.byKey(const Key('badge.dot'))), findsOneWidget);

    // المثبّتة (HUMAN) أولاً في «الكل»
    expect(find.byKey(const Key('section.pinned')), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('section.pinned')), matching: find.byKey(const Key('conv.c_wa_ahmad'))),
      findsOneWidget,
    );

    // فتح الدائرة: القنوات الثلاث بشاراتها
    await t.tap(orb);
    await _settle(t);
    final wa = find.byKey(const Key('picker.WHATSAPP'));
    final ig = find.byKey(const Key('picker.INSTAGRAM'));
    final ms = find.byKey(const Key('picker.MESSENGER'));
    expect(wa, findsOneWidget);
    expect(find.descendant(of: wa, matching: find.byKey(const Key('badge.handoff'))), findsOneWidget);
    expect(find.descendant(of: wa, matching: find.text('٣')), findsOneWidget);
    expect(find.descendant(of: ig, matching: find.byKey(const Key('badge.unread'))), findsOneWidget);
    expect(find.descendant(of: ig, matching: find.byKey(const Key('badge.handoff'))), findsNothing);
    expect(find.descendant(of: ms, matching: find.byKey(const Key('badge.handoff'))), findsOneWidget);

    // القوس فوق الدائرة: واتساب أعلاها، وكلها داخل الشاشة
    expect(t.getCenter(wa).dy, lessThan(t.getCenter(orb).dy - 80));
    for (final f in [wa, ig, ms]) {
      final r = t.getRect(f);
      expect(r.left, greaterThanOrEqualTo(0));
      expect(r.right, lessThanOrEqualTo(440));
    }

    // اختيار إنستغرام يغلق الدائرة ويبدّل القائمة
    await t.tap(ig);
    await _settle(t);
    expect(find.byKey(const Key('picker.INSTAGRAM')), findsNothing);
    expect(find.byKey(const Key('conv.c_ig_nour')), findsOneWidget);
    expect(find.byKey(const Key('conv.c_wa_ahmad')), findsNothing);
    expect(find.text('إنستغرام'), findsWidgets);

    // الستارة تغلق بلا تبديل
    await t.tap(find.byKey(const Key('picker.orb')));
    await _settle(t);
    await t.tapAt(const Offset(400, 200));
    await _settle(t);
    expect(find.byKey(const Key('picker.WHATSAPP')), findsNothing);
    expect(find.byKey(const Key('conv.c_ig_nour')), findsOneWidget);

    await t.pumpWidget(const SizedBox());
    c.dispose();
    await t.binding.setSurfaceSize(null);
  });

  testWidgets('البحث بالأرقام العربية والفلاتر', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 956));
    final api = FakeHaderApi(latency: Duration.zero);
    await api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
    final c = testContainer(api, session: demoSession);

    await t.pumpWidget(testApp(c, const Scaffold(body: ConversationsTab())));
    await c.read(inboxProvider.notifier).refresh();
    await _settle(t, 5);

    // «تنتظرك» تُبقي HUMAN فقط
    await t.tap(find.byKey(const Key('filter.waiting')));
    await _settle(t, 3);
    expect(find.byKey(const Key('conv.c_wa_ahmad')), findsOneWidget);
    expect(find.byKey(const Key('conv.c_wa_unknown')), findsNothing);

    await t.tap(find.byKey(const Key('filter.all')));
    await _settle(t, 3);
    expect(find.byKey(const Key('conv.c_wa_unknown')), findsOneWidget);

    // بحث لا يطابق شيئاً
    await t.enterText(find.byKey(const Key('conv.search')), 'لا-يوجد-هكذا-اسم');
    await _settle(t, 3);
    expect(find.textContaining('لا نتائج'), findsOneWidget);

    await t.pumpWidget(const SizedBox());
    c.dispose();
    await t.binding.setSurfaceSize(null);
  });
}
