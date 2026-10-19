import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/now.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glass.dart';
import '../../ui/widgets/glyphs.dart';
import '../chat/chat_screen.dart';
import '../profile/profile_controller.dart';
import 'channel_picker.dart';
import 'conversation_tile.dart';
import 'conversations_controller.dart';
import 'inbox_controller.dart';
import 'new_conversation_screen.dart';

/// تبويب المحادثات: قائمة القناة بعرض الشاشة، ودائرة القنوات عائمة فوق البار.
class ConversationsTab extends ConsumerWidget {
  const ConversationsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channel = ref.watch(selectedChannelProvider);
    return Stack(
      children: [
        Positioned.fill(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            switchInCurve: Curves.easeOutCubic,
            child: ChannelInbox(key: ValueKey(channel), channel: channel),
          ),
        ),
        // يسار الشاشة فعلياً (نهاية السطر في RTL)، فوق البار — بالإحداثيات
        // المادية لأن قوس القنوات يُحسب منها.
        Positioned(
          left: 18,
          bottom: MediaQuery.paddingOf(context).bottom + 14,
          child: const ChannelPicker(),
        ),
      ],
    );
  }
}

/// فلتر القائمة — محلي على ما حُمّل، لا طلب للخادم.
enum InboxFilter { all, waiting, unread }

class ChannelInbox extends ConsumerStatefulWidget {
  const ChannelInbox({super.key, required this.channel});

  final Channel channel;

  @override
  ConsumerState<ChannelInbox> createState() => _ChannelInboxState();
}

class _ChannelInboxState extends ConsumerState<ChannelInbox> {
  String _query = '';
  InboxFilter _filter = InboxFilter.all;

  Channel get channel => widget.channel;

  @override
  Widget build(BuildContext context) {
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
            padding: const EdgeInsetsDirectional.fromSTEB(20, 10, 16, 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          ChannelGlyph(channel, size: 26),
                          const SizedBox(width: 10),
                          Flexible(
                            child: Text(
                              channel.label,
                              style: tt.headlineMedium?.copyWith(fontWeight: FontWeight.w800, height: 1.15),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
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
                  Semantics(
                    button: true,
                    label: 'محادثة جديدة',
                    child: GestureDetector(
                      key: const Key('conv.new'),
                      onTap: () => Navigator.of(context).push(NewConversationScreen.route()),
                      child: SizedBox.square(
                        dimension: 48,
                        child: Glass(
                          shadow: false,
                          child: Icon(Icons.edit_square, size: 21, color: hc.text),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (!notConnected) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
              child: _SearchField(onChanged: (q) => setState(() => _query = q.trim())),
            ),
            _FilterChips(
              value: _filter,
              waiting: summary.handoff,
              unread: summary.unread,
              onChanged: (f) => setState(() => _filter = f),
            ),
          ],
          if (!online) const OfflineBanner(),
          Expanded(child: _body(context, state, notConnected, now)),
        ],
      ),
    );
  }

  /// يطابق الاسم أو أي جزء من الرقم — الموظف يتذكّر «اللي رقمه ينتهي بـ ٢٢٦٨».
  bool _matches(ConversationItem c) {
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    final digits = arToAsciiDigits(q).replaceAll(RegExp(r'\D'), '');
    if ((c.customerName ?? '').toLowerCase().contains(q)) return true;
    return digits.isNotEmpty && c.displayId.replaceAll(RegExp(r'\D'), '').contains(digits);
  }

  Widget _body(BuildContext context, ConversationsState state, bool notConnected, DateTime now) {
    final hc = context.hc;
    final ctrl = ref.read(conversationsProvider(channel).notifier);
    // مساحة البار العائم ودائرة القنوات: آخر صف يُمرَّر فوقهما لا تحتهما
    final tail = MediaQuery.paddingOf(context).bottom + ChannelPicker.orbSize + 28;

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

    // مع بحث أو فلتر: قائمة واحدة مسطّحة — الأقسام تخدم التصفّح لا البحث
    final flat = _query.isNotEmpty || _filter != InboxFilter.all;
    if (flat) {
      final all = [...state.pinned, ...state.items].where(_matches).where((c) => switch (_filter) {
            InboxFilter.all => true,
            InboxFilter.waiting => c.isHuman,
            InboxFilter.unread => c.unreadCount > 0,
          });
      final list = all.toList();
      if (list.isEmpty) {
        return StateMessage(
          icon: _query.isNotEmpty ? Icons.search_off_rounded : Icons.done_all_rounded,
          title: _query.isNotEmpty
              ? 'لا نتائج لـ «$_query»'
              : _filter == InboxFilter.waiting
                  ? 'لا أحد ينتظرك هنا'
                  : 'لا شيء غير مقروء',
          body: _query.isNotEmpty ? 'جرّب جزءاً من الاسم أو آخر أرقام الهاتف.' : 'الوكيل يتولّى الباقي.',
        );
      }
      return ListView.separated(
        key: PageStorageKey('flat.${channel.wire}'),
        padding: EdgeInsets.only(bottom: tail),
        itemCount: list.length,
        separatorBuilder: (_, _) => Divider(indent: 82, color: hc.border.withValues(alpha: 0.7)),
        itemBuilder: (_, i) => ConversationTile(item: list[i], now: now, onTap: () => open(list[i])),
      );
    }

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
              height: tail,
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

class _SearchField extends StatelessWidget {
  const _SearchField({required this.onChanged});
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return TextField(
      key: const Key('conv.search'),
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      style: TextStyle(fontFamily: kFont, fontSize: 15.5, color: hc.text),
      decoration: InputDecoration(
        hintText: 'بحث بالاسم أو الرقم',
        prefixIcon: Icon(Icons.search_rounded, color: hc.text3),
        isDense: true,
        filled: true,
        fillColor: hc.surface2,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(R.xl), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(R.xl), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(R.xl),
          borderSide: BorderSide(color: hc.border2),
        ),
      ),
    );
  }
}

class _FilterChips extends StatelessWidget {
  const _FilterChips({required this.value, required this.waiting, required this.unread, required this.onChanged});

  final InboxFilter value;
  final int waiting;
  final int unread;
  final ValueChanged<InboxFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    Widget chip(InboxFilter f, String label, {int count = 0, Color? accent}) {
      final on = f == value;
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: GestureDetector(
          key: Key('filter.${f.name}'),
          onTap: () => onChanged(f),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: on ? hc.text.withValues(alpha: 0.10) : Colors.transparent,
              borderRadius: BorderRadius.circular(R.xl),
              border: Border.all(color: on ? hc.border2 : hc.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontFamily: kFont,
                    fontSize: 14,
                    fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                    color: on ? hc.text : hc.text2,
                  ),
                ),
                if (count > 0) ...[
                  const SizedBox(width: 6),
                  Text(
                    arDigits(count),
                    style: TextStyle(
                      fontFamily: kFont,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: accent ?? hc.text3,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          chip(InboxFilter.all, 'الكل'),
          chip(InboxFilter.waiting, 'تنتظرك', count: waiting, accent: hc.handoff),
          chip(InboxFilter.unread, 'غير مقروءة', count: unread),
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
