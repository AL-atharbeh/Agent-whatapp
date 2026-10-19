import 'dart:io';

/// اسم الجهاز ومنصّته كما يُرسلان عند الدخول (يظهران في «أجهزتي»).
///
/// بلا device_info_plus عمداً: إضافة أصلية كاملة لأجل سطر نصي. الاسم
/// التقريبي («iPhone · iOS 26.4») يكفي ليميّز المالك أجهزته.
String devicePlatform() => Platform.isIOS ? 'ios' : (Platform.isAndroid ? 'android' : 'other');

String deviceName() {
  final v = RegExp(r'(\d+(\.\d+)?)').firstMatch(Platform.operatingSystemVersion)?.group(1) ?? '';
  if (Platform.isIOS) return v.isEmpty ? 'iPhone' : 'iPhone · iOS $v';
  // على أندرويد يعيد operatingSystemVersion إصدار النواة لا النظام — لا نعرضه.
  if (Platform.isAndroid) return 'Android';
  return Platform.operatingSystem;
}
