import 'package:flutter/material.dart';

/// مفاتيح عامة كي يُظهر منطقٌ خارج شجرة الواجهة (انتهاء جلسة، إشعار وارد)
/// رسالةً أو ينتقل لشاشة، دون تمرير BuildContext عبر كل الطبقات.
final appNavigatorKey = GlobalKey<NavigatorState>();
final appMessengerKey = GlobalKey<ScaffoldMessengerState>();

void showToast(String message, {SnackBarAction? action}) {
  final m = appMessengerKey.currentState;
  if (m == null) return;
  m
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), action: action));
}
