import '../data/models.dart';

/// تنسيق الأرقام والأزمنة بالعربية.
///
/// مكتوب يدوياً بدل intl DateFormat لسببين: نريد أرقاماً هندية (٠١٢) في
/// النص وأرقاماً لاتينية في أرقام الهواتف، ونريد أسماء أشهر الشام (كانون،
/// شباط…) التي يقرؤها عملاؤنا في الأردن — لا «يناير».

const _arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

String arDigits(Object n) {
  final s = n.toString();
  final b = StringBuffer();
  for (final ch in s.runes) {
    final c = String.fromCharCode(ch);
    final d = int.tryParse(c);
    b.write(d != null && c.codeUnitAt(0) < 128 ? _arabicDigits[d] : c);
  }
  return b.toString();
}

/// العدد مع المعدود بقواعد العربية:
/// ١ ساعة، ٢ ساعتان، ٣–١٠ ساعات، ١١+ ساعة.
String arCount(int n, {required String one, required String two, required String few}) {
  if (n == 1) return one;
  if (n == 2) return two;
  final mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return '${arDigits(n)} $few';
  return '${arDigits(n)} $one';
}

String arHours(int n) => arCount(n, one: 'ساعة', two: 'ساعتان', few: 'ساعات');
String arMinutes(int n) => arCount(n, one: 'دقيقة', two: 'دقيقتان', few: 'دقائق');
String arDays(int n) => arCount(n, one: 'يوم', two: 'يومان', few: 'أيام');

/// عدد للشارة: ما فوق ٩٩ يصبح «٩٩+» كي لا تتمدّد الدائرة.
String badgeCount(int n) => n > 99 ? '${arDigits(99)}+' : arDigits(n);

// ───────────── نافذة الرد ─────────────

enum WindowUrgency { calm, soon, critical }

/// المتبقي من نافذة الـ٢٤ ساعة، أو null إن كانت مغلقة.
Duration? windowRemaining(ChatWindow w, DateTime now) {
  if (!w.isOpenAt(now)) return null;
  final c = w.closesAt;
  if (c == null) return null;
  return c.difference(now);
}

/// «باقي ٦ ساعات للرد» — للمحرّر.
///
/// الساعات تُقرّب للأسفل: «باقي ٦ ساعات» وفي الحقيقة ٦:٤٠ أصدق من «٧»
/// قد تجعل المالك يؤجّل الرد فيفوته.
String? windowRemainingLabel(ChatWindow w, DateTime now) {
  if (!w.isOpenAt(now)) return null;
  final r = windowRemaining(w, now);
  if (r == null) return 'نافذة الرد مفتوحة';
  if (r.inMinutes < 1) return 'باقي أقل من دقيقة للرد';
  if (r.inHours < 1) return 'باقي ${arMinutes(r.inMinutes)} للرد';
  return 'باقي ${arHours(r.inHours)} للرد';
}

/// مختصر لصف القائمة: «٦س» / «٤٥د».
String? windowShortLabel(ChatWindow w, DateTime now) {
  final r = windowRemaining(w, now);
  if (r == null) return null;
  if (r.inHours >= 1) return '${arDigits(r.inHours)}س';
  return '${arDigits(r.inMinutes < 1 ? 1 : r.inMinutes)}د';
}

WindowUrgency windowUrgency(ChatWindow w, DateTime now) {
  final r = windowRemaining(w, now);
  if (r == null) return WindowUrgency.calm;
  if (r <= const Duration(hours: 1)) return WindowUrgency.critical;
  if (r <= const Duration(hours: 3)) return WindowUrgency.soon;
  return WindowUrgency.calm;
}

// ───────────── الوقت ─────────────

const _weekdays = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const _months = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];

/// أسماء الأيام والأشهر للشاشات الأخرى (المواعيد) — نفس المصدر كي لا
/// يظهر «أيلول» في مكان و«سبتمبر» في آخر.
String arWeekday(DateTime d) => _weekdays[d.weekday - 1];
String arMonth(int month) => _months[(month - 1).clamp(0, 11)];

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

int _daysBetween(DateTime a, DateTime b) =>
    _day(b).difference(_day(a)).inHours ~/ 24;

/// «٣:٠٥ م».
String clockTime(DateTime at) {
  final l = at.toLocal();
  final h12 = l.hour % 12 == 0 ? 12 : l.hour % 12;
  final mm = l.minute.toString().padLeft(2, '0');
  return '${arDigits(h12)}:${arDigits(mm)} ${l.hour < 12 ? 'ص' : 'م'}';
}

/// الوقت النسبي لصف المحادثة، بأسلوب تطبيقات المراسلة.
String relativeTime(DateTime at, DateTime now) {
  final l = at.toLocal();
  final n = now.toLocal();
  final diff = n.difference(l);
  if (diff.inSeconds < 60) return 'الآن';
  if (diff.inMinutes < 60) return '${arDigits(diff.inMinutes)} د';
  final days = _daysBetween(l, n);
  if (days <= 0) return clockTime(l);
  if (days == 1) return 'أمس';
  if (days < 7) return _weekdays[l.weekday - 1];
  return '${arDigits(l.day)}/${arDigits(l.month)}/${arDigits(l.year)}';
}

/// فاصل التاريخ داخل المحادثة.
String dateSeparator(DateTime at, DateTime now) {
  final l = at.toLocal();
  final days = _daysBetween(l, now.toLocal());
  if (days <= 0) return 'اليوم';
  if (days == 1) return 'أمس';
  if (days < 7) return _weekdays[l.weekday - 1];
  final sameYear = l.year == now.toLocal().year;
  return '${arDigits(l.day)} ${_months[l.month - 1]}${sameYear ? '' : ' ${arDigits(l.year)}'}';
}

bool isSameLocalDay(DateTime a, DateTime b) {
  final x = a.toLocal();
  final y = b.toLocal();
  return x.year == y.year && x.month == y.month && x.day == y.day;
}

/// «آخر ظهور» للأجهزة.
String lastSeenLabel(DateTime? at, DateTime now) {
  if (at == null) return 'غير معروف';
  final diff = now.difference(at);
  if (diff.inMinutes < 2) return 'نشط الآن';
  if (diff.inHours < 1) return 'قبل ${arMinutes(diff.inMinutes)}';
  if (diff.inDays < 1) return 'قبل ${arHours(diff.inHours)}';
  return 'قبل ${arDays(diff.inDays)}';
}

// ───────────── الهواتف ─────────────

/// رموز الدول الشائعة لدى عملائنا — لتجميع الرقم بشكل مقروء.
const _countryCodes = ['962', '966', '971', '965', '974', '973', '968', '970', '972', '961', '963', '964', '20', '1', '44', '90'];

/// «‎+962 77 046 6649». المعرّفات غير الهاتفية (إنستغرام/ماسنجر) كما هي.
String formatPhone(String raw) {
  final s = raw.trim();
  if (!RegExp(r'^\+?\d{8,15}$').hasMatch(s)) return s;
  final digits = s.startsWith('+') ? s.substring(1) : s;
  if (!s.startsWith('+')) return s; // لا نعرف أين يبدأ رمز الدولة.
  final cc = _countryCodes.firstWhere(digits.startsWith, orElse: () => '');
  if (cc.isEmpty) return s;
  final rest = digits.substring(cc.length);
  final groups = <String>[];
  if (rest.length == 9) {
    groups.addAll([rest.substring(0, 2), rest.substring(2, 5), rest.substring(5)]);
  } else if (rest.length == 10) {
    groups.addAll([rest.substring(0, 3), rest.substring(3, 6), rest.substring(6)]);
  } else {
    for (var i = 0; i < rest.length; i += 3) {
      groups.add(rest.substring(i, i + 3 > rest.length ? rest.length : i + 3));
    }
  }
  return '+$cc ${groups.join(' ')}';
}

/// يعزل نصاً باتجاه LTR داخل جملة عربية (LRI … PDI) — لاستخدامه داخل
/// نصوص مركّبة كالحوارات، حيث لا يمكن لفّ الرقم بـDirectionality.
/// بدونه يظهر «+962» كـ«962+» وتنقلب مجموعات الأرقام.
String ltr(String s) => '\u2066$s\u2069';

/// اسم العرض: الاسم، أو الرقم المنسّق إن غاب.
String displayName(ConversationItem c) => c.customerName ?? formatPhone(c.displayId);

/// أرقام عربية (٠-٩) وفارسية (۰-۹) إلى لاتينية.
///
/// الكيبورد العربي يكتب «٢٢٦٨» والرقم مخزَّن «2268»: بدون هذا يبحث الموظف
/// عن رقم يراه أمامه في القائمة فلا يجده.
String arToAsciiDigits(String s) => s.replaceAllMapped(
      RegExp('[٠-٩۰-۹]'),
      (m) {
        final c = m[0]!.codeUnitAt(0);
        return String.fromCharCode(0x30 + (c >= 0x06F0 ? c - 0x06F0 : c - 0x0660));
      },
    );
