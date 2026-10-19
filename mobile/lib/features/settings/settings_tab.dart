import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../lock/app_lock_controller.dart';
import '../push/push_service.dart';
import 'notify_controller.dart';

class SettingsTab extends ConsumerWidget {
  const SettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final notify = ref.watch(notifyProvider);
    final lock = ref.watch(appLockProvider);
    final pushAvailable = ref.watch(pushServiceProvider).available;
    final cfg = ref.watch(configProvider);

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
            child: Text('الإعدادات', style: tt.headlineSmall),
          ),
          const SectionLabel('الإشعارات على هذا الجهاز', icon: Icons.notifications_none_rounded),
          SurfaceCard(
            child: Column(
              children: [
                for (final m in NotifyMode.values) ...[
                  if (m != NotifyMode.values.first) Divider(indent: 56, color: hc.border),
                  _NotifyOption(
                    mode: m,
                    selected: notify.mode == m,
                    enabled: !notify.saving,
                    onTap: () async {
                      unawaited(HapticFeedback.selectionClick());
                      final err = await ref.read(notifyProvider.notifier).set(m);
                      if (err != null) showToast(err);
                    },
                  ),
                ],
              ],
            ),
          ),
          if (!pushAvailable)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(Icons.info_outline_rounded, size: 15, color: hc.warn),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'الإشعارات غير مفعّلة في هذا الإصدار. التطبيق يتحقق من الرسائل الجديدة كل ٨ ثوانٍ وهو مفتوح.',
                      style: tt.bodySmall?.copyWith(color: hc.warn),
                    ),
                  ),
                ],
              ),
            ),
          const SectionLabel('الأمان', icon: Icons.shield_outlined),
          SurfaceCard(
            child: Column(
              children: [
                SwitchListTile.adaptive(
                  key: const Key('settings.lock'),
                  value: lock.settings.enabled,
                  onChanged: lock.authenticating
                      ? null
                      : (v) async {
                          final err = await ref.read(appLockProvider.notifier).setEnabled(v);
                          if (err != null) showToast(err);
                        },
                  contentPadding: const EdgeInsetsDirectional.fromSTEB(16, 6, 12, 6),
                  secondary: _IconBox(Icons.fingerprint_rounded, color: hc.live),
                  title: const Text('قفل التطبيق'),
                  subtitle: Text(
                    'بصمة الوجه أو الإصبع عند الفتح، وإخفاء المحادثات في قائمة التطبيقات.',
                    style: tt.bodySmall,
                  ),
                ),
                if (lock.settings.enabled) ...[
                  Divider(indent: 68, color: hc.border),
                  Padding(
                    padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('اطلب التحقق بعد', style: tt.bodyMedium),
                        const SizedBox(height: 10),
                        SizedBox(
                          width: double.infinity,
                          child: SegmentedButton<int>(
                            showSelectedIcon: false,
                            segments: [
                              const ButtonSegment(value: 0, label: Text('فوراً')),
                              ButtonSegment(value: 1, label: Text(arMinutes(1))),
                              ButtonSegment(value: 5, label: Text(arMinutes(5))),
                              ButtonSegment(value: 15, label: Text(arMinutes(15))),
                            ],
                            selected: {lock.settings.timeoutMinutes},
                            onSelectionChanged: (s) => ref.read(appLockProvider.notifier).setTimeout(s.first),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SectionLabel('عن التطبيق', icon: Icons.info_outline_rounded),
          SurfaceCard(
            child: Column(
              children: [
                ListTile(
                  leading: _IconBox(Icons.palette_outlined, color: hc.text2),
                  title: const Text('المظهر'),
                  subtitle: Text('يتبع إعداد النظام (داكن / فاتح)', style: tt.bodySmall),
                ),
                Divider(indent: 68, color: hc.border),
                ListTile(
                  leading: _IconBox(Icons.dns_outlined, color: hc.text2),
                  title: const Text('الخادم'),
                  subtitle: cfg.useFakeApi
                      ? Text('وضع تجريبي — بيانات وهمية', style: tt.bodySmall?.copyWith(color: hc.warn))
                      : LtrText(Uri.tryParse(cfg.apiBase)?.host ?? cfg.apiBase, style: tt.bodySmall),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NotifyOption extends StatelessWidget {
  const _NotifyOption({required this.mode, required this.selected, required this.enabled, required this.onTap});

  final NotifyMode mode;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final icon = switch (mode) {
      NotifyMode.all => Icons.notifications_active_outlined,
      NotifyMode.handoff => Icons.front_hand_outlined,
      NotifyMode.off => Icons.notifications_off_outlined,
    };
    return InkWell(
      key: Key('notify.${mode.wire}'),
      onTap: enabled ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(
          children: [
            Icon(icon, color: selected ? hc.live : hc.text3, size: 22),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(mode.label, style: tt.titleSmall?.copyWith(fontSize: 15)),
                  Text(mode.hint, style: tt.bodySmall),
                ],
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: selected ? hc.live : Colors.transparent,
                border: Border.all(color: selected ? hc.live : hc.border2, width: 2),
              ),
              child: selected ? Icon(Icons.check_rounded, size: 15, color: hc.onLive) : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _IconBox extends StatelessWidget {
  const _IconBox(this.icon, {required this.color});
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(color: hc.surface2, borderRadius: BorderRadius.circular(R.sm)),
      child: Icon(icon, color: color, size: 21),
    );
  }
}
