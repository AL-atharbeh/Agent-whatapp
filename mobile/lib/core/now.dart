import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// «الآن» المصحّح بساعة الخادم، يتقدّم كل ٣٠ ثانية.
///
/// يكفي لتحديث «منذ ٥ د» و«باقي ٦ ساعات» دون إعادة رسم كل ثانية، ولقلب
/// المحرّر إلى «أرسل قالب» خلال نصف دقيقة من إغلاق النافذة فعلياً.
final nowProvider = NotifierProvider<NowController, DateTime>(NowController.new);

class NowController extends Notifier<DateTime> {
  @override
  DateTime build() {
    final clock = ref.watch(serverClockProvider);
    final t = Timer.periodic(const Duration(seconds: 30), (_) => state = clock.now());
    ref.onDispose(t.cancel);
    return clock.now();
  }
}
