import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/features/auth/login_screen.dart';
import 'package:hader/features/auth/session_controller.dart';

import 'harness.dart';

void main() {
  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets('خطأ الدخول يُعرض برسالة الخادم العربية، والدخول الصحيح يحفظ الجلسة', (t) async {
    final api = FakeHaderApi(latency: Duration.zero);
    final c = testContainer(api);
    await t.pumpWidget(testApp(c, const LoginScreen()));

    // تحقق محلي قبل أي طلب.
    await t.tap(find.byKey(const Key('login.submit')));
    await t.pump();
    expect(find.text('أدخل بريداً إلكترونياً صحيحاً.'), findsOneWidget);

    await t.enterText(find.byKey(const Key('login.email')), FakeHaderApi.demoEmail);
    await t.enterText(find.byKey(const Key('login.password')), 'wrong');
    await t.tap(find.byKey(const Key('login.submit')));
    await settle(t);
    expect(find.byKey(const Key('login.error')), findsOneWidget);
    expect(find.text('البريد أو كلمة السر غير صحيحة.'), findsOneWidget);
    expect(c.read(sessionProvider), isNull);

    await t.enterText(find.byKey(const Key('login.password')), FakeHaderApi.demoPassword);
    await t.tap(find.byKey(const Key('login.submit')));
    await settle(t);
    expect(c.read(sessionProvider), isNotNull);
    expect(c.read(sessionProvider)!.tenant.slug, 'shifra-code');
    expect(find.byKey(const Key('login.error')), findsNothing);

    await t.pumpWidget(const SizedBox());
    c.dispose();
  });

  testWidgets('حساب مالك المنصة مرفوض برسالة واضحة', (t) async {
    final c = testContainer(FakeHaderApi(latency: Duration.zero));
    await t.pumpWidget(testApp(c, const LoginScreen()));
    await t.enterText(find.byKey(const Key('login.email')), 'admin@hader.app');
    await t.enterText(find.byKey(const Key('login.password')), 'x');
    await t.tap(find.byKey(const Key('login.submit')));
    await settle(t);
    expect(find.textContaining('لأصحاب المتاجر'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
    c.dispose();
  });
}
