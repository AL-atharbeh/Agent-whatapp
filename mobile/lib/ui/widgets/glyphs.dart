import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:path_parsing/path_parsing.dart';

import '../../data/models.dart';

/// أيقونات القنوات وعلامة «حاضر» مرسومة بالكود.
///
/// نفس مسارات SVG في src/components/icons.tsx و brand.tsx بالويب، كي تتطابق
/// الهوية بين اللوحة والتطبيق — وبلا حزمة أيقونات كاملة (عدة ميغابايت) لأجل
/// ثلاث أيقونات.

class _PathBuilder extends PathProxy {
  final Path path = Path();

  @override
  void moveTo(double x, double y) => path.moveTo(x, y);

  @override
  void lineTo(double x, double y) => path.lineTo(x, y);

  @override
  void cubicTo(double x1, double y1, double x2, double y2, double x3, double y3) =>
      path.cubicTo(x1, y1, x2, y2, x3, y3);

  @override
  void close() => path.close();
}

final Map<String, Path> _pathCache = {};

Path _svg(String d) => _pathCache.putIfAbsent(d, () {
      final b = _PathBuilder();
      writeSvgPathDataToPath(d, b);
      return b.path;
    });

const _whatsappPath =
    'M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.8.1.2 1.9 2.9 4.6 4 1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.2z';

const _messengerPath =
    'M12 2C6.4 2 2 6.1 2 11.3c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.6 0 10-4.1 10-9.3S17.6 2 12 2zm1 12.5-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z';

/// ألوان العلامات التجارية — للتعرّف السريع على القناة بلمحة.
abstract final class BrandColors {
  static const whatsapp = Color(0xFF25D366);
  static const messenger = Color(0xFF0A7CFF);
  static const instagram = [Color(0xFFFEDA75), Color(0xFFFA7E1E), Color(0xFFD62976), Color(0xFF962FBF), Color(0xFF4F5BD5)];

  static Color solid(Channel c) => switch (c) {
        Channel.whatsapp => whatsapp,
        Channel.messenger => messenger,
        Channel.instagram => const Color(0xFFE1306C),
        Channel.unknown => const Color(0xFF6B6D76),
      };
}

/// أيقونة قناة. [color] = null ⇒ لون العلامة (وتدرّج إنستغرام).
class ChannelGlyph extends StatelessWidget {
  const ChannelGlyph(this.channel, {super.key, this.size = 24, this.color});

  final Channel channel;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: size,
        child: CustomPaint(painter: _ChannelPainter(channel, color)),
      );
}

class _ChannelPainter extends CustomPainter {
  _ChannelPainter(this.channel, this.color);

  final Channel channel;
  final Color? color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    canvas.save();
    canvas.scale(s);
    final rect = const Rect.fromLTWH(0, 0, 24, 24);
    final paint = Paint()..isAntiAlias = true;
    switch (channel) {
      case Channel.whatsapp:
        paint.color = color ?? BrandColors.whatsapp;
        canvas.drawPath(_svg(_whatsappPath), paint);
      case Channel.messenger:
        if (color != null) {
          paint.color = color!;
        } else {
          paint.shader = const LinearGradient(
            begin: Alignment.bottomLeft,
            end: Alignment.topRight,
            colors: [Color(0xFF0099FF), Color(0xFFA033FF), Color(0xFFFF5280)],
          ).createShader(rect);
        }
        canvas.drawPath(_svg(_messengerPath), paint);
      case Channel.instagram:
        if (color != null) {
          paint.color = color!;
        } else {
          paint.shader = const LinearGradient(
            begin: Alignment.bottomLeft,
            end: Alignment.topRight,
            colors: BrandColors.instagram,
          ).createShader(rect);
        }
        paint
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2;
        canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(3, 3, 18, 18), const Radius.circular(5)), paint);
        canvas.drawCircle(const Offset(12, 12), 4, paint);
        paint.style = PaintingStyle.fill;
        canvas.drawCircle(const Offset(17.5, 6.5), 1.1, paint);
      case Channel.unknown:
        paint.color = color ?? const Color(0xFF6B6D76);
        canvas.drawCircle(const Offset(12, 12), 9, paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_ChannelPainter old) => old.channel != channel || old.color != color;
}

/// علامة «حاضر»: رأس مربّع، وجه مائل ٦°، عينان، ومسّاح بنقطة خضراء.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 40, this.color, this.face, this.dot});

  final double size;
  final Color? color;
  final Color? face;
  final Color? dot;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _MarkPainter(
          color ?? theme.colorScheme.onSurface,
          face ?? theme.scaffoldBackgroundColor,
          dot ?? theme.colorScheme.primary,
        ),
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.color, this.face, this.dot);

  final Color color;
  final Color face;
  final Color dot;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 120);
    final p = Paint()
      ..color = color
      ..isAntiAlias = true;
    // المسّاح
    canvas.drawLine(
      const Offset(66, 36),
      const Offset(66, 18),
      Paint()
        ..color = color
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(const Offset(66, 13), 9, Paint()..color = dot);
    // الرأس
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(26, 32, 78, 72), const Radius.circular(16)),
      p,
    );
    // الوجه مائل -٦°
    canvas.save();
    canvas.translate(65, 66);
    canvas.rotate(-6 * math.pi / 180);
    canvas.translate(-65, -66);
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTWH(38, 48, 54, 36), const Radius.circular(11)),
      Paint()..color = face,
    );
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(52, 57, 7, 17), const Radius.circular(3.5)), p);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(69, 57, 7, 17), const Radius.circular(3.5)), p);
    canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.color != color || old.face != face || old.dot != dot;
}
