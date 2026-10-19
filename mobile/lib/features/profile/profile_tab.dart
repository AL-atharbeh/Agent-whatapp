import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glyphs.dart';
import '../auth/session_controller.dart';
import 'profile_controller.dart';

class ProfileTab extends ConsumerWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final session = ref.watch(sessionProvider);
    final me = ref.watch(meProvider);
    final devices = ref.watch(devicesProvider);
    final user = me?.user ?? session?.user;
    final tenant = me?.tenant ?? session?.tenant;

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(devicesProvider);
          await ref.read(meProvider.notifier).refresh();
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Text('الملف', style: tt.headlineSmall),
            ),
            SurfaceCard(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  InitialsAvatar(seed: user?.id ?? '', label: user?.displayName ?? '', size: 56),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.displayName ?? '—', style: tt.titleMedium?.copyWith(fontSize: 17)),
                        if (user != null) LtrText(user.email, style: tt.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SectionLabel('المتجر', icon: Icons.storefront_outlined),
            SurfaceCard(
              child: Column(
                children: [
                  _InfoRow(label: 'الاسم', value: tenant?.name ?? '—'),
                  Divider(indent: 16, color: hc.border),
                  _InfoRow(label: 'المعرّف', value: tenant?.slug ?? '—', ltr: true),
                  Divider(indent: 16, color: hc.border),
                  _InfoRow(label: 'الوكيل', value: tenant?.agentName ?? '—', icon: Icons.smart_toy_outlined),
                  if (me != null && me.channels.isNotEmpty) ...[
                    Divider(indent: 16, color: hc.border),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                      child: Row(
                        children: [
                          Text('القنوات', style: tt.bodyMedium?.copyWith(color: hc.text2)),
                          const Spacer(),
                          for (final c in Channel.rail)
                            Padding(
                              padding: const EdgeInsetsDirectional.only(start: 10),
                              child: Opacity(
                                opacity: me.isConnected(c) ? 1 : 0.25,
                                child: Tooltip(
                                  message: '${c.label}: ${me.isConnected(c) ? 'مربوط' : 'غير مربوط'}',
                                  child: ChannelGlyph(c, size: 22),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            SectionLabel(
              'أجهزتي',
              icon: Icons.devices_outlined,
              trailing: devices.isLoading && devices.hasValue
                  ? const SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : null,
            ),
            SurfaceCard(
              child: devices.when(
                skipLoadingOnRefresh: true,
                loading: () => const Padding(
                  padding: EdgeInsets.all(28),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (e, _) => StateMessage(
                  icon: Icons.cloud_off_rounded,
                  title: 'تعذّر تحميل الأجهزة',
                  body: e is ApiError ? e.message : null,
                  actionLabel: 'إعادة المحاولة',
                  onAction: () => ref.invalidate(devicesProvider),
                ),
                data: (list) => Column(
                  children: [
                    for (var i = 0; i < list.length; i++) ...[
                      if (i > 0) Divider(indent: 68, color: hc.border),
                      _DeviceRow(device: list[i]),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
              child: Text(
                'إن فقدت هاتفاً، اسحبه من هنا من أي جهاز آخر — يخرج فوراً ولا تصله إشعارات.',
                style: tt.bodySmall?.copyWith(color: hc.text3),
              ),
            ),
            const SizedBox(height: 28),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: OutlinedButton.icon(
                key: const Key('profile.logout'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: hc.danger,
                  side: BorderSide(color: hc.danger.withValues(alpha: 0.4)),
                  minimumSize: const Size.fromHeight(52),
                ),
                onPressed: () => _confirmLogout(context, ref),
                icon: const Icon(Icons.logout_rounded),
                label: const Text('تسجيل الخروج'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تسجيل الخروج؟'),
        content: const Text('تُمحى المحادثات المحفوظة على هذا الجهاز، ولن تصلك إشعارات حتى تدخل من جديد.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ctx.hc.danger),
            child: const Text('خروج'),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).logout();
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.ltr = false, this.icon});

  final String label;
  final String value;
  final bool ltr;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      child: Row(
        children: [
          Text(label, style: tt.bodyMedium?.copyWith(color: hc.text2)),
          const SizedBox(width: 16),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (icon != null) ...[Icon(icon, size: 16, color: hc.live), const SizedBox(width: 6)],
                Flexible(
                  child: ltr
                      ? LtrText(value, style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600))
                      : Text(
                          value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DeviceRow extends ConsumerWidget {
  const _DeviceRow({required this.device});
  final DeviceInfo device;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final icon = device.platform == 'android'
        ? Icons.phone_android_rounded
        : (device.name.toLowerCase().contains('ipad') ? Icons.tablet_mac_rounded : Icons.phone_iphone_rounded);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 8, 12),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: device.current ? hc.liveDim : hc.surface2,
              borderRadius: BorderRadius.circular(R.sm),
            ),
            child: Icon(icon, size: 21, color: device.current ? hc.live : hc.text2),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(child: LtrText(device.name, style: tt.titleSmall?.copyWith(fontSize: 15))),
                    if (device.current) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                        decoration: BoxDecoration(color: hc.liveDim, borderRadius: BorderRadius.circular(R.xs)),
                        child: Text(
                          'هذا الجهاز',
                          style: TextStyle(fontFamily: kFont, fontSize: 11, fontWeight: FontWeight.w600, color: hc.live, height: 1.4),
                        ),
                      ),
                    ],
                  ],
                ),
                Text(
                  device.current ? 'نشط الآن' : 'آخر ظهور ${lastSeenLabel(device.lastSeenAt, DateTime.now().toUtc())}',
                  style: tt.bodySmall,
                ),
              ],
            ),
          ),
          if (!device.current)
            TextButton(
              key: Key('device.revoke.${device.id}'),
              style: TextButton.styleFrom(foregroundColor: hc.danger),
              onPressed: () => _revoke(context, ref),
              child: const Text('سحب'),
            ),
        ],
      ),
    );
  }

  Future<void> _revoke(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('سحب هذا الجهاز؟'),
        content: Text('سيخرج ${ltr(device.name)} فوراً ولن تصله إشعارات. يمكنه الدخول من جديد بكلمة السر.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ctx.hc.danger),
            child: const Text('سحب'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(devicesProvider.notifier).revoke(device.id);
      unawaited(HapticFeedback.mediumImpact());
      showToast('سُحب الجهاز.');
    } on ApiError catch (e) {
      showToast(e.message);
    }
  }
}
