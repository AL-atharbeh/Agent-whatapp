import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/api/dio_api.dart';
import '../data/api/fake_api.dart';
import '../data/api/hader_api.dart';
import '../data/local/app_database.dart';
import '../data/local/session_store.dart';
import '../data/models.dart';
import '../features/auth/session_controller.dart';
import 'config.dart';
import 'platform_bridge.dart';
import 'server_clock.dart';

/// الاعتماديات الجذرية. ما يحتاج تهيئة غير متزامنة (القاعدة، الجلسة
/// المحفوظة) يُفتح في main قبل أول إطار ويُحقن هنا بـoverride — فلا تظهر
/// شاشة الدخول لحظة ثم تختفي عند فتح تطبيق مسجّل أصلاً.

final configProvider = Provider<AppConfig>((_) => AppConfig.fromEnvironment());

final databaseProvider = Provider<LocalStore>(
  (_) => throw UnimplementedError('databaseProvider يُحقن من main'),
);

final sessionStoreProvider = Provider<SessionStore>(
  (_) => SessionStore(FlutterSecureKeyValue()),
);

final initialSessionProvider = Provider<Session?>((_) => null);

final initialLockProvider = Provider<LockSettings>((_) => const LockSettings());

final platformBridgeProvider = Provider<PlatformBridge>((_) => const PlatformBridge());

final serverClockProvider = Provider<ServerClock>((_) => ServerClock());

final apiProvider = Provider<HaderApi>((ref) {
  final cfg = ref.watch(configProvider);
  String? token() => ref.read(sessionProvider)?.token;
  void expired() => ref.read(sessionProvider.notifier).expire();
  if (cfg.useFakeApi) {
    final fake = FakeHaderApi(
      failRate: cfg.fakeFailRate,
      liveInbound: cfg.fakeLiveInbound,
      tenantInactive: cfg.fakeTenantInactive,
      token: token,
      onUnauthenticated: expired,
    );
    ref.onDispose(fake.dispose);
    return fake;
  }
  return DioHaderApi(
    baseUrl: cfg.apiBase,
    token: token,
    onUnauthenticated: expired,
    clock: ref.read(serverClockProvider),
  );
});

/// يتغيّر مع كل دخول/خروج. كل حالة خاصة بحساب تراقبه، فتُبنى من جديد
/// عند تبدّل الحساب بدل أن تعرض محادثات المستخدم السابق.
final accountKeyProvider = Provider<String?>(
  (ref) => ref.watch(sessionProvider.select((s) => s?.token)),
);

/// «نبضة» ترتفع حين يتغيّر `version` في الملخّص: القوائم والمحادثة المفتوحة
/// تستمع إليها وتعيد التحميل. عدد صحيح لا القيمة نفسها كي تُطلق حتى لو عاد
/// الخادم لنفس النص بعد تغيّرين متتاليين.
final inboxPulseProvider = NotifierProvider<InboxPulse, int>(InboxPulse.new);

class InboxPulse extends Notifier<int> {
  @override
  int build() => 0;

  void bump() => state++;
}

/// قناة تحديثات محادثة واحدة (إرسال، استلام، قراءة) لكل من يعرضها —
/// القائمة تنقل الصف إلى «المثبّتة» فوراً بدل انتظار الاستطلاع التالي.
final conversationPatchProvider =
    NotifierProvider<ConversationPatches, ConversationItem?>(ConversationPatches.new);

class ConversationPatches extends Notifier<ConversationItem?> {
  @override
  ConversationItem? build() => null;

  void publish(ConversationItem c) => state = c;
}

/// المحادثة المعروضة الآن (لإخفاء إشعار داخلي عن محادثة يقرؤها المالك).
final openConversationProvider =
    NotifierProvider<OpenConversation, String?>(OpenConversation.new);

class OpenConversation extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? id) => state = id;

  /// يُغلق فقط إن كانت هي المفتوحة — شاشة قديمة تُغلق بعد فتح أخرى لا تمحو الجديدة.
  void clearIf(String id) {
    if (state == id) state = null;
  }
}

/// المتجر غير نشط (‎403 TENANT_INACTIVE على إرسال).
///
/// القراءة تعمل والإرسال لا — فليست خروجاً من الحساب. نعطّل المحرّر بلافتة
/// واضحة بدل أن يكتب المالك رداً ثم يكتشف أنه لم يُرسل. لا يوجد في العقد
/// حقل لحالة المتجر، فالعلم يُرفع من أول رفض ويُصفّر بزر «تحقّق مجدداً» أو
/// بإعادة تشغيل التطبيق.
final tenantInactiveProvider = NotifierProvider<TenantInactive, bool>(TenantInactive.new);

class TenantInactive extends Notifier<bool> {
  @override
  bool build() {
    ref.watch(accountKeyProvider);
    return false;
  }

  void mark() => state = true;

  void clear() => state = false;
}
