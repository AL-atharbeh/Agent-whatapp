import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glass.dart';
import '../../ui/widgets/glyphs.dart';
import 'inbox_controller.dart';
import 'rail_badge.dart';

final selectedChannelProvider = NotifierProvider<SelectedChannel, Channel>(SelectedChannel.new);

class SelectedChannel extends Notifier<Channel> {
  @override
  Channel build() => Channel.whatsapp;

  void select(Channel c) => state = c;
}

/// دائرة القنوات العائمة فوق البار.
///
/// كان شريطاً عمودياً ثابتاً يقتطع ثمانين نقطة من عرض كل صف — الاسم والرقم
/// والمعاينة تتزاحم في ما تبقّى. الدائرة تعيد القائمة لعرض الشاشة كاملاً،
/// وتبقى ترى بلمحة إن كان أحد ينتظرك: رقمها مجموع القنوات الثلاث، والأحمر
/// يتقدّم على الرمادي كما في الشريط.
///
/// تُفتح فوق كل شيء — البار نفسه — عبر OverlayPortal: لو رُسمت داخل التبويب
/// لبقي البار حادّاً فوق الطمس، ولاستقبل اللمس والقنوات مفتوحة.
class ChannelPicker extends ConsumerStatefulWidget {
  const ChannelPicker({super.key});

  static const orbSize = 62.0;

  @override
  ConsumerState<ChannelPicker> createState() => _ChannelPickerState();
}

class _ChannelPickerState extends ConsumerState<ChannelPicker> with SingleTickerProviderStateMixin {
  final _portal = OverlayPortalController();
  final _link = LayerLink();
  // في initState لا بتعريف كسول: دائرة لم تُفتح قط كانت تُنشئ متحكّمها لحظة
  // dispose، فيطلب TickerMode من شجرة تُفكَّك — وينهار الإغلاق.
  late final AnimationController _anim;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
      reverseDuration: const Duration(milliseconds: 240),
    );
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  void _open() {
    HapticFeedback.lightImpact();
    _portal.show();
    _anim.forward(from: 0);
  }

  Future<void> _close() async {
    await _anim.reverse();
    if (mounted) _portal.hide();
  }

  void _pick(Channel c) {
    if (c != ref.read(selectedChannelProvider)) HapticFeedback.selectionClick();
    ref.read(selectedChannelProvider.notifier).select(c);
    _close();
  }

  @override
  Widget build(BuildContext context) {
    final selected = ref.watch(selectedChannelProvider);
    final summary = ref.watch(inboxProvider.select((s) => s.summary));

    // مجموع القنوات: الدائرة وحدها ظاهرة، فهي من يقول «هناك من ينتظرك»
    var handoff = 0, unread = 0;
    for (final c in Channel.rail) {
      handoff += summary.of(c).handoff;
      unread += summary.of(c).unread;
    }
    final total = RailBadge.of(ChannelSummary(channel: selected, unread: unread, handoff: handoff));

    return CompositedTransformTarget(
      link: _link,
      child: OverlayPortal(
        controller: _portal,
        overlayChildBuilder: (_) => _Fan(
          link: _link,
          anim: _anim,
          selected: selected,
          summary: summary,
          onPick: _pick,
          onClose: _close,
        ),
        child: _Orb(
          key: const Key('picker.orb'),
          channel: selected,
          badge: total,
          onTap: _open,
        ),
      ),
    );
  }
}

/// الدائرة المغلقة: قناة الآن بأيقونتها، وفوقها مجموع ما ينتظر.
class _Orb extends StatelessWidget {
  const _Orb({super.key, required this.channel, required this.badge, required this.onTap});

  final Channel channel;
  final RailBadge badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'تبديل القناة — الآن ${channel.label}. ${badge.semantics(channel)}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox.square(
          dimension: ChannelPicker.orbSize,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Glass(
                child: SizedBox.expand(
                  child: Center(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 220),
                      transitionBuilder: (c, a) => ScaleTransition(scale: a, child: FadeTransition(opacity: a, child: c)),
                      child: ChannelGlyph(channel, key: ValueKey(channel), size: 28),
                    ),
                  ),
                ),
              ),
              PositionedDirectional(top: -5, end: -5, child: ChannelBadge(badge)),
            ],
          ),
        ),
      ),
    );
  }
}

/// القنوات وهي مفتوحة: ستارة مطموسة، والقنوات تنبثق من الدائرة على قوس.
class _Fan extends StatelessWidget {
  const _Fan({
    required this.link,
    required this.anim,
    required this.selected,
    required this.summary,
    required this.onPick,
    required this.onClose,
  });

  final LayerLink link;
  final AnimationController anim;
  final Channel selected;
  final InboxSummary summary;
  final ValueChanged<Channel> onPick;
  final VoidCallback onClose;

  /// صندوق يتبع الدائرة ويحوي القوس كاملاً. اللمس لا يصل لما خرج عن حدود
  /// أبيه في Flutter، فالقنوات يجب أن تقع داخله لا أن «تطفو» خارجه.
  static const _box = Size(250, 250);

  /// مركز الدائرة داخل الصندوق: أسفله يساراً، والقوس يتفتّح للأعلى ولليمين.
  static const _origin = Offset(ChannelPicker.orbSize / 2, 250 - ChannelPicker.orbSize / 2);
  static const _radius = 128.0;

  @override
  Widget build(BuildContext context) {
    final channels = Channel.rail;
    return Stack(
      children: [
        // الستارة: لمسها يغلق، وطمسها يُبقي القائمة مرئية تحتها
        Positioned.fill(
          child: GestureDetector(
            key: const Key('picker.backdrop'),
            onTap: onClose,
            child: AnimatedBuilder(
              animation: anim,
              builder: (_, _) {
                final t = Curves.easeOut.transform(anim.value);
                return BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10 * t, sigmaY: 10 * t),
                  child: ColoredBox(color: Colors.black.withValues(alpha: 0.38 * t)),
                );
              },
            ),
          ),
        ),
        CompositedTransformFollower(
          link: link,
          showWhenUnlinked: false,
          targetAnchor: Alignment.center,
          followerAnchor: Alignment.bottomLeft,
          offset: Offset(-_origin.dx, _box.height - _origin.dy),
          child: SizedBox.fromSize(
            size: _box,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                for (var i = 0; i < channels.length; i++)
                  _bubble(context, channels[i], i, channels.length),
                // الدائرة نفسها حادّة فوق الستارة، وصارت زرّ إغلاق
                Positioned(
                  left: _origin.dx - ChannelPicker.orbSize / 2,
                  top: _origin.dy - ChannelPicker.orbSize / 2,
                  child: GestureDetector(
                    key: const Key('picker.close'),
                    onTap: onClose,
                    child: SizedBox.square(
                      dimension: ChannelPicker.orbSize,
                      child: Glass(
                        child: Center(
                          child: AnimatedBuilder(
                            animation: anim,
                            builder: (_, _) => Transform.rotate(
                              angle: math.pi / 2 * Curves.easeOutBack.transform(anim.value),
                              child: Icon(Icons.close_rounded, size: 26, color: context.hc.text),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _bubble(BuildContext context, Channel c, int i, int n) {
    // من الأعلى إلى اليمين: من ٩٥° إلى ١٥° لا إلى الصفر — القناة الأخيرة على
    // مستوى الدائرة تماماً كان اسمها يجلس على البار.
    const from = 95 * math.pi / 180, to = 15 * math.pi / 180;
    final angle = from - (from - to) * (n == 1 ? 0 : i / (n - 1));
    final target = Offset(math.cos(angle) * _radius, -math.sin(angle) * _radius);

    // تتابع: كل قناة تتأخر قليلاً عن سابقتها — العين تتبع الحركة لا تقفز إليها
    final start = i * 0.12;
    final curve = CurvedAnimation(
      parent: anim,
      curve: Interval(start, (start + 0.7).clamp(0, 1), curve: Curves.easeOutBack),
      reverseCurve: const Interval(0, 0.8, curve: Curves.easeIn),
    );
    const size = 58.0;
    return AnimatedBuilder(
      animation: curve,
      builder: (context, child) {
        final t = curve.value;
        final p = _origin + target * t;
        return Positioned(
          left: p.dx - 45,
          top: p.dy - size / 2,
          child: Opacity(
            opacity: t.clamp(0, 1),
            child: Transform.scale(scale: 0.4 + 0.6 * t.clamp(0, 1.2), child: child),
          ),
        );
      },
      child: _ChannelBubble(
        key: Key('picker.${c.wire}'),
        channel: c,
        selected: c == selected,
        badge: RailBadge.of(summary.of(c)),
        onTap: () => onPick(c),
        size: size,
      ),
    );
  }
}

class _ChannelBubble extends StatelessWidget {
  const _ChannelBubble({
    super.key,
    required this.channel,
    required this.selected,
    required this.badge,
    required this.onTap,
    required this.size,
  });

  final Channel channel;
  final bool selected;
  final RailBadge badge;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Semantics(
      button: true,
      selected: selected,
      label: badge.semantics(channel),
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          width: 90,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox.square(
                dimension: size,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Glass(
                      tint: selected ? hc.live.withValues(alpha: 0.22) : null,
                      child: Center(child: ChannelGlyph(channel, size: 27)),
                    ),
                    if (selected)
                      Positioned.fill(
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: hc.live, width: 2),
                            ),
                          ),
                        ),
                      ),
                    PositionedDirectional(top: -5, end: -5, child: ChannelBadge(badge)),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Text(
                channel.label,
                style: TextStyle(
                  fontFamily: kFont,
                  fontSize: 12.5,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                  color: Colors.white,
                  shadows: const [Shadow(color: Colors.black54, blurRadius: 8)],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// شارة القناة: أحمر لما ينتظرك، رمادي لغير المقروء، ونقطة حين يجتمعان.
class ChannelBadge extends StatelessWidget {
  const ChannelBadge(this.badge, {super.key});
  final RailBadge badge;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final ring = Border.all(color: hc.bg, width: 2);
    switch (badge.kind) {
      case RailBadgeKind.none:
        return const SizedBox.shrink();
      case RailBadgeKind.unread:
        return Container(
          key: const Key('badge.unread'),
          decoration: BoxDecoration(border: ring, borderRadius: BorderRadius.circular(20)),
          child: CountBadge(count: badge.count, color: hc.text3, textColor: hc.bg, size: 20),
        );
      case RailBadgeKind.handoff:
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              key: const Key('badge.handoff'),
              decoration: BoxDecoration(border: ring, borderRadius: BorderRadius.circular(20)),
              child: CountBadge(count: badge.count, color: hc.handoff, textColor: Colors.white, size: 20),
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
