import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glyphs.dart';
import 'inbox_controller.dart';
import 'rail_badge.dart';

final selectedChannelProvider = NotifierProvider<SelectedChannel, Channel>(SelectedChannel.new);

class SelectedChannel extends Notifier<Channel> {
  @override
  Channel build() => Channel.whatsapp;

  void select(Channel c) => state = c;
}

/// الشريط العمودي للقنوات — على اليمين لأن التطبيق RTL (أول عنصر في Row).
///
/// يبقى ظاهراً دائماً: المالك يرى بلمحة أين ينتظره أحد دون أن يتنقل.
class ChannelRail extends ConsumerWidget {
  const ChannelRail({super.key});

  static const width = 78.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final selected = ref.watch(selectedChannelProvider);
    final summary = ref.watch(inboxProvider.select((s) => s.summary));

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: hc.bg2,
        border: BorderDirectional(end: BorderSide(color: hc.border)),
      ),
      child: SafeArea(
        right: false,
        left: false,
        bottom: false,
        child: Column(
          children: [
            const SizedBox(height: 14),
            const BrandMark(size: 34),
            const SizedBox(height: 18),
            Container(width: 28, height: 1, color: hc.border),
            const SizedBox(height: 10),
            for (final c in Channel.rail)
              _RailItem(
                channel: c,
                selected: c == selected,
                badge: RailBadge.of(summary.of(c)),
                onTap: () {
                  if (c != selected) HapticFeedback.selectionClick();
                  ref.read(selectedChannelProvider.notifier).select(c);
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  const _RailItem({
    required this.channel,
    required this.selected,
    required this.badge,
    required this.onTap,
  });

  final Channel channel;
  final bool selected;
  final RailBadge badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Semantics(
      button: true,
      selected: selected,
      label: badge.semantics(channel),
      excludeSemantics: true,
      child: InkWell(
        key: Key('rail.${channel.wire}'),
        onTap: onTap,
        child: SizedBox(
          width: ChannelRail.width,
          height: 84,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // مؤشر الاختيار على الحافة الخارجية (يمين الشاشة في RTL).
              PositionedDirectional(
                start: 0,
                top: 18,
                bottom: 30,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  curve: Curves.easeOutCubic,
                  width: 3.5,
                  decoration: BoxDecoration(
                    color: selected ? hc.live : Colors.transparent,
                    borderRadius: const BorderRadiusDirectional.horizontal(end: Radius.circular(4)),
                  ),
                ),
              ),
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 220),
                        curve: Curves.easeOutCubic,
                        width: 50,
                        height: 50,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: selected ? hc.surface3 : hc.surface,
                          borderRadius: BorderRadius.circular(R.md),
                          border: Border.all(color: selected ? hc.border2 : hc.border),
                        ),
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 220),
                          opacity: selected ? 1 : 0.62,
                          child: ChannelGlyph(channel, size: 26),
                        ),
                      ),
                      PositionedDirectional(end: -7, top: -6, child: _Badge(badge)),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    channel.label,
                    maxLines: 1,
                    overflow: TextOverflow.fade,
                    softWrap: false,
                    style: TextStyle(
                      fontFamily: kFont,
                      fontSize: 11,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                      color: selected ? hc.text : hc.text3,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.badge);
  final RailBadge badge;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final ring = Border.all(color: hc.bg2, width: 2);
    switch (badge.kind) {
      case RailBadgeKind.none:
        return const SizedBox.shrink();
      case RailBadgeKind.unread:
        return Container(
          key: const Key('badge.unread'),
          decoration: BoxDecoration(border: ring, borderRadius: BorderRadius.circular(20)),
          child: CountBadge(count: badge.count, color: hc.text3, textColor: hc.bg, size: 19),
        );
      case RailBadgeKind.handoff:
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              key: const Key('badge.handoff'),
              decoration: BoxDecoration(border: ring, borderRadius: BorderRadius.circular(20)),
              child: CountBadge(count: badge.count, color: hc.handoff, textColor: Colors.white, size: 19),
            ),
            if (badge.unreadDot)
              Container(
                key: const Key('badge.dot'),
                width: 10,
                height: 10,
                margin: const EdgeInsetsDirectional.only(start: 1, top: 1),
                decoration: BoxDecoration(color: hc.text3, shape: BoxShape.circle, border: ring),
              ),
          ],
        );
    }
  }
}
