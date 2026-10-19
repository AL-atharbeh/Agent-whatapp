import 'dart:ui';

import 'package:flutter/material.dart';

/// سطح زجاجي: يطمس ما خلفه ويُبقيه مرئياً.
///
/// العناصر العائمة — البار السفلي ودائرة القنوات — تجلس فوق القائمة لا تحتها.
/// لو كانت معتمة لاقتطعت من الشاشة شريطاً لا يُرى ما تحته، فيبدو آخر صف
/// مقطوعاً. الزجاج يترك المحتوى يمرّ خلفه ويحافظ على قراءة ما فوقه.
///
/// الحافة اللامعة وتدرّج الضوء من الأعلى هما ما يجعله «زجاجاً» لا مجرد
/// شفافية: بدونهما يذوب العنصر في الخلفية حين تكون فاتحة.
class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.radius = 999,
    this.blur = 22,
    this.padding,
    this.tint,
    this.shadow = true,
  });

  final Widget child;
  final double radius;
  final double blur;
  final EdgeInsetsGeometry? padding;

  /// لون يُمزج بالزجاج (للعنصر المختار مثلاً). بدونه: محايد بحسب الثيم.
  final Color? tint;
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final shape = BorderRadius.circular(radius);

    final fill = tint ??
        (dark ? const Color(0xFF1C1C21).withValues(alpha: 0.62) : Colors.white.withValues(alpha: 0.70));
    final edge = dark ? Colors.white.withValues(alpha: 0.13) : Colors.white.withValues(alpha: 0.85);
    final sheen = dark ? Colors.white.withValues(alpha: 0.08) : Colors.white.withValues(alpha: 0.45);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shape,
        boxShadow: shadow
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.45 : 0.10),
                  blurRadius: 28,
                  offset: const Offset(0, 10),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: shape,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: fill,
              borderRadius: shape,
              border: Border.all(color: edge, width: 0.8),
            ),
            // الضوء من الأعلى: طبقة فوق اللون لا بدلاً منه
            foregroundDecoration: BoxDecoration(
              borderRadius: shape,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.center,
                colors: [sheen, sheen.withValues(alpha: 0)],
              ),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}
