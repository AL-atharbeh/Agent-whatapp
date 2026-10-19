import 'dart:math';

import 'package:dio/dio.dart';

import '../../core/json.dart';

/// متى نعيد الطلب تلقائياً، وبعد كم.
///
/// القاعدة: لا إعادة إلا لما لا يضرّ تكراره. GET/PUT/DELETE بطبيعتها،
/// وPOST فقط إن عُلِّم `idempotent` — وهو ما نفعله للإرسال الحامل clientId
/// (الخادم يعيد نفس الرسالة بلا إرسال ثانٍ) ولتغييرات الحالة التي تنتهي
/// لنفس النتيجة مهما تكررت. تسجيل الدخول لا يُعاد أبداً: كل محاولة تُحسب في
/// عدّاد الحظر (٥ خلال ١٥ دقيقة).
class RetryPolicy {
  const RetryPolicy({
    this.maxRetries = 2,
    this.baseDelay = const Duration(milliseconds: 600),
    this.maxRetryAfter = const Duration(seconds: 5),
  });

  static const idempotentKey = 'idempotent';
  static const attemptKey = 'retryAttempt';

  final int maxRetries;
  final Duration baseDelay;

  /// Retry-After أطول من هذا لا ننتظره داخل الطلب — نعيد الخطأ ليقرّر
  /// المستوى الأعلى (الطابور يؤجّل، الشاشة تعرض الرسالة).
  final Duration maxRetryAfter;

  bool isIdempotent(RequestOptions o) {
    const safe = {'GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'};
    if (safe.contains(o.method.toUpperCase())) return true;
    return o.extra[idempotentKey] == true;
  }

  /// المدة قبل المحاولة التالية، أو null = لا إعادة.
  Duration? delayFor(DioException e, {Random? random}) {
    final o = e.requestOptions;
    final attempt = (o.extra[attemptKey] as int?) ?? 0;
    if (attempt >= maxRetries || !isIdempotent(o)) return null;

    final retryable = switch (e.type) {
      DioExceptionType.connectionError ||
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        true,
      DioExceptionType.badResponse => _retryableStatus(e.response),
      DioExceptionType.unknown => e.error is! FormatException,
      _ => false,
    };
    if (!retryable) return null;

    if (e.response?.statusCode == 429) {
      final ra = int.tryParse(e.response?.headers.value('retry-after') ?? '');
      final wait = Duration(seconds: ra ?? 1);
      return wait <= maxRetryAfter ? wait : null;
    }

    // تراجع أسّي مع ارتعاش: ألف هاتف عاد إليه الإنترنت في نفس اللحظة لا
    // يجب أن يضربوا الخادم في نفس الملّي ثانية.
    final jitter = (random ?? Random()).nextInt(250);
    return baseDelay * pow(2, attempt).toInt() + Duration(milliseconds: jitter);
  }

  /// ‎502/503/504 **بلا** رمز العقد = بوابة، لا قرار من خادمنا. أما ‎502 مع
  /// SEND_FAILED فـMeta رفضت فعلاً؛ تكرارها آلياً يكرّر الرفض بلا فائدة.
  bool _retryableStatus(Response<Object?>? r) {
    final s = r?.statusCode;
    if (s == null) return false;
    if (s == 429) return true;
    if (s < 502 || s > 504) return false;
    final code = readStringOrNull(asMap(asMap(r?.data)['error']), 'code');
    return code == null;
  }
}
