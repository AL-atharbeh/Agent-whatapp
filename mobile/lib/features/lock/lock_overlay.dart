import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../ui/theme.dart';
import '../../ui/widgets/glyphs.dart';
import 'app_lock_controller.dart';

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
    final busy = ref.watch(appLockProvider.select((s) => s.authenticating));
    return Scaffold(
      key: const Key('lock.screen'),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 72),
                const SizedBox(height: 24),
                Text('حاضر مقفل', style: tt.headlineSmall),
                const SizedBox(height: 8),
                Text(
                  'تحقّق من هويتك لعرض محادثات عملائك.',
                  textAlign: TextAlign.center,
                  style: tt.bodyMedium?.copyWith(color: hc.text2),
                ),
                const SizedBox(height: 32),
                FilledButton.icon(
                  key: const Key('lock.unlock'),
                  onPressed: busy ? null : () => ref.read(appLockProvider.notifier).unlock(),
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

class _PrivacyCover extends StatelessWidget {
  const _PrivacyCover();

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: context.hc.bg,
        child: const Center(child: BrandMark(size: 80)),
      );
}
