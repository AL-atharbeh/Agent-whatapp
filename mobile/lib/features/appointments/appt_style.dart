import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';

/// ألوان الحالات ونصوصها — مكان واحد كي يقرأ المالك اللون نفسه في الخط
/// الزمني والورقة والملف.
///
/// الأخضر («الحياة» في هوية حاضر) للمؤكَّد — موعد سيحدث. الكهرماني للجاري —
/// يحتاج انتباهاً لأنه يستهلك الوقت الآن. الأحمر للغياب وحده: الحدث الذي
/// يكلّف المال. والمنتهي رمادي هادئ — لم يعد يطلب شيئاً.
Color statusColor(HaderColors hc, AppointmentStatus s) => switch (s) {
      AppointmentStatus.booked => const Color(0xFF60A5FA),
      AppointmentStatus.confirmed => hc.live,
      AppointmentStatus.inProgress => hc.warn,
      AppointmentStatus.done => hc.text3,
      AppointmentStatus.cancelled => hc.text3,
      AppointmentStatus.noShow => hc.danger,
      AppointmentStatus.unknown => hc.text3,
    };

IconData statusIcon(AppointmentStatus s) => switch (s) {
      AppointmentStatus.booked => Icons.event_outlined,
      AppointmentStatus.confirmed => Icons.event_available_rounded,
      AppointmentStatus.inProgress => Icons.play_circle_outline_rounded,
      AppointmentStatus.done => Icons.check_circle_outline_rounded,
      AppointmentStatus.cancelled => Icons.event_busy_outlined,
      AppointmentStatus.noShow => Icons.person_off_outlined,
      AppointmentStatus.unknown => Icons.help_outline_rounded,
    };

IconData actionIcon(AppointmentAction a) => switch (a) {
      AppointmentAction.confirm => Icons.check_rounded,
      AppointmentAction.start => Icons.play_arrow_rounded,
      AppointmentAction.finish => Icons.flag_rounded,
      AppointmentAction.noShow => Icons.person_off_outlined,
      AppointmentAction.cancel => Icons.close_rounded,
    };

/// «الثلاثاء ٢٠ تشرين الأول».
String dayTitle(DateTime d) => '${arWeekday(d)} ${arDigits(d.day)} ${arMonth(d.month)}';

String timeRange(DateTime a, DateTime b) => '${clockTime(a)} – ${clockTime(b)}';

/// «١٢٫٥» / «١٥» — الرقم وحده؛ [money] يضيف العملة.
String price(double v) {
  final whole = v == v.roundToDouble();
  final s = whole ? v.toStringAsFixed(0) : v.toStringAsFixed(2).replaceFirst(RegExp(r'0$'), '');
  return arDigits(s.replaceAll('.', '٫'));
}

String priceRange(ServiceOffering s, [String? currency]) {
  final max = s.priceMax;
  final range = max == null || max <= s.priceMin ? price(s.priceMin) : '${price(s.priceMin)}–${price(max)}';
  return withCurrency(range, currency);
}

/// السعر مع عملة المتجر: «١٥ د.أ». بلا عملة معروفة ⇒ الرقم وحده.
String money(double v, [String? currency]) => withCurrency(price(v), currency);

String withCurrency(String amount, String? currency) {
  final label = currencyLabel(currency);
  return label == null ? amount : '$amount $label';
}

/// الرمز العربي المألوف للعملات الشائعة لدى عملائنا، وإلا الرمز كما هو.
String? currencyLabel(String? code) => switch (code?.toUpperCase()) {
      null || '' => null,
      'JOD' => 'د.أ',
      'SAR' => 'ر.س',
      'AED' => 'د.إ',
      'USD' => r'$',
      final c => c,
    };

/// «٤٥ دقيقة · حسب زيارات العميل السابقة (٣)».
String durationBasisText(int minutes, DurationEstimate? e) {
  final base = arMinutes(minutes);
  if (e == null || e.basis == DurationBasis.unknown) return base;
  final samples = e.samples > 0 ? ' (${arDigits(e.samples)})' : '';
  return '$base · ${e.basis.label}$samples';
}

/// اسم العميل أو رقمه — الرقم معزول LTR كي لا تنقلب «+962» داخل جملة عربية.
String customerLabel(CustomerRef? c) {
  if (c == null) return 'عميل';
  if (c.name != null) return c.name!;
  if (c.phone != null) return ltr(formatPhone(c.phone!));
  return 'عميل';
}
