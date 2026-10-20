import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// ساعة المتجر: يوم المواعيد وساعات الدوام و«الآن» بتوقيت المتجر لا الجهاز.
///
/// صاحب صالون في عمّان يسافر إلى دبي ويفتح التطبيق: بتوقيت الجهاز ينزاح كل
/// موعد ساعة، ويبدو موعد الساعة ١٠ في الساعة ١١، ويتغيّر «اليوم» نفسه قرب
/// منتصف الليل. لذا كل لحظة من الخادم (UTC) تُحوَّل مرة واحدة عند الحدّ إلى
/// «وقت جدار» المتجر، ويُبنى الرسم كله على وقت الجدار هذا.
///
/// وقت الجدار يُمثَّل DateTime محلياً بمكوّنات توقيت المتجر — كي يبقى كل
/// كود الرسم والحساب كما هو (مقارنات، فروق دقائق، أسماء أيام). الفرق الوحيد
/// المحتمل: ساعة تغيير التوقيت الصيفي **في منطقة الجهاز** (فجراً)، ولا نشاط
/// يعمل عندها عملياً.
class StoreClock {
  StoreClock(String? timezone) : _loc = _resolve(timezone);

  /// للاختبارات: منطقة الجهاز.
  const StoreClock.device() : _loc = null;

  final tz.Location? _loc;

  /// اسم المنطقة المستخدمة فعلاً، أو null لمنطقة الجهاز.
  String? get zoneName => _loc?.name;

  static bool _loaded = false;

  static tz.Location? _resolve(String? name) {
    if (name == null || name.trim().isEmpty) return null;
    try {
      if (!_loaded) {
        // بيانات ١٠ سنوات فقط (~٧٠ كيلوبايت) — تكفي لمواعيد اليوم والسنة.
        tzdata.initializeTimeZones();
        _loaded = true;
      }
      return tz.getLocation(name.trim());
    } catch (_) {
      // منطقة مجهولة (اسم خاطئ من الخادم): توقيت الجهاز أفضل من لا شيء.
      return null;
    }
  }

  /// لحظة ⇒ وقت جدار المتجر.
  DateTime wall(DateTime instant) {
    final loc = _loc;
    if (loc == null) return instant.toLocal();
    final t = tz.TZDateTime.from(instant, loc);
    return DateTime(t.year, t.month, t.day, t.hour, t.minute, t.second, t.millisecond);
  }

  DateTime wallNow([DateTime? instant]) => wall(instant ?? DateTime.now());

  /// وقت جدار المتجر ⇒ لحظة حقيقية (UTC) — لما يُرسل للخادم.
  DateTime instant(DateTime wall) {
    final loc = _loc;
    if (loc == null) return wall.toUtc();
    return tz.TZDateTime(loc, wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second, wall.millisecond)
        .toUtc();
  }
}
