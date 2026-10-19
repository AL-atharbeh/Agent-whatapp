/// إعدادات وقت البناء.
///
/// تُقرأ من `--dart-define` لا من ملف: ملف إعدادات داخل الحزمة يمكن تعديله
/// بعد التثبيت، أما الثابت المترجَم فجزء من الكود نفسه.
class AppConfig {
  const AppConfig({
    required this.apiBase,
    required this.useFakeApi,
    this.fakeFailRate = 0,
    this.fakeLiveInbound = true,
    this.fakeTenantInactive = false,
  });

  /// القيم الفعلية لهذا البناء.
  ///
  /// الدومين الخاص لا `*.vercel.app`: بعض شركات الاتصالات تحجب كل ما ينتهي
  /// بـ `vercel.app` بفحص اسم الموقع في الاتصال. كروم يمرّ لأنه يخفي الاسم،
  /// وتطبيقنا لا — فكان الدخول ينقطع على شبكة الجوال وينجح في المتصفح على
  /// نفس الجهاز، وصاحب المتجر لا يرى في ذلك إلا تطبيقاً معطوباً.
  factory AppConfig.fromEnvironment() {
    const base = String.fromEnvironment(
      'API_BASE',
      defaultValue: 'https://hader.shifracode.com/api/mobile/v1',
    );
    const fake = bool.fromEnvironment('USE_FAKE_API');
    const failRate = String.fromEnvironment('FAKE_FAIL_RATE', defaultValue: '0');
    const inactive = bool.fromEnvironment('FAKE_TENANT_INACTIVE');
    return AppConfig(
      apiBase: _normalizeBase(base),
      useFakeApi: fake,
      fakeFailRate: (double.tryParse(failRate) ?? 0).clamp(0, 1).toDouble(),
      fakeTenantInactive: inactive,
    );
  }

  final String apiBase;
  final bool useFakeApi;

  /// نسبة الطلبات التي يُفشلها الخادم الوهمي عمداً (٠–١) لاختبار المسارات
  /// الصعبة: إعادة المحاولة، الطابور، رسائل الخطأ.
  final double fakeFailRate;

  /// رسائل عملاء «تصل» دورياً في الوضع الوهمي كي يظهر أثر الاستطلاع.
  final bool fakeLiveInbound;

  /// يبدأ الخادم الوهمي بمتجر موقوف (‎403 TENANT_INACTIVE على كل إرسال).
  final bool fakeTenantInactive;

  /// شرطة مائلة زائدة في النهاية تنتج `//auth/login` فيرفضه بعض الخوادم.
  static String _normalizeBase(String raw) {
    var s = raw.trim();
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    return s;
  }
}
