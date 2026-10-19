import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// ألوان «حاضر» — منقولة من src/app/globals.css في لوحة الويب.
///
/// نفس الفلسفة: أسود عميق، ولون واحد للحياة («أخضر الحضور») لا يُستخدم
/// للزينة بل لما هو حيّ فقط: متصل، نافذة مفتوحة، إرسال ناجح. الأحمر للفعل
/// المطلوب من المالك (تحويل ينتظره) — وإن كثر فقد معناه.
@immutable
class HaderColors extends ThemeExtension<HaderColors> {
  const HaderColors({
    required this.bg,
    required this.bg2,
    required this.surface,
    required this.surface2,
    required this.surface3,
    required this.border,
    required this.border2,
    required this.text,
    required this.text2,
    required this.text3,
    required this.live,
    required this.live2,
    required this.liveDim,
    required this.onLive,
    required this.warn,
    required this.warnDim,
    required this.danger,
    required this.dangerDim,
    required this.handoff,
    required this.bubbleHuman,
    required this.onBubbleHuman,
    required this.bubbleAgent,
    required this.bubbleUser,
  });

  final Color bg, bg2, surface, surface2, surface3;
  final Color border, border2;
  final Color text, text2, text3;
  final Color live, live2, liveDim, onLive;
  final Color warn, warnDim, danger, dangerDim;

  /// الشارة الحمراء: محادثة تنتظر صاحب المتجر.
  final Color handoff;

  /// فقاعة رد الموظف (أنت)، فقاعة الوكيل، فقاعة العميل.
  final Color bubbleHuman, onBubbleHuman, bubbleAgent, bubbleUser;

  static const dark = HaderColors(
    bg: Color(0xFF09090B),
    bg2: Color(0xFF0D0E12),
    surface: Color(0xFF131418),
    surface2: Color(0xFF191B21),
    surface3: Color(0xFF20222A),
    border: Color(0xFF24262E),
    border2: Color(0xFF2F323C),
    text: Color(0xFFF4F4F5),
    text2: Color(0xFFA1A1AA),
    text3: Color(0xFF6B6D76),
    live: Color(0xFF34D399),
    live2: Color(0xFF10B981),
    liveDim: Color(0x2634D399),
    onLive: Color(0xFF04140C),
    warn: Color(0xFFFBBF24),
    warnDim: Color(0x1FFBBF24),
    danger: Color(0xFFFB7185),
    dangerDim: Color(0x1FFB7185),
    handoff: Color(0xFFF43F5E),
    bubbleHuman: Color(0xFF34D399),
    onBubbleHuman: Color(0xFF04140C),
    bubbleAgent: Color(0xFF1B2620),
    bubbleUser: Color(0xFF191B21),
  );

  /// الفاتح ليس عكساً آلياً: الأخضر أغمق كي يبقى مقروءاً على الأبيض (تباين
  /// ‎#34d399 على الأبيض أقل من ٢:١).
  static const light = HaderColors(
    bg: Color(0xFFFAFAFA),
    bg2: Color(0xFFF4F4F5),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFF4F4F5),
    surface3: Color(0xFFE9E9EC),
    border: Color(0xFFE4E4E7),
    border2: Color(0xFFD4D4D8),
    text: Color(0xFF09090B),
    text2: Color(0xFF52525B),
    text3: Color(0xFF8A8A93),
    live: Color(0xFF059669),
    live2: Color(0xFF047857),
    liveDim: Color(0x1A059669),
    onLive: Color(0xFFFFFFFF),
    warn: Color(0xFFB45309),
    warnDim: Color(0x1AD97706),
    danger: Color(0xFFE11D48),
    dangerDim: Color(0x14E11D48),
    handoff: Color(0xFFE11D48),
    bubbleHuman: Color(0xFF059669),
    onBubbleHuman: Color(0xFFFFFFFF),
    bubbleAgent: Color(0xFFE7F5EE),
    bubbleUser: Color(0xFFFFFFFF),
  );

  @override
  HaderColors copyWith() => this;

  @override
  HaderColors lerp(ThemeExtension<HaderColors>? other, double t) {
    if (other is! HaderColors) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return HaderColors(
      bg: l(bg, other.bg),
      bg2: l(bg2, other.bg2),
      surface: l(surface, other.surface),
      surface2: l(surface2, other.surface2),
      surface3: l(surface3, other.surface3),
      border: l(border, other.border),
      border2: l(border2, other.border2),
      text: l(text, other.text),
      text2: l(text2, other.text2),
      text3: l(text3, other.text3),
      live: l(live, other.live),
      live2: l(live2, other.live2),
      liveDim: l(liveDim, other.liveDim),
      onLive: l(onLive, other.onLive),
      warn: l(warn, other.warn),
      warnDim: l(warnDim, other.warnDim),
      danger: l(danger, other.danger),
      dangerDim: l(dangerDim, other.dangerDim),
      handoff: l(handoff, other.handoff),
      bubbleHuman: l(bubbleHuman, other.bubbleHuman),
      onBubbleHuman: l(onBubbleHuman, other.onBubbleHuman),
      bubbleAgent: l(bubbleAgent, other.bubbleAgent),
      bubbleUser: l(bubbleUser, other.bubbleUser),
    );
  }
}

extension HaderThemeX on BuildContext {
  HaderColors get hc => Theme.of(this).extension<HaderColors>() ?? HaderColors.dark;
}

const kFont = 'IBMPlexSansArabic';

/// أنصاف الأقطار من نفس السلّم في الويب.
abstract final class R {
  static const xs = 6.0;
  static const sm = 10.0;
  static const md = 14.0;
  static const lg = 20.0;
  static const xl = 28.0;
}

ThemeData buildTheme(Brightness b) {
  final c = b == Brightness.dark ? HaderColors.dark : HaderColors.light;
  final scheme = ColorScheme(
    brightness: b,
    primary: c.live,
    onPrimary: c.onLive,
    secondary: c.live2,
    onSecondary: c.onLive,
    error: c.danger,
    onError: Colors.white,
    surface: c.bg,
    onSurface: c.text,
    surfaceContainerLowest: c.bg,
    surfaceContainerLow: c.surface,
    surfaceContainer: c.surface,
    surfaceContainerHigh: c.surface2,
    surfaceContainerHighest: c.surface3,
    onSurfaceVariant: c.text2,
    outline: c.border2,
    outlineVariant: c.border,
  );

  // أحجام تقرأ العربية براحة: IBM Plex Arabic ذو ارتفاع x صغير نسبياً، و١٥
  // في الويب تقابل ١٥–١٦ هنا. ارتفاع السطر ١٫٥ يمنع قصّ التشكيل والهمزات.
  TextStyle t(double size, FontWeight w, Color color, {double height = 1.5}) =>
      TextStyle(fontFamily: kFont, fontSize: size, fontWeight: w, color: color, height: height);

  final text = TextTheme(
    displaySmall: t(30, FontWeight.w700, c.text, height: 1.3),
    headlineMedium: t(26, FontWeight.w700, c.text, height: 1.35),
    headlineSmall: t(22, FontWeight.w700, c.text, height: 1.35),
    titleLarge: t(19, FontWeight.w700, c.text, height: 1.4),
    titleMedium: t(16, FontWeight.w600, c.text),
    titleSmall: t(14, FontWeight.w600, c.text),
    bodyLarge: t(16, FontWeight.w400, c.text),
    bodyMedium: t(15, FontWeight.w400, c.text),
    bodySmall: t(13, FontWeight.w400, c.text2),
    labelLarge: t(15, FontWeight.w600, c.text),
    labelMedium: t(13, FontWeight.w500, c.text2),
    labelSmall: t(11.5, FontWeight.w500, c.text3),
  );

  final overlay = b == Brightness.dark
      ? SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent)
      : SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent);

  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    fontFamily: kFont,
    textTheme: text,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    extensions: [c],
    splashFactory: InkSparkle.splashFactory,
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: c.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      systemOverlayStyle: overlay,
      titleTextStyle: text.titleLarge,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.bg2,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.liveDim,
      height: 66,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => t(12, s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
            s.contains(WidgetState.selected) ? c.text : c.text3, height: 1.2),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? c.live : c.text3),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      hintStyle: t(15, FontWeight.w400, c.text3),
      labelStyle: t(15, FontWeight.w400, c.text2),
      floatingLabelStyle: t(14, FontWeight.w500, c.live),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: c.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: c.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: c.live, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: c.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: c.danger, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.live,
        foregroundColor: c.onLive,
        disabledBackgroundColor: c.surface3,
        disabledForegroundColor: c.text3,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.md)),
        textStyle: t(16, FontWeight.w600, c.onLive),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.text,
        side: BorderSide(color: c.border2),
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.md)),
        textStyle: t(15, FontWeight.w600, c.text),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.live,
        minimumSize: const Size(48, 44),
        textStyle: t(15, FontWeight.w600, c.live),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: c.border2,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.lg)),
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium?.copyWith(color: c.text2),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.surface3,
      contentTextStyle: t(14.5, FontWeight.w500, c.text),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.md)),
      insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.onLive : c.text3,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.live : c.surface3,
      ),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.live : c.text3,
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.live),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: c.live,
      selectionColor: c.liveDim,
      selectionHandleColor: c.live,
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      },
    ),
  );
}
