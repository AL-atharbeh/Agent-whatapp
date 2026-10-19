/// ساعة مُصحَّحة بساعة الخادم.
///
/// العقد يحسب النافذة على الخادم «لأن ساعة الجهاز قد تكون خاطئة»، لكنه يعيد
/// `closesAt` مطلقاً فقط — فلو حسبنا «باقي كم» بساعة جهاز متأخرة ساعتين
/// لقلنا «باقي ساعتان» لنافذة أُغلقت فعلاً. نأخذ الفرق من رأس `Date` في كل
/// رد ونطبّقه على العدّ التنازلي.
class ServerClock {
  ServerClock({DateTime Function()? deviceNow})
      : _deviceNow = deviceNow ?? DateTime.now;

  final DateTime Function() _deviceNow;
  Duration _offset = Duration.zero;

  Duration get offset => _offset;

  DateTime now() => _deviceNow().toUtc().add(_offset);

  /// يُستدعى بقيمة رأس Date (دقّته ثانية — كافية لعدّ بالدقائق).
  void observe(DateTime serverTime) {
    final diff = serverTime.toUtc().difference(_deviceNow().toUtc());
    // فرق أقل من ثانيتين ضجيج شبكة لا انحراف ساعة؛ تجاهله يمنع ارتجاف العدّاد.
    if ((diff - _offset).inSeconds.abs() < 2) return;
    _offset = diff;
  }
}
