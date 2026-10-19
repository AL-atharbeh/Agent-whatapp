import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../ui/theme.dart';

/// معالجة الأخطاء العامة.
///
/// الهدف ألّا يرى المالك «الشاشة الحمراء» ولا يُغلق التطبيق في وجهه بسبب
/// خطأ في ويدجت واحد أو Future لم يُلتقط. الخطأ يُسجَّل (في التطوير فقط —
/// قد يحمل نص رسالة عميل) ويُستبدل الجزء المكسور برسالة عربية هادئة.
void installGlobalErrorHandlers() {
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    if (kDebugMode) {
      previous?.call(details);
    } else {
      // الإصدار: لا نطبع شيئاً — السجلات على الجهاز يقرؤها أي تطبيق تشخيص.
    }
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    if (kDebugMode) debugPrint('[uncaught] ${error.runtimeType}: $error');
    // true = عولج: لا يُنهي المحرّك التطبيق.
    return true;
  };

  ErrorWidget.builder = (details) => const FriendlyErrorView();
}

/// بديل الويدجت المنهار. لا يعتمد على Theme (قد يكون هو سبب الانهيار).
class FriendlyErrorView extends StatelessWidget {
  const FriendlyErrorView({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = MediaQuery.maybePlatformBrightnessOf(context) != Brightness.light;
    final c = dark ? HaderColors.dark : HaderColors.light;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        color: c.bg,
        padding: const EdgeInsets.all(20),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.sentiment_dissatisfied_outlined, color: c.text3, size: 32),
            const SizedBox(height: 10),
            Text(
              'تعذّر عرض هذا الجزء',
              style: TextStyle(fontFamily: kFont, fontSize: 15, fontWeight: FontWeight.w600, color: c.text, decoration: TextDecoration.none),
            ),
            const SizedBox(height: 4),
            Text(
              'حدث خطأ غير متوقّع. ارجع وحاول مرة أخرى — بياناتك ورسائلك سليمة.',
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: kFont, fontSize: 13, color: c.text2, height: 1.5, decoration: TextDecoration.none),
            ),
          ],
        ),
      ),
    );
  }
}

/// يشغّل دالة دون أن يسقط خطؤها التطبيق (للمهام «أطلق وانسَ»).
void guard(Future<void> Function() f) {
  unawaited(f().catchError((Object e) {
    if (kDebugMode) debugPrint('[guard] ${e.runtimeType}');
  }));
}
