import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/platform_bridge.dart';
import 'package:hader/core/providers.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/local/memory_store.dart';
import 'package:hader/data/local/session_store.dart';
import 'package:hader/features/lock/app_lock_controller.dart';
import 'package:hader/features/lock/biometric_auth.dart';
import 'package:hader/features/lock/lock_overlay.dart';

import 'widget/harness.dart';

/// بصمة وهمية: نختار ما يوجد على «الجهاز» وما يعيده التحقق.
class FakeBio extends BiometricAuth {
  FakeBio({this.k = BiometricKind.face, this.result = false});

  BiometricKind k;
  bool result;
  int biometricCalls = 0;
  int deviceCalls = 0;

  @override
  Future<BiometricKind> kind() async => k;

  @override
  Future<bool> authenticate(String reason) async {
    biometricCalls++;
    return result;
  }

  @override
  Future<bool> authenticateWithDevice(String reason) async {
    deviceCalls++;
    return result;
  }
}

ProviderContainer testContainerWith(BiometricAuth bio, {InMemorySecureKeyValue? kv}) => ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        apiProvider.overrideWithValue(FakeHaderApi(latency: Duration.zero)),
        databaseProvider.overrideWithValue(InMemoryLocalStore()),
        sessionStoreProvider.overrideWithValue(SessionStore(kv ?? InMemorySecureKeyValue())),
        initialSessionProvider.overrideWithValue(demoSession),
        biometricAuthProvider.overrideWithValue(bio),
        platformBridgeProvider.overrideWithValue(const _NoBridge()),
      ],
    );

/// قناة المنصة بلا جهاز: في FakeAsync لا ردّ يصل فينتظر الاختبار للأبد.
class _NoBridge extends PlatformBridge {
  const _NoBridge();

  @override
  Future<void> setSecureRecents(bool enabled) async {}
}

Future<void> settle(WidgetTester t, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> typePin(WidgetTester t, String pin) async {
  for (final d in pin.split('')) {
    await t.tap(find.byKey(Key('pin.$d')));
    await t.pump(const Duration(milliseconds: 30));
  }
  // التجزئة بعشرين ألف دورة تأخذ لحظة
  await settle(t, 20);
}

void main() {
  testWidgets('قفل برمز حاضر: الخاطئ يُرفض، والصحيح يفتح — بلا نافذة رمز النظام', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 956));
    final bio = FakeBio(k: BiometricKind.none);
    // نفعّل القفل برمز ثم نقفل كما بعد تشغيل بارد
    final c2 = testContainerWith(bio);
    await t.runAsync(() => c2.read(appLockProvider.notifier).enableWithPin('2468'));
    c2.read(appLockProvider.notifier).lockNow();

    await t.pumpWidget(testApp(c2, const LockGate(child: Text('المحتوى'))));
    await settle(t);
    expect(find.byKey(const Key('lock.screen')), findsOneWidget);
    expect(find.text('المحتوى'), findsNothing);
    expect(find.byKey(const Key('pin.biometric')), findsNothing, reason: 'لا بصمة مسجّلة');

    await typePin(t, '1111');
    expect(find.text('رمز غير صحيح'), findsOneWidget);
    expect(find.byKey(const Key('lock.screen')), findsOneWidget);

    await typePin(t, '2468');
    expect(find.text('المحتوى'), findsOneWidget);
    expect(bio.deviceCalls, 0, reason: 'رمز iPhone لا يُطلب لمن عنده رمز حاضر');
    await t.pumpWidget(const SizedBox());
    c2.dispose();
  });

  testWidgets('البصمة تفتح أولاً، وزرّها بأيقونة الوجه', (t) async {
    await t.binding.setSurfaceSize(const Size(440, 956));
    final bio = FakeBio(k: BiometricKind.face, result: true);
    final c = testContainerWith(bio);
    await t.runAsync(() => c.read(appLockProvider.notifier).enableWithPin('2468'));
    c.read(appLockProvider.notifier).lockNow();

    await t.pumpWidget(testApp(c, const LockGate(child: Text('المحتوى'))));
    await settle(t);
    // التشغيل يطلب البصمة تلقائياً
    expect(bio.biometricCalls, greaterThanOrEqualTo(1));
    expect(find.text('المحتوى'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
    c.dispose();
  });

  test('خمس محاولات خاطئة ⇒ إيقاف مؤقت يبقى بعد إعادة التشغيل', () async {
    final bio = FakeBio(k: BiometricKind.none);
    final kv = InMemorySecureKeyValue();
    final c = testContainerWith(bio, kv: kv);
    final ctrl = c.read(appLockProvider.notifier);
    await ctrl.enableWithPin('2468');
    for (var i = 0; i < 4; i++) {
      expect(await ctrl.checkPin('0000'), PinResult.wrong);
    }
    expect(await ctrl.checkPin('0000'), PinResult.lockedOut);
    expect(await ctrl.checkPin('2468'), PinResult.lockedOut, reason: 'حتى الصحيح ينتظر');
    c.dispose();

    // «إعادة تشغيل»: حاوية جديدة على نفس التخزين
    final c2 = testContainerWith(bio, kv: kv);
    c2.read(appLockProvider);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(await c2.read(appLockProvider.notifier).checkPin('2468'), PinResult.lockedOut);
    c2.dispose();
  });

  test('الرمز لا يُخزَّن نصاً', () async {
    final kv = InMemorySecureKeyValue();
    final c = testContainerWith(FakeBio(), kv: kv);
    await c.read(appLockProvider.notifier).enableWithPin('2468');
    final stored = await SessionStore(kv).readPinHash();
    expect(stored, startsWith('v1:'));
    expect(stored, isNot(contains('2468')));
    c.dispose();
  });
}
