import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../theme.dart';

/// نص يُعرض دائماً من اليسار لليمين (أرقام هواتف، معرّفات، بريد).
///
/// داخل واجهة RTL يقلب محرّك النص ترتيب «+962 77 046» إلى «046 77 +962»
/// إن تُرك لقواعد ثنائية الاتجاه. عزله بـDirectionality يمنع ذلك تماماً.
class LtrText extends StatelessWidget {
  const LtrText(this.text, {super.key, this.style, this.maxLines = 1});

  final String text;
  final TextStyle? style;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    // المحاذاة تتبع الواجهة المحيطة لا النص: داخل سطر RTL يلتصق الرقم بجهة
    // البداية (اليمين) كبقية النصوص، وإلا انزاح يساراً وانفصل عن عنوانه.
    final ambient = Directionality.maybeOf(context) ?? TextDirection.rtl;
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(
        text,
        style: style,
        maxLines: maxLines,
        overflow: TextOverflow.ellipsis,
        textDirection: TextDirection.ltr,
        textAlign: ambient == TextDirection.rtl ? TextAlign.right : TextAlign.left,
      ),
    );
  }
}

/// صورة رمزية بالحرف الأول، بلون ثابت لكل عميل (من معرّفه) كي يتعرّف عليه
/// المالك بالنظر في القائمة.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({super.key, required this.seed, required this.label, this.size = 48, this.badge});

  final String seed;
  final String label;
  final double size;
  final Widget? badge;

  static const _palette = [
    Color(0xFF34D399), Color(0xFF60A5FA), Color(0xFFF472B6), Color(0xFFFBBF24),
    Color(0xFFA78BFA), Color(0xFF22D3EE), Color(0xFFFB923C), Color(0xFF4ADE80),
  ];

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final color = _palette[seed.hashCode.abs() % _palette.length];
    final trimmed = label.trim();
    final first = trimmed.isEmpty ? '؟' : String.fromCharCodes(trimmed.runes.take(1));
    final isDigit = RegExp(r'[\d+]').hasMatch(first);
    return SizedBox.square(
      dimension: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Color.alphaBlend(color.withValues(alpha: 0.16), hc.surface),
              border: Border.all(color: color.withValues(alpha: 0.28)),
            ),
            child: isDigit
                ? Icon(Icons.person_rounded, color: color, size: size * 0.5)
                : Text(
                    first,
                    style: TextStyle(
                      fontFamily: kFont,
                      fontSize: size * 0.4,
                      fontWeight: FontWeight.w700,
                      color: color,
                      height: 1.1,
                    ),
                  ),
          ),
          if (badge != null) PositionedDirectional(bottom: -2, end: -2, child: badge!),
        ],
      ),
    );
  }
}

/// دائرة عدد (غير مقروء / تحويل).
class CountBadge extends StatelessWidget {
  const CountBadge({super.key, required this.count, required this.color, required this.textColor, this.size = 20});

  final int count;
  final Color color;
  final Color textColor;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        constraints: BoxConstraints(minWidth: size, minHeight: size),
        padding: const EdgeInsets.symmetric(horizontal: 5),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(size)),
        child: Text(
          badgeCount(count),
          style: TextStyle(
            fontFamily: kFont,
            fontSize: size * 0.6,
            fontWeight: FontWeight.w700,
            color: textColor,
            height: 1.15,
          ),
        ),
      );
}

/// حالة فارغة/خطأ مركزية بأيقونة ونص وزر اختياري.
class StateMessage extends StatelessWidget {
  const StateMessage({
    super.key,
    required this.icon,
    required this.title,
    this.body,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? body;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: hc.surface2,
                borderRadius: BorderRadius.circular(R.lg),
                border: Border.all(color: hc.border),
              ),
              child: Icon(icon, color: hc.text3, size: 28),
            ),
            const SizedBox(height: 16),
            Text(title, style: tt.titleMedium, textAlign: TextAlign.center),
            if (body != null) ...[
              const SizedBox(height: 6),
              Text(body!, style: tt.bodySmall, textAlign: TextAlign.center),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

/// شريط «بلا اتصال» — يوضّح أن المعروض نسخة محفوظة لا مباشرة.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: hc.warnDim,
      child: Row(
        children: [
          Icon(Icons.cloud_off_rounded, size: 16, color: hc.warn),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'بلا اتصال — تعرض آخر نسخة محفوظة، والرسائل تُرسل عند عودة الشبكة.',
              style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.warn, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

/// عنوان قسم صغير داخل القوائم.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.color, this.trailing, this.icon});

  final String text;
  final Color? color;
  final Widget? trailing;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final c = color ?? hc.text3;
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 18, 16, 8),
      child: Row(
        children: [
          if (icon != null) ...[Icon(icon, size: 15, color: c), const SizedBox(width: 6)],
          Text(
            text,
            style: TextStyle(fontFamily: kFont, fontSize: 12.5, fontWeight: FontWeight.w600, color: c, height: 1.3),
          ),
          const Spacer(),
          ?trailing,
        ],
      ),
    );
  }
}

/// بطاقة سطحية بحدود — حاوية الإعدادات والملف.
class SurfaceCard extends StatelessWidget {
  const SurfaceCard({super.key, required this.child, this.padding = EdgeInsets.zero});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    // Material لا Container: ListTile وInkWell يرسمان تموّج اللمس على أقرب
    // Material؛ خلف لون Container يختفي التموّج ويبدو الزر ميتاً.
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Material(
        color: hc.surface,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(R.lg),
          side: BorderSide(color: hc.border),
        ),
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
