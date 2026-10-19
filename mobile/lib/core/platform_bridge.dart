import 'package:flutter/services.dart';

/// جسر صغير للكود الأصلي (AppDelegate.swift / MainActivity.kt).
///
/// كل نداء محاط بـtry: غياب التنفيذ الأصلي (اختبارات، منصة أخرى) يجب أن
/// يُنقص ميزة حماية، لا أن يُسقط التطبيق.
class PlatformBridge {
  const PlatformBridge();

  static const _channel = MethodChannel('hader/platform');

  /// iOS: يستثني مجلداً من نسخ iCloud الاحتياطي.
  Future<void> excludeFromBackup(String path) async {
    try {
      await _channel.invokeMethod<bool>('excludeFromBackup', {'path': path});
    } catch (_) {}
  }

  /// أندرويد ١٣+: يخفي لقطة التطبيق في شاشة التطبيقات الأخيرة.
  Future<void> setSecureRecents(bool enabled) async {
    try {
      await _channel.invokeMethod<void>('setSecureRecents', {'enabled': enabled});
    } catch (_) {}
  }
}
