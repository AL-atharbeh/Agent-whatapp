import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/device_label.dart';
import '../../core/feedback.dart';
import '../../core/providers.dart';
import '../../data/local/session_store.dart';

final sessionProvider = NotifierProvider<SessionController, Session?>(SessionController.new);

/// الجلسة الحالية — null ⇒ شاشة الدخول.
class SessionController extends Notifier<Session?> {
  bool _ending = false;

  @override
  Session? build() => ref.read(initialSessionProvider);

  /// يرمي ApiError؛ الشاشة تعرض `message` العربية كما جاءت من الخادم.
  Future<void> login(String email, String password) async {
    final api = ref.read(apiProvider);
    final r = await api.login(
      email: email,
      password: password,
      deviceName: deviceName(),
      platform: devicePlatform(),
    );
    final s = Session(token: r.token, expiresAt: r.expiresAt, user: r.user, tenant: r.tenant);
    // ذاكرة حساب سابق (إن وُجد) تُمحى قبل أن يرى الحساب الجديد أي شاشة.
    final previous = await ref.read(sessionStoreProvider).read();
    if (previous == null || previous.tenant.id != s.tenant.id || previous.user.id != s.user.id) {
      await ref.read(databaseProvider).wipeAccountData();
    }
    await ref.read(sessionStoreProvider).write(s);
    _ending = false;
    state = s;
  }

  /// خروج بطلب المستخدم: نُبلغ الخادم ليسحب الجلسة ويمحو رمز الإشعارات،
  /// لكن لا ننتظره طويلاً — من يضغط «خروج» بلا إنترنت يجب أن يخرج.
  Future<void> logout() async {
    if (state == null) return;
    // ‎401 على طلب الخروج نفسه لا يجب أن يطلق مساراً ثانياً لـexpire.
    _ending = true;
    try {
      await ref.read(apiProvider).logout().timeout(const Duration(seconds: 4));
    } catch (_) {
      // الجلسة ستنتهي على الخادم بانقضاء صلاحيتها؛ المحلي يُمحى الآن.
    }
    await _clearLocal();
  }

  /// ‎401 UNAUTHENTICATED من أي طلب: الرمز سُحب (من «أجهزتي» على جهاز آخر،
  /// أو تغيّرت كلمة السر). قد تصل عدة ردود ‎401 معاً — نتصرف مرة واحدة.
  void expire() {
    if (state == null || _ending) return;
    _ending = true;
    unawaited(_clearLocal().then((_) => showToast('انتهت الجلسة. سجّل الدخول من جديد.')));
  }

  Future<void> _clearLocal() async {
    // المحو قبل تغيير الحالة: لا إطار واحد تُعرض فيه بيانات حساب خرج.
    try {
      await ref.read(databaseProvider).wipeAccountData();
    } catch (_) {}
    await ref.read(sessionStoreProvider).clear();
    state = null;
  }
}
