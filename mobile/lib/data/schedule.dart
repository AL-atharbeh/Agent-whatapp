import 'appointments.dart';

/// قواعد الجدول من docs/appointments.md، بكود نقيّ واحد يستخدمه الخادم
/// الوهمي (لاقتراح الأوقات ورفض التضارب) والواجهة (لرسم الكتل). لو كُتبت
/// مرتين لاختلفتا يوماً ما: الواجهة ترسم وقتاً حرّاً ثم يرفضه «الخادم».

class TimeSpan {
  const TimeSpan(this.start, this.end);

  final DateTime start;
  final DateTime end;

  int get minutes => end.difference(start).inMinutes;

  bool overlaps(TimeSpan o) => start.isBefore(o.end) && o.start.isBefore(end);

  bool contains(TimeSpan o) => !o.start.isBefore(start) && !o.end.isAfter(end);

  @override
  bool operator ==(Object other) => other is TimeSpan && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);

  @override
  String toString() => 'TimeSpan($start → $end)';
}

/// الفترة التي يشغلها الموعد من وقت مقدّم الخدمة (القاعدة ٢)، أو null للملغى/الغياب.
///
/// - DONE: الفعلي — من خلص بدري حرّر وقته.
/// - IN_PROGRESS: من البدء إلى max(الآن، البدء + المخطّط) — من طوّل يمتد للآن.
/// - BOOKED/CONFIRMED: المخطّط.
TimeSpan? occupiedSpan(Appointment a, DateTime now) {
  if (a.status.releasesTime) return null;
  switch (a.status) {
    case AppointmentStatus.done:
      final s = a.startedAt ?? a.startAt;
      final e = a.finishedAt ?? (a.actualMinutes != null ? s.add(Duration(minutes: a.actualMinutes!)) : a.plannedEnd);
      return TimeSpan(s, e.isAfter(s) ? e : s.add(const Duration(minutes: 5)));
    case AppointmentStatus.inProgress:
      final s = a.startedAt ?? a.startAt;
      final planned = s.add(Duration(minutes: a.plannedMinutes));
      return TimeSpan(s, now.isAfter(planned) ? now : planned);
    default:
      return TimeSpan(a.startAt, a.plannedEnd);
  }
}

/// الفترة المرسومة للموعد — للملغى والغياب: المخطّط (يُرسم باهتاً).
TimeSpan displaySpan(Appointment a, DateTime now) =>
    occupiedSpan(a, now) ?? TimeSpan(a.startAt, a.plannedEnd);

/// وقت الانتظار داخل الخدمة (مادة تثبت، تخدير يسري): مقدّم الخدمة حرّ فيه.
/// يُقصّ إلى حدود الموعد.
TimeSpan? processingSpan(Appointment a, ServiceOffering? service, DateTime now) {
  if (service == null || !service.hasProcessing) return null;
  final occ = displaySpan(a, now);
  final s = occ.start.add(Duration(minutes: service.processingAfterMinutes));
  final e = s.add(Duration(minutes: service.processingMinutes));
  if (!s.isBefore(occ.end)) return null;
  return TimeSpan(s, e.isAfter(occ.end) ? occ.end : e);
}

/// الأجزاء المشغولة فعلاً: الفترة ناقص وقت الانتظار، ثم الفاصل بعد الموعد.
List<TimeSpan> busySegments(
  Appointment a,
  ServiceOffering? service,
  DateTime now, {
  int bufferMinutes = 0,
}) {
  final occ = occupiedSpan(a, now);
  if (occ == null) return const [];
  final end = occ.end.add(Duration(minutes: bufferMinutes));
  final gap = processingSpan(a, service, now);
  if (gap == null) return [TimeSpan(occ.start, end)];
  return [
    if (gap.start.isAfter(occ.start)) TimeSpan(occ.start, gap.start),
    if (end.isAfter(gap.end)) TimeSpan(gap.end, end),
  ];
}

/// موعد جديد مقبول إن لم يتقاطع أيّ من أجزائه المشغولة مع أجزاء غيره.
///
/// هذا يطبّق «يُقبل داخل وقت الانتظار فقط إن وقع بكامله فيه» تلقائياً:
/// ما يخرج عن الفترة الحرّة ولو بدقيقة يلمس جزءاً مشغولاً.
bool segmentsConflict(List<TimeSpan> a, List<TimeSpan> b) {
  for (final x in a) {
    for (final y in b) {
      if (x.overlaps(y)) return true;
    }
  }
  return false;
}

/// الوسيط، لا المتوسط: جلسة شاذّة واحدة لا تفسد التقدير.
double median(List<int> xs) {
  final s = [...xs]..sort();
  final n = s.length;
  if (n == 0) return 0;
  return n.isOdd ? s[n ~/ 2].toDouble() : (s[n ~/ 2 - 1] + s[n ~/ 2]) / 2;
}

/// للأعلى إلى ٥ دقائق، ولا يقلّ عن ٥.
int roundUp5(num minutes) {
  final m = (minutes / 5).ceil() * 5;
  return m < 5 ? 5 : m;
}

/// مُقدِّر المدة (القاعدة ١): تاريخ العميل (آخر ٣) ⇒ تاريخ مقدّم الخدمة (آخر ١٠) ⇒ الافتراضي.
/// القوائم مرتّبة من الأحدث للأقدم.
DurationEstimate estimateDuration({
  required List<int> customerActuals,
  required List<int> staffActuals,
  required int defaultMinutes,
}) {
  final c = customerActuals.where((m) => m > 0).take(3).toList();
  if (c.isNotEmpty) {
    return DurationEstimate(minutes: roundUp5(median(c)), basis: DurationBasis.customer, samples: c.length);
  }
  final s = staffActuals.where((m) => m > 0).take(10).toList();
  if (s.isNotEmpty) {
    return DurationEstimate(minutes: roundUp5(median(s)), basis: DurationBasis.staff, samples: s.length);
  }
  return DurationEstimate(minutes: roundUp5(defaultMinutes), basis: DurationBasis.fallback);
}

/// الأوقات المتاحة لمقدّم خدمة في يوم (القاعدة ٣).
///
/// [day] منتصف ليل اليوم المحلي. الساعات بتوقيت الجهاز = توقيت المتجر (انظر
/// تقرير العقد: المنطقة الزمنية للمتجر لا تصل للتطبيق بعد).
List<DateTime> freeStarts({
  required DateTime day,
  required List<DayRange> hours,
  required int minutes,
  required ServiceOffering? Function(Appointment) serviceOf,
  required List<Appointment> staffAppointments,
  required DateTime now,
  required ServiceOffering? service,
  int stepMinutes = 15,
  int bufferMinutes = 0,
}) {
  final taken = <TimeSpan>[
    for (final a in staffAppointments)
      ...busySegments(a, serviceOf(a), now, bufferMinutes: bufferMinutes),
  ];
  final out = <DateTime>[];
  for (final r in hours) {
    for (var m = r.start; m + minutes <= r.end; m += stepMinutes) {
      final start = DateTime(day.year, day.month, day.day).add(Duration(minutes: m));
      if (start.isBefore(now)) continue;
      final candidate = Appointment(
        id: '_candidate',
        customerId: '',
        staffId: '',
        serviceId: service?.id ?? '',
        startAt: start,
        plannedMinutes: minutes,
        status: AppointmentStatus.booked,
      );
      final mine = busySegments(candidate, service, now, bufferMinutes: bufferMinutes);
      if (!segmentsConflict(mine, taken)) out.add(start);
    }
  }
  return out;
}
