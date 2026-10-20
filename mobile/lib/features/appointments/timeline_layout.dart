import '../../data/appointments.dart';
import '../../data/schedule.dart';

/// حسابات خط اليوم — نقيّة بلا Flutter كي تُختبر وحدها.
///
/// الرسم يأخذ من هنا أرقاماً (أعلى، ارتفاع، جزء من العرض) فقط. «البداية» في
/// [BlockLayout.startFraction] هي **بداية السطر**: يمين الشاشة في RTL. الويدجت
/// يضعها بـPositionedDirectional، فالمسار الأول يقع على اليمين دون أي قلب يدوي.

/// نافذة اليوم المرسومة: من أول ساعة دوام/موعد إلى آخرها، مقرّبة لساعات كاملة.
class DayWindow {
  const DayWindow(this.start, this.end);

  final DateTime start;
  final DateTime end;

  int get minutes => end.difference(start).inMinutes;

  /// [defaultStartHour]–[defaultEndHour] حين لا دوام ولا مواعيد (يوم عطلة فارغ).
  factory DayWindow.forDay({
    required DateTime day,
    required List<StaffMember> staff,
    required List<TimeSpan> spans,
    int defaultStartHour = 9,
    int defaultEndHour = 21,
  }) {
    int? first;
    int? last;
    void take(int a, int b) {
      first = first == null || a < first! ? a : first;
      last = last == null || b > last! ? b : last;
    }

    for (final s in staff) {
      for (final r in s.hoursOn(day)) {
        take(r.start, r.end);
      }
    }
    final midnight = DateTime(day.year, day.month, day.day);
    for (final sp in spans) {
      final a = sp.start.toLocal().difference(midnight).inMinutes;
      final b = sp.end.toLocal().difference(midnight).inMinutes;
      take(a.clamp(0, 24 * 60), b.clamp(0, 24 * 60));
    }
    var startMin = first ?? defaultStartHour * 60;
    var endMin = last ?? defaultEndHour * 60;
    startMin = (startMin ~/ 60) * 60;
    endMin = ((endMin + 59) ~/ 60) * 60;
    if (endMin - startMin < 4 * 60) endMin = (startMin + 4 * 60).clamp(0, 24 * 60);
    return DayWindow(midnight.add(Duration(minutes: startMin)), midnight.add(Duration(minutes: endMin)));
  }

  double offsetMinutes(DateTime t) => t.toLocal().difference(start).inSeconds / 60;

  bool contains(DateTime t) => !t.toLocal().isBefore(start) && t.toLocal().isBefore(end);
}

class BlockLayout {
  const BlockLayout({
    required this.appointment,
    required this.top,
    required this.height,
    required this.startFraction,
    required this.widthFraction,
    this.processingTop,
    this.processingHeight,
    this.nestedIn,
  });

  final Appointment appointment;

  /// بكسلات من أعلى النافذة.
  final double top;
  final double height;

  /// من بداية العمود (يمين في RTL) ومن عرضه، بين ٠ و١.
  final double startFraction;
  final double widthFraction;

  /// وقت الانتظار داخل الكتلة نفسها (نسبةً لأعلاها) — يُرسم مخطّطاً.
  final double? processingTop;
  final double? processingHeight;

  /// موعد يقع بكامله في وقت انتظار موعد آخر: يُرسم فوقه مزاحاً لا بجانبه،
  /// كي يُفهم أنه «داخل» ذلك الوقت الحرّ.
  final String? nestedIn;

  bool get faded => appointment.status.releasesTime;
}

/// أقل ارتفاع للكتلة — موعد ٥ دقائق يجب أن يبقى قابلاً للّمس والقراءة.
const minBlockHeight = 26.0;

/// كتل عمود واحد (مقدّم خدمة واحد).
List<BlockLayout> layoutColumn({
  required List<Appointment> items,
  required DayWindow window,
  required DateTime now,
  required double pxPerMinute,
  required ServiceOffering? Function(Appointment) serviceOf,
}) {
  final visible = [
    for (final a in items)
      if (_clip(displaySpan(a, now), window) != null) a,
  ]..sort((a, b) {
      final c = displaySpan(a, now).start.compareTo(displaySpan(b, now).start);
      // الملغى خلف الفعّال حين يتشاركان الوقت
      if (c != 0) return c;
      return (a.status.releasesTime ? 1 : 0).compareTo(b.status.releasesTime ? 1 : 0);
    });

  // ١) المتداخلات داخل وقت انتظار غيرها.
  final nestedParent = <String, Appointment>{};
  for (final a in visible) {
    if (a.status.releasesTime) continue;
    final span = displaySpan(a, now);
    for (final p in visible) {
      if (identical(p, a) || p.status.releasesTime) continue;
      final gap = processingSpan(p, serviceOf(p), now);
      if (gap != null && gap.contains(span)) {
        nestedParent[a.id] = p;
        break;
      }
    }
  }

  // ٢) مسارات جنباً إلى جنب لما تبقّى من تداخل (حجز مزدوج، ملغى تحت فعّال…).
  final laneOf = <String, int>{};
  final clusterLanes = <String, int>{};
  final roots = visible.where((a) => !nestedParent.containsKey(a.id)).toList();
  var cluster = <Appointment>[];
  DateTime? clusterEnd;
  final laneEnds = <DateTime>[];

  void closeCluster() {
    final n = laneEnds.length;
    for (final a in cluster) {
      clusterLanes[a.id] = n;
    }
    cluster = [];
    laneEnds.clear();
    clusterEnd = null;
  }

  for (final a in roots) {
    final sp = displaySpan(a, now);
    if (clusterEnd != null && !sp.start.isBefore(clusterEnd!)) closeCluster();
    var lane = laneEnds.indexWhere((end) => !sp.start.isBefore(end));
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.add(sp.end);
    } else {
      laneEnds[lane] = sp.end;
    }
    laneOf[a.id] = lane;
    cluster.add(a);
    clusterEnd = clusterEnd == null || sp.end.isAfter(clusterEnd!) ? sp.end : clusterEnd;
  }
  closeCluster();

  final rootLayout = <String, ({double start, double width})>{};
  for (final a in roots) {
    final lanes = clusterLanes[a.id] ?? 1;
    final w = 1 / lanes;
    rootLayout[a.id] = (start: (laneOf[a.id] ?? 0) * w, width: w);
  }

  ({double start, double width}) geometry(Appointment a) {
    final p = nestedParent[a.id];
    if (p == null) return rootLayout[a.id]!;
    final pg = geometry(p);
    // مزاح ٢٢٪ من عرض الأب: الأب يبقى مرئياً، والابن واضح أنه بداخله.
    const inset = 0.22;
    return (start: pg.start + pg.width * inset, width: pg.width * (1 - inset));
  }

  return [
    for (final a in visible)
      () {
        final span = _clip(displaySpan(a, now), window)!;
        final top = window.offsetMinutes(span.start) * pxPerMinute;
        final rawHeight = span.minutes * pxPerMinute;
        final height = rawHeight < minBlockHeight ? minBlockHeight : rawHeight;
        final g = geometry(a);
        final gap = a.status.releasesTime ? null : processingSpan(a, serviceOf(a), now);
        final gapClipped = gap == null ? null : _clip(gap, window);
        return BlockLayout(
          appointment: a,
          top: top,
          height: height,
          startFraction: g.start,
          widthFraction: g.width,
          processingTop: gapClipped == null ? null : gapClipped.start.difference(span.start).inSeconds / 60 * pxPerMinute,
          processingHeight: gapClipped == null ? null : gapClipped.minutes * pxPerMinute,
          nestedIn: nestedParent[a.id]?.id,
        );
      }(),
  ];
}

TimeSpan? _clip(TimeSpan s, DayWindow w) {
  final a = s.start.isBefore(w.start) ? w.start : s.start;
  final b = s.end.isAfter(w.end) ? w.end : s.end;
  return a.isBefore(b) ? TimeSpan(a, b) : null;
}

/// الوقت الحرّ لمقدّم خدمة: دوامه ناقص انشغاله (الأجزاء المشغولة، فوقت
/// الانتظار يظهر حرّاً)، ولا شيء في الماضي، وأقصر من [minMinutes] يُهمل —
/// فجوة ٥ دقائق لا يُحجز فيها شيء ورسمها ضجيج.
List<TimeSpan> freeGaps({
  required DateTime day,
  required List<DayRange> hours,
  required List<Appointment> items,
  required DateTime now,
  required ServiceOffering? Function(Appointment) serviceOf,
  int minMinutes = 15,
}) {
  final midnight = DateTime(day.year, day.month, day.day);
  final busy = [
    for (final a in items) ...busySegments(a, serviceOf(a), now),
  ]..sort((a, b) => a.start.compareTo(b.start));
  final out = <TimeSpan>[];
  for (final r in hours) {
    var cursor = midnight.add(Duration(minutes: r.start));
    final end = midnight.add(Duration(minutes: r.end));
    final localNow = now.toLocal();
    if (cursor.isBefore(localNow)) cursor = localNow.isBefore(end) ? localNow : end;
    for (final b in busy) {
      final bs = b.start.toLocal();
      final be = b.end.toLocal();
      if (!be.isAfter(cursor) || !bs.isBefore(end)) continue;
      if (bs.isAfter(cursor)) _addGap(out, cursor, bs.isBefore(end) ? bs : end, minMinutes);
      if (be.isAfter(cursor)) cursor = be;
    }
    _addGap(out, cursor, end, minMinutes);
  }
  return out;
}

void _addGap(List<TimeSpan> out, DateTime a, DateTime b, int minMinutes) {
  if (b.difference(a).inMinutes >= minMinutes) out.add(TimeSpan(a, b));
}
