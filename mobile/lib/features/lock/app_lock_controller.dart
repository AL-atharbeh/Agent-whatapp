import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/local/session_store.dart';
import 'biometric_auth.dart';

final biometricAuthProvider = Provider<BiometricAuth>((_) => BiometricAuth());

/// طول رمز حاضر — أربعة أرقام كقفل الهاتف القديم: يُكتب بإبهام واحدة.
const pinLength = 4;

/// بعد هذا العدد من المحاولات الخاطئة يبدأ الإيقاف المؤقت.
const _freeAttempts = 5;

class AppLockState {
  const AppLockState({
    required this.settings,
    required this.locked,
    this.authenticating = false,
    this.biometric = BiometricKind.none,
    this.hasPin = false,
    this.fails = 0,
    this.lockedUntil,
  });

  final LockSettings settings;
  final bool locked;
  final bool authenticating;
  final BiometricKind biometric;

  /// للقفل رمز حاضر؟ من فعّله قبل وجود الرمز يُفتح له برمز الجهاز.
  final bool hasPin;
  final int fails;

  /// لا محاولات رمز قبل هذا الوقت.
  final DateTime? lockedUntil;

  AppLockState copyWith({
    LockSettings? settings,
    bool? locked,
    bool? authenticating,
    BiometricKind? biometric,
    bool? hasPin,
    int? fails,
    DateTime? lockedUntil,
    bool clearLockedUntil = false,
  }) =>
      AppLockState(
        settings: settings ?? this.settings,
        locked: locked ?? this.locked,
        authenticating: authenticating ?? this.authenticating,
        biometric: biometric ?? this.biometric,
        hasPin: hasPin ?? this.hasPin,
        fails: fails ?? this.fails,
        lockedUntil: clearLockedUntil ? null : (lockedUntil ?? this.lockedUntil),
      );
}

/// نتيجة إدخال الرمز.
enum PinResult { ok, wrong, lockedOut }

final appLockProvider = NotifierProvider<AppLockController, AppLockState>(AppLockController.new);

/// قفل التطبيق: بصمة الوجه أو الإصبع أولاً، ورمز حاضر من أربعة أرقام بديلاً.
///
/// يقفل عند التشغيل البارد، وبعد [LockSettings.timeoutMinutes] في الخلفية.
/// «الخلفية» تعني paused/hidden فقط — لا inactive: نافذة Face ID نفسها تجعل
/// التطبيق inactive، ولو قفلنا عندها لدخلنا حلقة قفل لا تنتهي.
///
/// الرمز لنا لا للنظام: رمز iPhone في نافذة iOS الرمادية لا يشبه حاضر، ومن
/// يعرف رمز هاتف موظفه يفتح به محادثات المتجر كلها.
class AppLockController extends Notifier<AppLockState> {
  DateTime? _backgroundedAt;
  String? _pinHash;

  SessionStore get _store => ref.read(sessionStoreProvider);
  BiometricAuth get _bio => ref.read(biometricAuthProvider);

  @override
  AppLockState build() {
    final s = ref.read(initialLockProvider);
    unawaited(ref.read(platformBridgeProvider).setSecureRecents(s.enabled));
    Future.microtask(_load);
    return AppLockState(settings: s, locked: s.enabled);
  }

  Future<void> _load() async {
    final hash = await _store.readPinHash();
    final f = await _store.readPinFails();
    final kind = await _bio.kind();
    if (!ref.mounted) return;
    _pinHash = hash;
    state = state.copyWith(hasPin: hash != null, biometric: kind, fails: f.fails, lockedUntil: f.until);
  }

  /// يقفل فوراً (لمن فعّل القفل) — كالعودة من الخلفية بعد انتهاء المهلة.
  void lockNow() {
    if (state.settings.enabled) state = state.copyWith(locked: true);
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
    // بصمة سُجّلت أو حُذفت من الإعدادات أثناء غياب التطبيق
    unawaited(_bio.kind().then((k) {
      if (ref.mounted) state = state.copyWith(biometric: k);
    }));
  }

  /// بالبصمة. بلا بصمة ولا رمز حاضر (قفل قديم) ⇒ رمز الجهاز.
  Future<bool> unlock() async {
    if (state.authenticating) return false;
    final kind = state.biometric == BiometricKind.none ? await _bio.kind() : state.biometric;
    if (kind == BiometricKind.none && state.hasPin) return false;
    state = state.copyWith(authenticating: true, biometric: kind);
    const reason = 'افتح «حاضر» للوصول إلى محادثات عملائك';
    final ok = kind == BiometricKind.none
        ? await _bio.authenticateWithDevice(reason)
        : await _bio.authenticate(reason);
    if (!ref.mounted) return ok;
    state = state.copyWith(authenticating: false, locked: ok ? false : state.locked);
    if (ok) await _resetFails();
    return ok;
  }

  Future<PinResult> unlockWithPin(String pin) async {
    final r = await checkPin(pin);
    if (r == PinResult.ok && ref.mounted) state = state.copyWith(locked: false);
    return r;
  }

  /// يتحقّق من الرمز بلا فتح — لتعطيل القفل أو تغيير الرمز.
  Future<PinResult> checkPin(String pin) async {
    final until = state.lockedUntil;
    if (until != null && DateTime.now().isBefore(until)) return PinResult.lockedOut;
    final hash = _pinHash;
    if (hash != null && _matches(hash, pin)) {
      await _resetFails();
      return PinResult.ok;
    }
    final fails = state.fails + 1;
    // بعد الخمس الأولى: ٣٠ ثانية تتضاعف مع كل خطأ، حتى ربع ساعة
    final next = fails < _freeAttempts
        ? null
        : DateTime.now().add(Duration(seconds: min(30 * pow(2, fails - _freeAttempts).toInt(), 15 * 60)));
    await _store.writePinFails(fails, next);
    if (ref.mounted) state = state.copyWith(fails: fails, lockedUntil: next, clearLockedUntil: next == null);
    return next == null ? PinResult.wrong : PinResult.lockedOut;
  }

  /// التحقق بالبصمة فقط — لتعطيل القفل أو تغيير الرمز دون كتابته.
  Future<bool> confirmWithBiometric(String reason) async {
    if (state.biometric == BiometricKind.none) return false;
    state = state.copyWith(authenticating: true);
    final ok = await _bio.authenticate(reason);
    if (ref.mounted) state = state.copyWith(authenticating: false);
    return ok;
  }

  /// يفعّل القفل برمز جديد (أو يغيّر الرمز إن كان مفعّلاً).
  Future<void> enableWithPin(String pin) async {
    final hash = _hash(pin);
    await _store.writePinHash(hash);
    _pinHash = hash;
    await _resetFails();
    final next = state.settings.copyWith(enabled: true);
    await _store.writeLock(next);
    await ref.read(platformBridgeProvider).setSecureRecents(true);
    if (ref.mounted) state = state.copyWith(settings: next, hasPin: true, biometric: await _bio.kind());
  }

  /// بعد تحقّق ناجح فقط — الشاشة تطلبه قبل الاستدعاء.
  Future<void> disable() async {
    await _store.writePinHash(null);
    _pinHash = null;
    await _resetFails();
    final next = state.settings.copyWith(enabled: false);
    await _store.writeLock(next);
    await ref.read(platformBridgeProvider).setSecureRecents(false);
    if (ref.mounted) state = state.copyWith(settings: next, hasPin: false);
  }

  Future<void> setTimeout(int minutes) async {
    final next = state.settings.copyWith(timeoutMinutes: minutes);
    await _store.writeLock(next);
    state = state.copyWith(settings: next);
  }

  Future<void> _resetFails() async {
    if (state.fails == 0 && state.lockedUntil == null) return;
    await _store.writePinFails(0, null);
    if (ref.mounted) state = state.copyWith(fails: 0, clearLockedUntil: true);
  }

  // ───────────── التجزئة ─────────────

  /// ملح لكل رمز وتكرار: الرمز أربعة أرقام فقط، فتجزئة واحدة بلا ملح تُعكس
  /// بجدول من عشرة آلاف سطر. التخزين نفسه في Keychain؛ هذا خط ثانٍ.
  static String _hash(String pin, [String? salt]) {
    final s = salt ?? base64Url.encode(List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    List<int> digest = utf8.encode('$s:$pin');
    for (var i = 0; i < 20000; i++) {
      digest = sha256.convert(digest).bytes;
    }
    return 'v1:$s:${base64Url.encode(digest)}';
  }

  static bool _matches(String stored, String pin) {
    final parts = stored.split(':');
    if (parts.length != 3 || parts[0] != 'v1') return false;
    final candidate = _hash(pin, parts[1]);
    // مقارنة بزمن ثابت — لا تكشف سرعة الرفض كم حرفاً طابق
    if (candidate.length != stored.length) return false;
    var diff = 0;
    for (var i = 0; i < stored.length; i++) {
      diff |= candidate.codeUnitAt(i) ^ stored.codeUnitAt(i);
    }
    return diff == 0;
  }
}
