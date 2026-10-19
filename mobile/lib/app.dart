import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter/services.dart';

import 'core/appearance.dart';
import 'core/feedback.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/session_controller.dart';
import 'features/home/home_shell.dart';
import 'features/lock/lock_overlay.dart';
import 'ui/theme.dart';

class HaderApp extends ConsumerWidget {
  const HaderApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(sessionProvider.select((s) => s != null));
    return MaterialApp(
      title: 'حاضر',
      debugShowCheckedModeBanner: false,
      navigatorKey: appNavigatorKey,
      scaffoldMessengerKey: appMessengerKey,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      // عربي فقط: الواجهة RTL من الجذر، ونصوص Material (نسخ/لصق، التاريخ)
      // بالعربية أيضاً بدل خليط إنجليزي.
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (context, child) {
        // تكبير الخط من إعدادات النظام محترم، لكن بسقف: ٢٠٠٪ يكسر صفوف
        // القائمة والفقاعات دون أن يزيد المقروئية.
        final mq = MediaQuery.of(context);
        // شريط الحالة بحسب المظهر الفعلي من الجذر: شاشاتنا بلا AppBar، وهو
        // وحده كان يضبطه — فتبقى الساعة بيضاء فوق خلفية فاتحة لا تُقرأ.
        final dark = Theme.of(context).brightness == Brightness.dark;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
              .copyWith(statusBarColor: Colors.transparent),
          child: MediaQuery(
            data: mq.copyWith(textScaler: mq.textScaler.clamp(maxScaleFactor: 1.35)),
            child: LockGate(child: child ?? const SizedBox.shrink()),
          ),
        );
      },
      // تبديل الجذر بين الدخول والصندوق: الخروج (أو ‎401) يمسح كل المكدّس،
      // فلا تبقى شاشة محادثة مفتوحة خلف شاشة الدخول.
      home: signedIn ? const HomeShell(key: ValueKey('home')) : const LoginScreen(key: ValueKey('login')),
    );
  }
}
