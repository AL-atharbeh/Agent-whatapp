import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// رسالة FCM مختصرة بما يهمّنا من العقد (data.type/conversationId/channel).
class PushPayload {
  const PushPayload({this.conversationId, this.type, this.title, this.body});

  factory PushPayload.fromRemote(RemoteMessage m) => PushPayload(
        conversationId: _str(m.data['conversationId']),
        type: _str(m.data['type']),
        title: m.notification?.title,
        body: m.notification?.body,
      );

  static String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;

  final String? conversationId;
  final String? type;
  final String? title;
  final String? body;
}

/// الإشعارات — اختيارية بالكامل.
///
/// إن لم تُهيّأ Firebase (ملف إعداد مفقود، خطأ في الإعداد، محاكي بلا APNs)
/// يصبح كل شيء هنا بلا أثر ويعيش التطبيق على الاستطلاع كل ٨ ثوانٍ. لا مسار
/// هنا يرمي إلى الأعلى: إشعار معطّل يجب ألّا يمنع أحداً من رؤية صندوقه.
class PushService {
  PushService._(this.available);

  /// خدمة معطّلة — للاختبارات وللحالة التي فشلت فيها Firebase.
  factory PushService.disabled() => PushService._(false);

  final bool available;

  static Future<PushService> initialize() async {
    try {
      await Firebase.initializeApp().timeout(const Duration(seconds: 6));
      // على iOS نعرض نحن التنبيه داخل التطبيق في المقدّمة؛ تنبيه النظام فوق
      // محادثة يقرؤها المالك الآن مزعج ومكرّر.
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: true,
        sound: false,
      );
      return PushService._(true);
    } catch (e) {
      debugPrint('[push] Firebase غير مهيّأة — الاستطلاع وحده: ${e.runtimeType}');
      return PushService._(false);
    }
  }

  /// يطلب الإذن ويعيد رمز FCM، أو null.
  Future<String?> token() async {
    if (!available) return null;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return null;
      if (Platform.isIOS) {
        // FCM على iOS يحتاج رمز APNs أولاً؛ قد يتأخر ثوانٍ بعد أول تشغيل،
        // وعلى المحاكي قد لا يصل أبداً.
        String? apns;
        for (var i = 0; i < 5 && apns == null; i++) {
          apns = await FirebaseMessaging.instance.getAPNSToken();
          if (apns == null) await Future<void>.delayed(const Duration(seconds: 1));
        }
        if (apns == null) return null;
      }
      // رمز التسجيل الكلاسيكي لا معرّف التثبيت (FID) الذي تقترحه register():
      // الخادم يرسل عبر FCM HTTP v1 بحقل `token`، وإرسال FID يحتاج مساراً آخر
      // لم يُتفق عليه في العقد بعد.
      // ignore: deprecated_member_use
      return await FirebaseMessaging.instance.getToken();
    } catch (e) {
      debugPrint('[push] تعذّر الحصول على الرمز: ${e.runtimeType}');
      return null;
    }
  }

  Stream<String> get onTokenRefresh =>
      // ignore: deprecated_member_use
      available ? FirebaseMessaging.instance.onTokenRefresh.handleError((_) {}) : const Stream.empty();

  /// إشعار وصل والتطبيق في المقدّمة.
  Stream<PushPayload> get onForeground => available
      ? FirebaseMessaging.onMessage.map(PushPayload.fromRemote).handleError((_) {})
      : const Stream.empty();

  /// نقرة على إشعار والتطبيق في الخلفية.
  Stream<PushPayload> get onOpened => available
      ? FirebaseMessaging.onMessageOpenedApp.map(PushPayload.fromRemote).handleError((_) {})
      : const Stream.empty();

  /// الإشعار الذي فتح التطبيق من حالة الإغلاق التام.
  Future<PushPayload?> initialMessage() async {
    if (!available) return null;
    try {
      final m = await FirebaseMessaging.instance.getInitialMessage();
      return m == null ? null : PushPayload.fromRemote(m);
    } catch (_) {
      return null;
    }
  }
}

final pushServiceProvider = Provider<PushService>((_) => PushService.disabled());

/// محادثة طُلب فتحها من إشعار، تنتظر أن يصبح التطبيق جاهزاً (دخول + فتح القفل).
final pendingDeepLinkProvider = NotifierProvider<PendingDeepLink, String?>(PendingDeepLink.new);

class PendingDeepLink extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? id) => state = id;
}
