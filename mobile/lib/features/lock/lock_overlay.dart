import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/glyphs.dart';
import 'app_lock_controller.dart';
import 'biometric_auth.dart';
import 'pin_pad.dart';

/// يلفّ التطبيق كله: شاشة قفل حين يكون مقفلاً، وغطاء خصوصية حين يغادر
/// المقدّمة (لقطة «التطبيقات الأخيرة» تُلتقط في تلك اللحظة).
class LockGate extends ConsumerStatefulWidget {
  const LockGate({super.key, required this.child});
  final Widget child;

  @override
  ConsumerState<LockGate> createState() => _LockGateState();
}

class _LockGateState extends ConsumerState<LockGate> with WidgetsBindingObserver {
  bool _obscured = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _autoPrompt());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    final lock = ref.read(appLockProvider);
    if (!lock.settings.enabled) {
      if (_obscured) setState(() => _obscured = false);
      return;
    }
    // inactive يكفي للغطاء (iOS يلتقط اللقطة بعده مباشرة)، لكنه لا يقفل —
    // نافذة Face ID نفسها تسبّب inactive.
    final obscure = s != AppLifecycleState.resumed && !lock.authenticating;
    if (obscure != _obscured) setState(() => _obscured = obscure);
    if (s == AppLifecycleState.resumed) _autoPrompt();
  }

  void _autoPrompt() {
    final lock = ref.read(appLockProvider);
    if (lock.locked && !lock.authenticating) {
      unawaited(ref.read(appLockProvider.notifier).unlock());
    }
  }

  @override
  Widget build(BuildContext context) {
    final locked = ref.watch(appLockProvider.select((s) => s.locked));
    ref.listen(appLockProvider.select((s) => s.locked), (_, now) {
      if (now) WidgetsBinding.instance.addPostFrameCallback((_) => _autoPrompt());
    });
    return Stack(
      children: [
        // المحتوى خلف القفل لا يُبنى أصلاً — لا نص عميل في شجرة الواجهة
        // يمكن أن يقرأه قارئ الشاشة أو يظهر في إطار عابر.
        if (!locked) widget.child,
        if (locked) const _LockScreen(),
        if (_obscured && !locked) const Positioned.fill(child: _PrivacyCover()),
      ],
    );
  }
}

class _LockScreen extends ConsumerWidget {
  const _LockScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final lock = ref.watch(appLockProvider);
    final ctrl = ref.read(appLockProvider.notifier);
    return Scaffold(
      key: const Key('lock.screen'),
      backgroundColor: hc.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 64),
                const SizedBox(height: 18),
                Text('حاضر مقفل', style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(
                  lock.hasPin ? 'أدخل رمز حاضر أو استخدم البصمة' : 'تحقّق من هويتك لعرض محادثات عملائك.',
                  textAlign: TextAlign.center,
                  style: tt.bodyMedium?.copyWith(color: hc.text2),
                ),
                const SizedBox(height: 36),
                if (lock.hasPin)
                  PinEntry(
                    onPin: ctrl.unlockWithPin,
                    onBiometric: lock.biometric == BiometricKind.none ? null : () => unawaited(ctrl.unlock()),
                  )
                else
                  FilledButton.icon(
                    key: const Key('lock.unlock'),
                    onPressed: lock.authenticating ? null : () => ctrl.unlock(),
                    icon: const Icon(Icons.fingerprint_rounded),
                    label: const Text('فتح القفل'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// [PinPad] مع رسالة الخطأ والإيقاف المؤقت بعدّاد حيّ — مشترك بين شاشة القفل
/// وتأكيد الهوية في الإعدادات.
class PinEntry extends ConsumerStatefulWidget {
  const PinEntry({super.key, required this.onPin, this.onBiometric});

  final Future<PinResult> Function(String pin) onPin;
  final VoidCallback? onBiometric;

  @override
  ConsumerState<PinEntry> createState() => _PinEntryState();
}

class _PinEntryState extends ConsumerState<PinEntry> {
  Timer? _tick;
  bool _wrong = false;

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _countdown() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      final until = ref.read(appLockProvider).lockedUntil;
      if (!mounted) return t.cancel();
      setState(() {});
      if (until == null || DateTime.now().isAfter(until)) t.cancel();
    });
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockProvider);
    final until = lock.lockedUntil;
    final remaining = until == null ? 0 : until.difference(DateTime.now()).inSeconds + 1;
    final lockedOut = remaining > 0;
    if (lockedOut && (_tick == null || !_tick!.isActive)) _countdown();

    final String? message;
    if (lockedOut) {
      message = 'محاولات كثيرة — حاول بعد ${arDigits(remaining)} ثانية';
    } else if (_wrong) {
      message = 'رمز غير صحيح';
    } else {
      message = null;
    }

    return PinPad(
      enabled: !lockedOut,
      biometric: lock.biometric,
      onBiometric: widget.onBiometric,
      message: message,
      messageIsError: _wrong || lockedOut,
      onComplete: (pin) async {
        final r = await widget.onPin(pin);
        if (mounted) setState(() => _wrong = r != PinResult.ok);
        return r == PinResult.ok;
      },
    );
  }
}

class _PrivacyCover extends StatelessWidget {
  const _PrivacyCover();

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: context.hc.bg,
        child: const Center(child: BrandMark(size: 80)),
      );
}
