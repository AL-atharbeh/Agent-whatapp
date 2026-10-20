import 'json.dart';

/// رموز الخطأ من العقد (docs/mobile-api.md) + ما يحدث قبل أن يصل الخادم.
///
/// المنطق يُبنى على [ApiErrorCode] لا على نص الرسالة ولا على رقم HTTP وحده:
/// ‎409 مثلاً تعني «النافذة مغلقة» مرة و«القناة غير مربوطة» مرة أخرى.
enum ApiErrorCode {
  invalidInput('INVALID_INPUT'),
  unauthenticated('UNAUTHENTICATED'),
  invalidCredentials('INVALID_CREDENTIALS'),
  adminNotSupported('ADMIN_NOT_SUPPORTED'),
  notFound('NOT_FOUND'),

  /// الوقت أُخذ بين عرضه والحجز (حجزان متزامنان) — اقترح غيره.
  slotTaken('SLOT_TAKEN'),

  /// المتجر موقوف/اشتراكه منتهٍ: القراءة تعمل، الإرسال لا. ليس خروجاً.
  tenantInactive('TENANT_INACTIVE'),
  windowClosed('WINDOW_CLOSED'),

  /// إرسال بنفس clientId ما زال جارياً على الخادم — انتظر، لا تُعِد.
  inProgress('IN_PROGRESS'),

  /// Meta لم تؤكّد ولم ترفض — قد تكون وصلت العميل. لا إعادة تلقائية أبداً.
  deliveryUnknown('DELIVERY_UNKNOWN'),
  channelNotConnected('CHANNEL_NOT_CONNECTED'),
  templateInvalid('TEMPLATE_INVALID'),
  rateLimited('RATE_LIMITED'),
  sendFailed('SEND_FAILED'),
  internal('INTERNAL'),

  /// ردّ ‎5xx بلا جسم العقد — بوابة Vercel أو انقطاع، لا قرار من خادمنا.
  serverUnavailable('SERVER_UNAVAILABLE'),

  /// لا اتصال، أو انقطع قبل وصول رد.
  network('NETWORK'),
  timeout('TIMEOUT'),
  unknown('UNKNOWN');

  const ApiErrorCode(this.wire);
  final String wire;

  static ApiErrorCode? fromWire(String? s) {
    if (s == null) return null;
    for (final c in values) {
      if (c.wire == s) return c;
    }
    return null;
  }
}

class ApiError implements Exception {
  const ApiError(this.code, this.message, {this.status, this.retryAfter});

  final ApiErrorCode code;

  /// نص عربي جاهز للعرض — من الخادم إن أرسله، وإلا من [defaultMessage].
  final String message;
  final int? status;
  final Duration? retryAfter;

  /// هل يُعقل أن تنجح نفس العملية لاحقاً دون تغيير، **ولم يصل الطلب لقرار**؟
  ///
  /// هذا ما يفصل «يبقى في الطابور ويُعاد تلقائياً» عن «يقرّر المستخدم».
  /// المؤقت هنا هو ما لم يصل فيه رد من خادمنا أصلاً (شبكة، مهلة، بوابة)، أو
  /// رفض مؤقت صريح (‎429) — والإعادة بنفس clientId آمنة لأن الخادم يحجز
  /// المعرّف قبل أن يكلّم Meta. ‎SEND_FAILED وDELIVERY_UNKNOWN ليسا مؤقتين:
  /// الأول رفض نهائي يُخبَر به المالك، والثاني قد يكون وصل فلا يُكرَّر آلياً.
  bool get isTransient => switch (code) {
        ApiErrorCode.network ||
        ApiErrorCode.timeout ||
        ApiErrorCode.rateLimited ||
        ApiErrorCode.serverUnavailable =>
          true,
        _ => false,
      };

  bool get isOffline =>
      code == ApiErrorCode.network || code == ApiErrorCode.timeout;

  /// يبني الخطأ من رد HTTP غير ناجح.
  ///
  /// جسم العقد `{error:{code,message}}` هو المرجع. إن غاب (HTML من بوابة،
  /// أو جسم فارغ) نستنتج من رقم الحالة — وبحذر: ‎502 بلا رمز ليست
  /// SEND_FAILED، بل بوابة متعطّلة، والرسالة قد تكون أُرسلت أو لا؛ لذا
  /// تُعامل كمؤقتة ويُعاد إرسالها بنفس clientId فيمنع الخادم التكرار.
  factory ApiError.fromResponse(
    int? status,
    Object? body, {
    String? retryAfterHeader,
  }) {
    final err = asMap(asMap(body)['error']);
    final wireCode = readStringOrNull(err, 'code');
    final serverMessage = readNonEmptyOrNull(err, 'message');
    final code = ApiErrorCode.fromWire(wireCode) ?? _codeFromStatus(status);
    return ApiError(
      code,
      serverMessage ?? defaultMessage(code),
      status: status,
      retryAfter: _parseRetryAfter(retryAfterHeader),
    );
  }

  static ApiErrorCode _codeFromStatus(int? status) {
    if (status == null) return ApiErrorCode.unknown;
    if (status == 400) return ApiErrorCode.invalidInput;
    if (status == 401) return ApiErrorCode.unauthenticated;
    if (status == 404) return ApiErrorCode.notFound;
    if (status == 422) return ApiErrorCode.templateInvalid;
    if (status == 429) return ApiErrorCode.rateLimited;
    if (status == 500) return ApiErrorCode.internal;
    if (status >= 502 && status <= 504) return ApiErrorCode.serverUnavailable;
    return ApiErrorCode.unknown;
  }

  static Duration? _parseRetryAfter(String? header) {
    final secs = int.tryParse(header?.trim() ?? '');
    if (secs == null || secs < 0) return null;
    // سقف دفاعي: رأس خاطئ بقيمة يوم كامل لا يجمّد التطبيق.
    return Duration(seconds: secs > 3600 ? 3600 : secs);
  }

  static String defaultMessage(ApiErrorCode code) => switch (code) {
        ApiErrorCode.invalidInput => 'البيانات المُدخلة غير صحيحة.',
        ApiErrorCode.unauthenticated => 'انتهت الجلسة. سجّل الدخول من جديد.',
        ApiErrorCode.invalidCredentials =>
          'البريد أو كلمة السر غير صحيحة.',
        ApiErrorCode.adminNotSupported =>
          'هذا التطبيق لأصحاب المتاجر. حساب مالك المنصة يعمل من لوحة الويب.',
        ApiErrorCode.notFound => 'غير موجود أو لم يعد متاحاً.',
        ApiErrorCode.slotTaken => 'أُخذ هذا الوقت للتو. اختر وقتاً آخر.',
        ApiErrorCode.tenantInactive => 'المتجر غير نشط — الإرسال متوقّف.',
        ApiErrorCode.inProgress => 'الإرسال ما زال جارياً…',
        ApiErrorCode.deliveryUnknown => 'غير مؤكّد — ربما وصلت للعميل.',
        ApiErrorCode.windowClosed =>
          'انتهت نافذة الرد (٢٤ ساعة). أرسل قالباً معتمداً بدلاً من ذلك.',
        ApiErrorCode.channelNotConnected => 'هذه القناة غير مربوطة لمتجرك.',
        ApiErrorCode.templateInvalid =>
          'القالب غير معتمد أو متغيّراته ناقصة.',
        ApiErrorCode.rateLimited => 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
        ApiErrorCode.sendFailed => 'رفضت Meta الرسالة — لم تصل للعميل.',
        ApiErrorCode.internal => 'حدث خطأ غير متوقّع. حاول مرة أخرى.',
        ApiErrorCode.serverUnavailable =>
          'الخادم غير متاح مؤقتاً. سنعيد المحاولة.',
        ApiErrorCode.network => 'لا يوجد اتصال بالإنترنت.',
        ApiErrorCode.timeout => 'انقطع الاتصال قبل وصول الرد.',
        ApiErrorCode.unknown => 'تعذّر إتمام العملية. حاول مرة أخرى.',
      };

  @override
  String toString() => 'ApiError(${code.wire}, $status)';
}
