import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/local/session_store.dart';
import 'biometric_auth.dart';

final biometricAuthProvider = Provider<BiometricAuth>((_) => BiometricAuth());

class AppLockState {
  const AppLockState({required this.settings, required this.locked, this.authenticating = false});

  final LockSettings settings;
  final bool locked;
  final bool authenticating;

  AppLockState copyWith({LockSettings? settings, bool? locked, bool? authenticating}) => AppLockState(
        settings: settings ?? this.settings,
        locked: locked ?? this.locked,
        authenticating: authenticating ?? this.authenticating,
      );
}

final appLockProvider = NotifierProvider<AppLockController, AppLockState>(AppLockController.new);

/// قفل التطبيق بالبصمة/الوجه.
///
/// يقفل عند التشغيل البارد، وبعد [LockSettings.timeoutMinutes] في الخلفية.
/// «الخلفية» تعني paused/hidden فقط — لا inactive: نافذة Face ID نفسها تجعل
/// التطبيق inactive، ولو قفلنا عندها لدخلنا حلقة قفل لا تنتهي.
class AppLockController extends Notifier<AppLockState> {
  DateTime? _backgroundedAt;

  @override
  AppLockState build() {
    final s = ref.read(initialLockProvider);
    unawaited(ref.read(platformBridgeProvider).setSecureRecents(s.enabled));
    return AppLockState(settings: s, locked: s.enabled);
  }

  void onBackground() {
    if (!state.settings.enabled || state.authenticating) return;
    _backgroundedAt ??= DateTime.now();
  }

  void onForeground() {
    final since = _backgroundedAt;
    _backgroundedAt = null;
    if (!state.settings.enabled || since == null || state.locked) return;
    final away = DateTime.now().difference(since);
    if (away >= Duration(minutes: state.settings.timeoutMinutes)) {
      state = state.copyWith(locked: true);
    }
  }

  Future<bool> unlock() async {
    if (state.authenticating) return false;
    state = state.copyWith(authenticating: true);
    final ok = await ref.read(biometricAuthProvider).authenticate('افتح «حاضر» للوصول إلى محادثات عملائك');
    if (!ref.mounted) return ok;
    state = state.copyWith(authenticating: false, locked: ok ? false : state.locked);
    return ok;
  }

  /// التفعيل يتطلب نجاح تحقق أولاً: من يفعّل قفلاً لا يستطيع فتحه يُحبس خارج
  /// تطبيقه. والتعطيل أيضاً — كي لا يعطّله من التقط الهاتف مفتوحاً.
  Future<String?> setEnabled(bool enabled) async {
    final bio = ref.read(biometricAuthProvider);
    if (enabled && !await bio.isAvailable()) {
      return 'لا يدعم هذا الجهاز البصمة أو رمز القفل. فعّل رمز قفل الجهاز أولاً.';
    }
    state = state.copyWith(authenticating: true);
    final ok = await bio.authenticate(
      enabled ? 'أكّد هويتك لتفعيل قفل التطبيق' : 'أكّد هويتك لإيقاف قفل التطبيق',
    );
    if (!ref.mounted) return null;
    state = state.copyWith(authenticating: false);
    if (!ok) return 'لم يتم التحقق. لم يتغيّر شيء.';
    final next = state.settings.copyWith(enabled: enabled);
    await ref.read(sessionStoreProvider).writeLock(next);
    await ref.read(platformBridgeProvider).setSecureRecents(enabled);
    state = state.copyWith(settings: next);
    return null;
  }

  Future<void> setTimeout(int minutes) async {
    final next = state.settings.copyWith(timeoutMinutes: minutes);
    await ref.read(sessionStoreProvider).writeLock(next);
    state = state.copyWith(settings: next);
  }
}
