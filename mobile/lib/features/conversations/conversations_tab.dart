import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/now.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../chat/chat_screen.dart';
import '../profile/profile_controller.dart';
import 'channel_rail.dart';
import 'conversation_tile.dart';
import 'conversations_controller.dart';
import 'inbox_controller.dart';
import 'new_conversation_screen.dart';

/// تبويب المحادثات: الشريط على اليمين، قائمة القناة المختارة في الباقي.
class ConversationsTab extends ConsumerWidget {
  const ConversationsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channel = ref.watch(selectedChannelProvider);
    return Row(
      children: [
        const ChannelRail(),
        Expanded(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            switchInCurve: Curves.easeOutCubic,
            child: ChannelInbox(key: ValueKey(channel), channel: channel),
          ),
        ),
      ],
    );
  }
}

class ChannelInbox extends ConsumerWidget {
  const ChannelInbox({super.key, required this.channel});

  final Channel channel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final state = ref.watch(conversationsProvider(channel));
    final online = ref.watch(inboxProvider.select((s) => s.online));
    final summary = ref.watch(inboxProvider.select((s) => s.summary.of(channel)));
    final me = ref.watch(meProvider);
    final notConnected = me != null && me.channels.isNotEmpty && !me.isConnected(channel);
    final now = ref.watch(nowProvider);

    final subtitle = summary.handoff > 0
        ? arCount(summary.handoff, one: 'محادثة تنتظرك', two: 'محادثتان تنتظرانك', few: 'محادثات تنتظرك')
        : summary.unread > 0
            ? arCount(summary.unread, one: 'محادثة غير مقروءة', two: 'محادثتان غير مقروءتين', few: 'محادثات غير مقروءة')
            : 'الوكيل يتولّى الردود';

    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(channel.label, style: tt.headlineSmall),
                      Text(
                        subtitle,
                        style: tt.bodySmall?.copyWith(
                          color: summary.handoff > 0 ? hc.handoff : hc.text3,
                          fontWeight: summary.handoff > 0 ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
                if (channel.supportsTemplates && !notConnected)
                  IconButton.filledTonal(
                    key: const Key('conv.new'),
                    tooltip: 'محادثة جديدة',
                    style: IconButton.styleFrom(
                      backgroundColor: hc.surface2,
                      foregroundColor: hc.text,
                      minimumSize: const Size(46, 46),
                    ),
                    onPressed: () => Navigator.of(context).push(NewConversationScreen.route()),
                    icon: const Icon(Icons.edit_square, size: 21),
                  ),
              ],
            ),
          ),
          if (!online) const OfflineBanner(),
          Expanded(child: _body(context, ref, state, notConnected, now)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, ConversationsState state, bool notConnected, DateTime now) {
    final hc = context.hc;
    final ctrl = ref.read(conversationsProvider(channel).notifier);

    if (notConnected) {
      return StateMessage(
        icon: Icons.link_off_rounded,
        title: '${channel.label} غير مربوط لمتجرك',
        body: 'اربط القناة من لوحة الويب، وستظهر محادثاتها هنا.',
      );
    }
    if (state.loading && state.isEmpty) return const _ListSkeleton();
    if (state.isEmpty) {
      return RefreshIndicator(
        onRefresh: ctrl.refresh,
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: SizedBox(
              height: box.maxHeight,
              child: state.error != null
                  ? StateMessage(
                      icon: Icons.wifi_off_rounded,
                      title: 'تعذّر تحميل المحادثات',
                      body: state.error!.message,
                      actionLabel: 'إعادة المحاولة',
                      onAction: ctrl.refresh,
                    )
                  : StateMessage(
                      icon: Icons.forum_outlined,
                      title: 'لا محادثات على ${channel.label} بعد',
                      body: 'حين يراسلك عميل سيظهر هنا، والوكيل يرد عليه فوراً.',
                    ),
            ),
          ),
        ),
      );
    }

    void open(ConversationItem c) => Navigator.of(context).push(ChatScreen.route(c.id, initial: c));

    return RefreshIndicator(
      onRefresh: ctrl.refresh,
      color: hc.live,
      backgroundColor: hc.surface2,
      child: CustomScrollView(
        key: PageStorageKey('list.${channel.wire}'),
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          if (state.pinned.isNotEmpty) ...[
            SliverToBoxAdapter(
              child: SectionLabel(
                'تنتظرك',
                icon: Icons.front_hand_outlined,
                color: hc.handoff,
                trailing: Text(
                  arDigits(state.pinned.length),
                  style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.handoff, fontWeight: FontWeight.w700),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Container(
                key: const Key('section.pinned'),
                margin: const EdgeInsetsDirectional.fromSTEB(8, 0, 8, 4),
                decoration: BoxDecoration(
                  color: hc.handoff.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(R.lg),
                  border: Border.all(color: hc.handoff.withValues(alpha: 0.18)),
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    for (var i = 0; i < state.pinned.length; i++) ...[
                      if (i > 0) Divider(indent: 76, color: hc.handoff.withValues(alpha: 0.12)),
                      ConversationTile(item: state.pinned[i], now: now, onTap: () => open(state.pinned[i])),
                    ],
                  ],
                ),
              ),
            ),
            if (state.items.isNotEmpty) const SliverToBoxAdapter(child: SectionLabel('كل المحادثات')),
          ] else
            const SliverToBoxAdapter(child: SizedBox(height: 4)),
          SliverList.separated(
            itemCount: state.items.length,
            separatorBuilder: (_, _) => Divider(indent: 76, color: hc.border.withValues(alpha: 0.7)),
            itemBuilder: (context, i) {
              // تحميل الصفحة التالية قبل الوصول للنهاية بخمسة صفوف — لا انتظار مرئي.
              if (i >= state.items.length - 5 && state.nextCursor != null && !state.loadingMore) {
                WidgetsBinding.instance.addPostFrameCallback((_) => ctrl.loadMore());
              }
              final c = state.items[i];
              return ConversationTile(item: c, now: now, onTap: () => open(c));
            },
          ),
          SliverToBoxAdapter(
            child: SizedBox(
              height: 72,
              child: state.loadingMore
                  ? const Center(child: SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.2)))
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}

/// هيكل تحميل بدل مؤشر دوّار: يحجز شكل القائمة فلا «تقفز» حين تصل.
class _ListSkeleton extends StatelessWidget {
  const _ListSkeleton();

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    Widget bar(double w, double h) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(color: hc.surface2, borderRadius: BorderRadius.circular(6)),
        );
    return ListView.builder(
      physics: const NeverScrollableScrollPhysics(),
      itemCount: 8,
      itemBuilder: (_, i) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          children: [
            Container(width: 50, height: 50, decoration: BoxDecoration(color: hc.surface2, shape: BoxShape.circle)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  bar(110.0 + (i % 3) * 24, 12),
                  const SizedBox(height: 10),
                  bar(180.0 - (i % 2) * 40, 10),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
