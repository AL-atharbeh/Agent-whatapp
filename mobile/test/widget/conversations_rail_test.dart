import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/features/conversations/channel_rail.dart';
import 'package:hader/features/conversations/conversations_tab.dart';
import 'package:hader/features/conversations/inbox_controller.dart';

import 'harness.dart';

void main() {
  testWidgets('الشريط على اليمين بشارات الملخّص، والقائمة تتبدّل مع القناة', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 956));
    final api = FakeHaderApi(latency: Duration.zero);
    await api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');
    final c = testContainer(api, session: demoSession);

    await t.pumpWidget(testApp(c, const Scaffold(body: ConversationsTab())));
    await c.read(inboxProvider.notifier).refresh();
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(milliseconds: 50));
    }

    // RTL: الشريط أول عنصر في Row ⇒ على يمين الشاشة.
    final rail = t.getRect(find.byType(ChannelRail));
    expect(rail.right, 440);
    expect(rail.left, greaterThan(300));

    // واتساب: ٣ تحويلات (أحمر) + غير مقروء (نقطة). إنستغرام: غير مقروء فقط (رمادي).
    final wa = find.byKey(const Key('rail.WHATSAPP'));
    final ig = find.byKey(const Key('rail.INSTAGRAM'));
    final ms = find.byKey(const Key('rail.MESSENGER'));
    expect(find.descendant(of: wa, matching: find.byKey(const Key('badge.handoff'))), findsOneWidget);
    expect(find.descendant(of: wa, matching: find.byKey(const Key('badge.dot'))), findsOneWidget);
    expect(find.descendant(of: wa, matching: find.text('٣')), findsOneWidget);
    expect(find.descendant(of: ig, matching: find.byKey(const Key('badge.unread'))), findsOneWidget);
    expect(find.descendant(of: ig, matching: find.byKey(const Key('badge.handoff'))), findsNothing);
    expect(find.descendant(of: ms, matching: find.byKey(const Key('badge.handoff'))), findsOneWidget);

    // المثبّتة (HUMAN) أولاً.
    expect(find.byKey(const Key('section.pinned')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('section.pinned')), matching: find.byKey(const Key('conv.c_wa_ahmad'))), findsOneWidget);
    expect(find.byKey(const Key('conv.c_wa_unknown')), findsOneWidget);

    // اختيار إنستغرام: الشريط يبقى، والقائمة لقناته.
    await t.tap(ig);
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 60));
    }
    expect(find.byType(ChannelRail), findsOneWidget);
    expect(find.byKey(const Key('conv.c_ig_nour')), findsOneWidget);
    expect(find.byKey(const Key('conv.c_wa_ahmad')), findsNothing);
    expect(find.text('إنستغرام'), findsWidgets);

    await t.pumpWidget(const SizedBox());
    c.dispose();
    await t.binding.setSurfaceSize(null);
  });
}
