import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/glyphs.dart';
import 'app_lock_controller.dart';
import 'biometric_auth.dart';
import 'lock_overlay.dart';
import 'pin_pad.dart';

/// اختيار رمز حاضر: الرمز ثم تأكيده. يفعّل القفل (أو يغيّر الرمز) عند النجاح.
class PinSetupScreen extends ConsumerStatefulWidget {
  const PinSetupScreen({super.key});

  static Route<bool> route() => MaterialPageRoute(fullscreenDialog: true, builder: (_) => const PinSetupScreen());

  @override
  ConsumerState<PinSetupScreen> createState() => _PinSetupScreenState();
}

class _PinSetupScreenState extends ConsumerState<PinSetupScreen> {
  String? _first;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final bio = ref.watch(appLockProvider.select((s) => s.biometric));
    final confirming = _first != null;
    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('رمز حاضر')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 56),
                const SizedBox(height: 16),
                Text(
                  confirming ? 'أعد كتابة الرمز' : 'اختر رمزاً من ${arDigits(pinLength)} أرقام',
                  key: const Key('pinSetup.title'),
                  style: tt.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  bio == BiometricKind.none
                      ? 'تفتح به التطبيق كل مرة.'
                      : 'تفتح بـ${bio == BiometricKind.face ? 'بصمة الوجه' : 'البصمة'}، والرمز بديل حين لا تعمل.',
                  textAlign: TextAlign.center,
                  style: tt.bodyMedium?.copyWith(color: hc.text2),
                ),
                const SizedBox(height: 32),
                PinPad(
                  // مفتاح بالخطوة: لوحة جديدة نظيفة بين الكتابة والتأكيد
                  key: ValueKey(confirming),
                  message: _error,
                  messageIsError: _error != null,
                  onComplete: (pin) async {
                    if (!confirming) {
                      setState(() {
                        _first = pin;
                        _error = null;
                      });
                      return true;
                    }
                    if (pin != _first) {
                      setState(() {
                        _first = null;
                        _error = 'الرمزان مختلفان — ابدأ من جديد';
                      });
                      return false;
                    }
                    await ref.read(appLockProvider.notifier).enableWithPin(pin);
                    unawaited(HapticFeedback.mediumImpact());
                    if (context.mounted) Navigator.of(context).pop(true);
                    return true;
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// تأكيد الهوية قبل تعطيل القفل أو تغيير الرمز: البصمة تُعرض فوراً، والرمز بديلها.
class PinVerifyScreen extends ConsumerStatefulWidget {
  const PinVerifyScreen({super.key, required this.title});

  final String title;

  static Route<bool> route(String title) =>
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => PinVerifyScreen(title: title));

  @override
  ConsumerState<PinVerifyScreen> createState() => _PinVerifyScreenState();
}

class _PinVerifyScreenState extends ConsumerState<PinVerifyScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_biometric()));
  }

  Future<void> _biometric() async {
    final ok = await ref.read(appLockProvider.notifier).confirmWithBiometric('أكّد هويتك: ${widget.title}');
    if (ok && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final bio = ref.watch(appLockProvider.select((s) => s.biometric));
    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 56),
                const SizedBox(height: 16),
                Text('أدخل رمز حاضر', style: tt.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 32),
                PinEntry(
                  onPin: (pin) async {
                    final r = await ref.read(appLockProvider.notifier).checkPin(pin);
                    if (r == PinResult.ok && context.mounted) Navigator.of(context).pop(true);
                    return r;
                  },
                  onBiometric: bio == BiometricKind.none ? null : () => unawaited(_biometric()),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
