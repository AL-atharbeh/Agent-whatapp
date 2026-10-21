import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/json.dart';
import '../models.dart';

/// جلسة مسجّلة على هذا الجهاز.
class Session {
  const Session({
    required this.token,
    required this.user,
    required this.tenant,
    this.expiresAt,
  });

  static Session? fromJson(JsonMap m) {
    final token = readNonEmptyOrNull(m, 'token');
    if (token == null) return null;
    return Session(
      token: token,
      expiresAt: readDateOrNull(m, 'expiresAt'),
      user: UserInfo.fromJson(asMap(m['user'])),
      tenant: TenantInfo.fromJson(asMap(m['tenant'])),
    );
  }

  final String token;
  final DateTime? expiresAt;
  final UserInfo user;
  final TenantInfo tenant;

  JsonMap toJson() => {
        'token': token,
        'expiresAt': expiresAt?.toIso8601String(),
        'user': user.toJson(),
        'tenant': tenant.toJson(),
      };

  /// لا `toString` يطبع الرمز: سطر debugPrint(session) عابر يكفي لتسريبه.
  @override
  String toString() => 'Session(user: ${user.id}, tenant: ${tenant.slug})';
}

/// إعدادات حسّاسة تبقى في Keychain/Keystore مع الجلسة.
class LockSettings {
  const LockSettings({this.enabled = false, this.timeoutMinutes = 1});

  final bool enabled;

  /// كم دقيقة في الخلفية قبل طلب البصمة مجدداً (٠ = فوراً).
  final int timeoutMinutes;

  LockSettings copyWith({bool? enabled, int? timeoutMinutes}) => LockSettings(
        enabled: enabled ?? this.enabled,
        timeoutMinutes: timeoutMinutes ?? this.timeoutMinutes,
      );
}

/// واجهة صغيرة فوق التخزين الآمن كي تُستبدل في الاختبارات.
abstract interface class SecureKeyValue {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureKeyValue implements SecureKeyValue {
  FlutterSecureKeyValue()
      : _storage = const FlutterSecureStorage(
          // first_unlock_this_device: متاح بعد أول فتح للقفل (لمعالجة إشعار في
          // الخلفية)، و«this_device» يمنع انتقاله لجهاز آخر عبر نسخة احتياطية.
          iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
          aOptions: AndroidOptions(),
        );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class InMemorySecureKeyValue implements SecureKeyValue {
  final Map<String, String> data = {};

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<void> write(String key, String value) async => data[key] = value;

  @override
  Future<void> delete(String key) async => data.remove(key);
}

/// الرمز يعيش هنا فقط — لا shared_preferences، لا sqflite، لا سجلات.
class SessionStore {
  SessionStore(this._kv);

  final SecureKeyValue _kv;

  static const _sessionKey = 'hader.session';
  static const _lockEnabledKey = 'hader.lock.enabled';
  static const _lockTimeoutKey = 'hader.lock.timeout';
  static const _lockPinKey = 'hader.lock.pin';
  static const _lockFailsKey = 'hader.lock.fails';

  Future<Session?> read() async {
    try {
      final raw = await _kv.read(_sessionKey);
      if (raw == null) return null;
      final s = Session.fromJson(asMap(jsonDecode(raw)));
      // جلسة منتهية بحسب الخادم: لا نفتح الصندوق بها ثم نُطرد بعد ثانية.
      final exp = s?.expiresAt;
      if (exp != null && exp.isBefore(DateTime.now().toUtc())) {
        await clear();
        return null;
      }
      return s;
    } catch (_) {
      // Keychain تالف أو مفتاح Keystore تغيّر (استعادة جهاز): خروج نظيف.
      await clear();
      return null;
    }
  }

  Future<void> write(Session s) => _kv.write(_sessionKey, jsonEncode(s.toJson()));

  Future<void> clear() async {
    try {
      await _kv.delete(_sessionKey);
    } catch (_) {}
  }

  Future<LockSettings> readLock() async {
    try {
      final enabled = await _kv.read(_lockEnabledKey) == 'true';
      final timeout = int.tryParse(await _kv.read(_lockTimeoutKey) ?? '') ?? 1;
      return LockSettings(enabled: enabled, timeoutMinutes: timeout.clamp(0, 60));
    } catch (_) {
      return const LockSettings();
    }
  }

  Future<void> writeLock(LockSettings s) async {
    await _kv.write(_lockEnabledKey, '${s.enabled}');
    await _kv.write(_lockTimeoutKey, '${s.timeoutMinutes}');
  }

  /// رمز القفل مجزّأً («v1:ملح:بصمة») — الرمز نفسه لا يُخزَّن أبداً.
  Future<String?> readPinHash() async {
    try {
      return await _kv.read(_lockPinKey);
    } catch (_) {
      return null;
    }
  }

  Future<void> writePinHash(String? hash) =>
      hash == null ? _kv.delete(_lockPinKey) : _kv.write(_lockPinKey, hash);

  /// المحاولات الفاشلة ووقت انتهاء الإيقاف — في التخزين لا في الذاكرة، وإلا
  /// صار إغلاق التطبيق وفتحه طريقاً لتصفير العدّاد وتجربة رموز بلا حدّ.
  Future<({int fails, DateTime? until})> readPinFails() async {
    try {
      final raw = await _kv.read(_lockFailsKey);
      final parts = (raw ?? '').split('|');
      final fails = int.tryParse(parts.first) ?? 0;
      final until = parts.length > 1 ? DateTime.tryParse(parts[1]) : null;
      return (fails: fails, until: until);
    } catch (_) {
      return (fails: 0, until: null);
    }
  }

  Future<void> writePinFails(int fails, DateTime? until) =>
      _kv.write(_lockFailsKey, '$fails|${until?.toUtc().toIso8601String() ?? ''}');

  /// يمحو كل ما في التخزين الآمن — يُستدعى عند تثبيت جديد.
  ///
  /// Keychain في iOS **يبقى بعد حذف التطبيق**؛ بدون هذا، من يثبّت التطبيق
  /// من جديد (أو يشتري هاتفاً مستعملاً لم يُمسح) يجد جلسة المالك السابق.
  Future<void> wipeAll() async {
    for (final k in [_sessionKey, _lockEnabledKey, _lockTimeoutKey, _lockPinKey, _lockFailsKey]) {
      try {
        await _kv.delete(k);
      } catch (_) {}
    }
  }
}
