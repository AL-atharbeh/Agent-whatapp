import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// المظهر المحفوظ عند التشغيل — يُقرأ في main قبل أول إطار.
///
/// لو قُرئ بعد ظهور التطبيق لومضت الشاشة بمظهر النظام ثم انقلبت لما اختاره
/// المستخدم: وميض أبيض في وجه من اختار الداكن ليلاً.
final initialThemeModeProvider = Provider<ThemeMode>((_) => ThemeMode.system);

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);

/// النظام أو فاتح أو داكن — تفضيل للجهاز لا للحساب: يبقى بعد الخروج، لأن
/// من يقرأ في الظلام يريده داكناً أياً كان الحساب.
class ThemeModeController extends Notifier<ThemeMode> {
  static const key = 'pref.themeMode';

  @override
  ThemeMode build() => ref.read(initialThemeModeProvider);

  void set(ThemeMode mode) {
    if (mode == state) return;
    state = mode;
    // الحفظ لا يؤخّر التبديل: المظهر يتغيّر فوراً، والقرص يلحقه
    unawaited(ref.read(databaseProvider).setValue(key, mode.name).catchError((_) {}));
  }

  /// قيمة مجهولة أو تالفة ⇒ النظام، لا انهيار.
  static ThemeMode parse(String? v) =>
      ThemeMode.values.firstWhere((m) => m.name == v, orElse: () => ThemeMode.system);
}
