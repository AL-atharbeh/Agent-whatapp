import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';

/// صف محادثة. ارتفاع ثابت تقريباً + `RepaintBoundary` لكل صف كي تبقى
/// القائمة على ٦٠ إطاراً مع مئات المحادثات.
class ConversationTile extends StatelessWidget {
  const ConversationTile({super.key, required this.item, required this.now, required this.onTap});

  final ConversationItem item;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final unread = item.unreadCount > 0;
    final last = item.lastMessage;
    final name = displayName(item);
    final showNumber = item.customerName != null && item.channel == Channel.whatsapp;

    return RepaintBoundary(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: Key('conv.${item.id}'),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(14, 11, 14, 11),
            child: Row(
              children: [
                InitialsAvatar(seed: item.id, label: name, size: 50),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Row(
                              children: [
                                Flexible(
                                  child: item.customerName == null
                                      ? LtrText(name, style: _nameStyle(hc, unread))
                                      : Text(
                                          name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: _nameStyle(hc, unread),
                                        ),
                                ),
                                if (showNumber) ...[
                                  const SizedBox(width: 6),
                                  // الاسم يأخذ الأولوية، والرقم يتقلّص قبله إن ضاق السطر.
                                  Flexible(
                                    flex: 0,
                                    fit: FlexFit.loose,
                                    child: ConstrainedBox(
                                      constraints: const BoxConstraints(maxWidth: 120),
                                      child: LtrText(
                                        formatPhone(item.displayId),
                                        style: TextStyle(fontFamily: kFont, fontSize: 11.5, color: hc.text3, height: 1.3),
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          if (last != null)
                            Text(
                              relativeTime(last.at, now),
                              style: TextStyle(
                                fontFamily: kFont,
                                fontSize: 12,
                                fontWeight: unread ? FontWeight.w600 : FontWeight.w400,
                                color: unread ? hc.live : hc.text3,
                                height: 1.3,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          if (last != null && last.role.isOutgoing) ...[
                            Icon(
                              last.role == Role.agent ? Icons.smart_toy_outlined : Icons.reply_rounded,
                              size: 15,
                              color: hc.text3,
                            ),
                            const SizedBox(width: 4),
                          ],
                          Expanded(
                            child: Text(
                              _preview(last),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: kFont,
                                fontSize: 14,
                                color: unread ? hc.text : hc.text2,
                                fontWeight: unread ? FontWeight.w500 : FontWeight.w400,
                                height: 1.4,
                              ),
                            ),
                          ),
                          _WindowChip(item: item, now: now),
                          if (unread) ...[
                            const SizedBox(width: 6),
                            CountBadge(count: item.unreadCount, color: hc.live, textColor: hc.onLive, size: 21),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static TextStyle _nameStyle(HaderColors hc, bool unread) => TextStyle(
        fontFamily: kFont,
        fontSize: 15.5,
        fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
        color: hc.text,
        height: 1.35,
      );

  static String _preview(LastMessage? m) {
    if (m == null) return 'لا رسائل بعد';
    final t = m.text.replaceAll('\n', ' ').trim();
    if (m.role == Role.human) return 'أنت: $t';
    return t.isEmpty ? '…' : t;
  }
}

/// مؤشر النافذة — يظهر فقط حيث يهمّ: محادثة يتولّاها المالك (HUMAN)، أو
/// نافذة على وشك الإغلاق. مؤشر على كل صف يصبح ضجيجاً لا يُقرأ.
class _WindowChip extends StatelessWidget {
  const _WindowChip({required this.item, required this.now});

  final ConversationItem item;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final w = item.window;
    final open = w.isOpenAt(now);
    final urgency = windowUrgency(w, now);
    // النافذة المنقضية لا شارة لها: الكتابة متاحة في كل محادثة كما في لوحة
    // الويب، وشارة «مغلقة» أو «قالب فقط» كانت تُقرأ قيداً يفرضه التطبيق.
    final relevant = open && (item.isHuman || urgency != WindowUrgency.calm);
    if (!relevant) return const SizedBox.shrink();

    final fg = switch (urgency) {
      WindowUrgency.critical => hc.danger,
      WindowUrgency.soon => hc.warn,
      WindowUrgency.calm => hc.live,
    };
    const icon = Icons.schedule_rounded;
    final label = windowShortLabel(w, now) ?? '';
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: fg.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(R.xs),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: fg),
            const SizedBox(width: 3),
            Text(
              label,
              style: TextStyle(fontFamily: kFont, fontSize: 11, fontWeight: FontWeight.w600, color: fg, height: 1.3),
            ),
          ],
        ),
      ),
    );
  }
}
