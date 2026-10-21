import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/glass.dart';
import 'app_lock_controller.dart';
import 'biometric_auth.dart';

/// لوحة رمز حاضر: نقاط الرمز وأزرار زجاجية بأرقام عربية، وزرّ البصمة في
/// الزاوية — بلغة التطبيق نفسه لا بنافذة النظام الرمادية.
///
/// [onComplete] يُستدعى عند اكتمال الأرقام ويعيد true للقبول؛ false يهزّ
/// النقاط ويمسحها — الخطأ يُرى قبل أن يُقرأ.
class PinPad extends StatefulWidget {
  const PinPad({
    super.key,
    required this.onComplete,
    this.biometric = BiometricKind.none,
    this.onBiometric,
    this.message,
    this.messageIsError = false,
    this.enabled = true,
  });

  final Future<bool> Function(String pin) onComplete;
  final BiometricKind biometric;
  final VoidCallback? onBiometric;
  final String? message;
  final bool messageIsError;
  final bool enabled;

  @override
  State<PinPad> createState() => _PinPadState();
}

class _PinPadState extends State<PinPad> with SingleTickerProviderStateMixin {
  String _pin = '';
  bool _checking = false;
  late final _shake = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));

  @override
  void dispose() {
    _shake.dispose();
    super.dispose();
  }

  Future<void> _tap(String d) async {
    if (!widget.enabled || _checking || _pin.length >= pinLength) return;
    unawaited(HapticFeedback.selectionClick());
    setState(() => _pin += d);
    if (_pin.length < pinLength) return;
    setState(() => _checking = true);
    final ok = await widget.onComplete(_pin);
    if (!mounted) return;
    if (!ok) {
      unawaited(HapticFeedback.heavyImpact());
      await _shake.forward(from: 0);
    }
    if (mounted) {
      setState(() {
        _pin = '';
        _checking = false;
      });
    }
  }

  void _delete() {
    if (_pin.isEmpty || _checking) return;
    unawaited(HapticFeedback.selectionClick());
    setState(() => _pin = _pin.substring(0, _pin.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final dots = AnimatedBuilder(
      animation: _shake,
      builder: (_, child) => Transform.translate(
        offset: Offset(sin(_shake.value * pi * 6) * 12 * (1 - _shake.value), 0),
        child: child,
      ),
      child: Row(
        key: const Key('pin.dots'),
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < pinLength; i++)
            AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              margin: const EdgeInsets.symmetric(horizontal: 9),
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < _pin.length ? hc.live : Colors.transparent,
                border: Border.all(color: i < _pin.length ? hc.live : hc.text3, width: 1.6),
              ),
            ),
        ],
      ),
    );

    Widget key(String d) => _Key(
          key: Key('pin.$d'),
          onTap: () => _tap(d),
          child: Text(
            arDigits(d),
            style: TextStyle(fontFamily: kFont, fontSize: 28, fontWeight: FontWeight.w500, color: hc.text),
          ),
        );

    final bio = widget.onBiometric != null && widget.biometric != BiometricKind.none
        ? _Key(
            key: const Key('pin.biometric'),
            onTap: widget.onBiometric!,
            glass: false,
            child: Icon(
              widget.biometric == BiometricKind.face ? Icons.face_retouching_natural_rounded : Icons.fingerprint_rounded,
              size: 30,
              color: hc.live,
            ),
          )
        : const SizedBox.square(dimension: _Key.size);

    // الصفوف بترتيب الهاتف ١٢٣ من اليسار مهما كان اتجاه الواجهة
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          dots,
          SizedBox(
            height: 44,
            child: Center(
              child: widget.message == null
                  ? null
                  : Text(
                      widget.message!,
                      key: const Key('pin.message'),
                      textDirection: TextDirection.rtl,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: kFont,
                        fontSize: 13,
                        color: widget.messageIsError ? hc.danger : hc.text2,
                      ),
                    ),
            ),
          ),
          for (final row in const [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Row(mainAxisSize: MainAxisSize.min, children: [for (final d in row) _gap(key(d))]),
            ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _gap(bio),
              _gap(key('0')),
              _gap(_Key(
                key: const Key('pin.delete'),
                onTap: _delete,
                glass: false,
                child: Icon(Icons.backspace_outlined, size: 24, color: _pin.isEmpty ? hc.text3 : hc.text),
              )),
            ],
          ),
        ],
      ),
    );
  }

  static Widget _gap(Widget w) => Padding(padding: const EdgeInsets.symmetric(horizontal: 13), child: w);
}

class _Key extends StatelessWidget {
  const _Key({super.key, required this.child, required this.onTap, this.glass = true});

  static const size = 76.0;

  final Widget child;
  final VoidCallback onTap;
  final bool glass;

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: size,
        child: Material(
          type: MaterialType.transparency,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: glass ? Glass(shadow: false, child: Center(child: child)) : Center(child: child),
          ),
        ),
      );
}
