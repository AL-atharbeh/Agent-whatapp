import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/format.dart';
import 'package:hader/data/models.dart';

void main() {
  final now = DateTime.utc(2026, 10, 16, 12);

  ChatWindow openFor(Duration d) => ChatWindow(open: true, closesAt: now.add(d));

  group('نافذة الرد', () {
    test('ساعات بصيغة العدد العربية والتقريب للأسفل', () {
      expect(windowRemainingLabel(openFor(const Duration(hours: 6, minutes: 40)), now), 'باقي ٦ ساعات للرد');
      expect(windowRemainingLabel(openFor(const Duration(hours: 1, minutes: 10)), now), 'باقي ساعة للرد');
      expect(windowRemainingLabel(openFor(const Duration(hours: 2, minutes: 5)), now), 'باقي ساعتان للرد');
      expect(windowRemainingLabel(openFor(const Duration(hours: 11)), now), 'باقي ١١ ساعة للرد');
      expect(windowRemainingLabel(openFor(const Duration(hours: 23, minutes: 59)), now), 'باقي ٢٣ ساعة للرد');
    });

    test('دقائق تحت الساعة، وأقل من دقيقة', () {
      expect(windowRemainingLabel(openFor(const Duration(minutes: 45)), now), 'باقي ٤٥ دقيقة للرد');
      expect(windowRemainingLabel(openFor(const Duration(minutes: 5)), now), 'باقي ٥ دقائق للرد');
      expect(windowRemainingLabel(openFor(const Duration(seconds: 30)), now), 'باقي أقل من دقيقة للرد');
    });

    test('مغلقة: من الخادم، أو انقضى closesAt على الجهاز', () {
      expect(windowRemainingLabel(ChatWindow.closed, now), isNull);
      expect(windowRemainingLabel(openFor(const Duration(minutes: -1)), now), isNull);
      expect(openFor(const Duration(minutes: -1)).isOpenAt(now), isFalse);
      expect(windowRemaining(openFor(const Duration(seconds: -1)), now), isNull);
    });

    test('مفتوحة بلا closesAt (حقل ناقص) لا تنهار', () {
      const w = ChatWindow(open: true);
      expect(w.isOpenAt(now), isTrue);
      expect(windowRemainingLabel(w, now), 'نافذة الرد مفتوحة');
      expect(windowShortLabel(w, now), isNull);
    });

    test('المختصر والإلحاح', () {
      expect(windowShortLabel(openFor(const Duration(hours: 6, minutes: 5)), now), '٦س');
      expect(windowShortLabel(openFor(const Duration(minutes: 30)), now), '٣٠د');
      expect(windowUrgency(openFor(const Duration(hours: 10)), now), WindowUrgency.calm);
      expect(windowUrgency(openFor(const Duration(hours: 2)), now), WindowUrgency.soon);
      expect(windowUrgency(openFor(const Duration(minutes: 30)), now), WindowUrgency.critical);
    });
  });

  group('الأرقام والوقت', () {
    test('أرقام هندية ولا تمسّ غير الأرقام', () {
      expect(arDigits(2026), '٢٠٢٦');
      expect(arDigits('a1-b2'), 'a١-b٢');
      expect(badgeCount(7), '٧');
      expect(badgeCount(150), '٩٩+');
    });

    test('الوقت النسبي', () {
      final n = DateTime(2026, 10, 16, 15); // الجمعة
      expect(relativeTime(n.subtract(const Duration(seconds: 20)), n), 'الآن');
      expect(relativeTime(n.subtract(const Duration(minutes: 5)), n), '٥ د');
      expect(relativeTime(DateTime(2026, 10, 16, 9, 5), n), '٩:٠٥ ص');
      expect(relativeTime(DateTime(2026, 10, 15, 22), n), 'أمس');
      expect(relativeTime(DateTime(2026, 10, 13, 10), n), 'الثلاثاء');
      expect(relativeTime(DateTime(2026, 10, 6, 10), n), '٦/١٠/٢٠٢٦');
    });

    test('فواصل التاريخ بأسماء أشهر الشام', () {
      final n = DateTime(2026, 10, 16, 15);
      expect(dateSeparator(DateTime(2026, 10, 16, 1), n), 'اليوم');
      expect(dateSeparator(DateTime(2026, 10, 15, 23), n), 'أمس');
      expect(dateSeparator(DateTime(2026, 9, 1), n), '١ أيلول');
      expect(dateSeparator(DateTime(2025, 1, 3), n), '٣ كانون الثاني ٢٠٢٥');
    });

    test('الساعة ١٢ ظهراً ومنتصف الليل', () {
      expect(clockTime(DateTime(2026, 1, 1, 12, 0)), '١٢:٠٠ م');
      expect(clockTime(DateTime(2026, 1, 1, 0, 7)), '١٢:٠٧ ص');
    });
  });

  group('الهواتف', () {
    test('تجميع مقروء حسب رمز الدولة', () {
      expect(formatPhone('+962770466649'), '+962 77 046 6649');
      expect(formatPhone('+966501234567'), '+966 50 123 4567');
      expect(formatPhone('+201001234567'), '+20 100 123 4567');
    });

    test('المعرّفات غير الهاتفية كما هي', () {
      expect(formatPhone('17841400123456789'), '17841400123456789');
      expect(formatPhone('dana.designs'), 'dana.designs');
      expect(formatPhone(''), '');
    });

    test('العزل الاتجاهي حول الرقم', () {
      expect(ltr('+962'), '\u2066+962\u2069');
    });
  });
}
