/// قارئات JSON متسامحة.
///
/// الخادم يُبنى بالتوازي، وحقل ناقص أو بنوع مختلف يجب ألّا يُسقط الشاشة كلها
/// بـ«type 'Null' is not a subtype of 'String'». كل قارئ هنا يعيد قيمة آمنة
/// بدل أن يرمي، والكائنات التي لا معنى لها بلا معرّف تُسقَط من القائمة وحدها.
library;

typedef JsonMap = Map<String, dynamic>;

JsonMap asMap(Object? v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) {
    return v.map((k, val) => MapEntry(k.toString(), val));
  }
  return const {};
}

List<Object?> asList(Object? v) => v is List ? v.cast<Object?>() : const [];

String? readStringOrNull(JsonMap m, String key) {
  final v = m[key];
  if (v == null) return null;
  if (v is String) return v;
  if (v is num || v is bool) return v.toString();
  return null;
}

String readString(JsonMap m, String key, {String fallback = ''}) =>
    readStringOrNull(m, key) ?? fallback;

/// نص غير فارغ أو null — «» و«   » تعامَل كغياب.
String? readNonEmptyOrNull(JsonMap m, String key) {
  final s = readStringOrNull(m, key)?.trim();
  return (s == null || s.isEmpty) ? null : s;
}

int readInt(JsonMap m, String key, {int fallback = 0}) {
  final v = m[key];
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.toInt() ?? fallback;
  return fallback;
}

/// أرقام مالية: Prisma Decimal يصل نصاً («12.50») أو رقماً حسب المسلسِل.
double? readDoubleOrNull(JsonMap m, String key) {
  final v = m[key];
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v.trim());
  return null;
}

bool readBool(JsonMap m, String key, {bool fallback = false}) {
  final v = m[key];
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    if (v == 'true' || v == '1') return true;
    if (v == 'false' || v == '0') return false;
  }
  return fallback;
}

DateTime? readDateOrNull(JsonMap m, String key) {
  final v = m[key];
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v)?.toUtc();
  if (v is int) return DateTime.fromMillisecondsSinceEpoch(v, isUtc: true);
  return null;
}

/// يحلّل كل عنصر على حدة: عنصر فاسد واحد لا يُسقط القائمة.
List<T> readList<T>(JsonMap m, String key, T? Function(JsonMap) parse) {
  final out = <T>[];
  for (final item in asList(m[key])) {
    try {
      final parsed = parse(asMap(item));
      if (parsed != null) out.add(parsed);
    } catch (_) {
      // عنصر لا يُقرأ: نتجاوزه بدل أن نخسر الصفحة.
    }
  }
  return out;
}

List<String> readStringList(JsonMap m, String key) => [
      for (final v in asList(m[key]))
        if (v is String) v else if (v is num) v.toString(),
    ];
