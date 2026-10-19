import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../data/models.dart';
import '../../data/outbox/outbox_entry.dart';
import '../../ui/theme.dart';

/// pending: ساعة. failed: رفض صريح (أحمر). uncertain: ربما وصلت (كهرماني) —
/// لونان مختلفان لأن القرار المطلوب مختلف: الأول «أعِد بأمان»، والثاني
/// «هل تقبل احتمال أن يصل العميل ردّان؟».
enum BubbleStatus { sent, pending, failed, uncertain }

/// فقاعة رسالة.
///
/// الاتجاه بأسلوب واتساب العربي: العميل على اليمين (بداية السطر في RTL)،
/// ونحن على اليسار. وبين «نحن» فرق مهم: رد الوكيل الآلي (أخضر خافت + «🤖»)
/// ورد صاحب المتجر (أخضر ممتلئ + «أنت») — كي يعرف بنظرة ما قاله هو بنفسه
/// وما قاله الوكيل باسمه.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.role,
    required this.text,
    required this.at,
    required this.agentName,
    this.status = BubbleStatus.sent,
    this.errorMessage,
    this.isTemplate = false,
    this.onFailedTap,
    this.groupedWithNext = false,
  });

  factory MessageBubble.fromMessage(Message m, {required String agentName, bool groupedWithNext = false}) =>
      MessageBubble(
        key: ValueKey('m.${m.id}'),
        role: m.role,
        text: m.text,
        at: m.at,
        agentName: agentName,
        groupedWithNext: groupedWithNext,
      );

  factory MessageBubble.fromOutbox(OutboxEntry e, {required String agentName, VoidCallback? onFailedTap}) =>
      MessageBubble(
        key: ValueKey('o.${e.clientId}'),
        role: Role.human,
        text: e.text,
        at: e.createdAt,
        agentName: agentName,
        status: switch (e.state) {
          OutboxState.failed => BubbleStatus.failed,
          OutboxState.uncertain => BubbleStatus.uncertain,
          _ => BubbleStatus.pending,
        },
        errorMessage: e.isPending ? null : e.errorMessage,
        isTemplate: e.kind == OutboxKind.template,
        onFailedTap: onFailedTap,
      );

  final Role role;
  final String text;
  final DateTime at;
  final String agentName;
  final BubbleStatus status;
  final String? errorMessage;
  final bool isTemplate;
  final VoidCallback? onFailedTap;
  final bool groupedWithNext;

  @override
  Widget build(BuildContext context) {
    if (role == Role.system || role == Role.unknown) return _SystemLine(text: text);

    final hc = context.hc;
    final outgoing = role.isOutgoing;
    final human = role == Role.human;
    final failed = status == BubbleStatus.failed;
    final uncertain = status == BubbleStatus.uncertain;
    final problem = failed || uncertain;
    final problemColor = failed ? hc.danger : hc.warn;

    final bg = human ? hc.bubbleHuman : (outgoing ? hc.bubbleAgent : hc.bubbleUser);
    final fg = human ? hc.onBubbleHuman : hc.text;
    final metaColor = human ? hc.onBubbleHuman.withValues(alpha: 0.62) : hc.text3;
    const r = Radius.circular(18);
    const tail = Radius.circular(5);
    // الذيل في الزاوية السفلية جهة المرسل.
    final radius = BorderRadiusDirectional.only(
      topStart: r,
      topEnd: r,
      bottomStart: outgoing ? r : (groupedWithNext ? r : tail),
      bottomEnd: outgoing ? (groupedWithNext ? r : tail) : r,
    );

    final bubble = Container(
      padding: const EdgeInsetsDirectional.fromSTEB(13, 8, 13, 7),
      decoration: BoxDecoration(
        color: failed ? hc.dangerDim : (uncertain ? hc.warnDim : bg),
        borderRadius: radius,
        border: problem
            ? Border.all(color: problemColor.withValues(alpha: 0.6))
            : (human ? null : Border.all(color: outgoing ? hc.live.withValues(alpha: 0.14) : hc.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (outgoing)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                human ? (isTemplate ? 'أنت · قالب' : 'أنت') : '🤖 $agentName',
                style: TextStyle(
                  fontFamily: kFont,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: problem ? problemColor : (human ? hc.onBubbleHuman.withValues(alpha: 0.75) : hc.live),
                  height: 1.3,
                ),
              ),
            ),
          Text(
            text,
            style: TextStyle(
              fontFamily: kFont,
              fontSize: 15,
              color: problem ? hc.text : fg,
              fontWeight: human ? FontWeight.w500 : FontWeight.w400,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                clockTime(at),
                style: TextStyle(fontFamily: kFont, fontSize: 11, color: problem ? problemColor : metaColor, height: 1.2),
              ),
              if (outgoing && human) ...[
                const SizedBox(width: 4),
                Icon(
                  switch (status) {
                    BubbleStatus.sent => Icons.done_rounded,
                    BubbleStatus.pending => Icons.schedule_rounded,
                    BubbleStatus.failed => Icons.error_rounded,
                    BubbleStatus.uncertain => Icons.help_rounded,
                  },
                  size: 13,
                  color: problem ? problemColor : metaColor,
                ),
              ],
            ],
          ),
        ],
      ),
    );

    return Padding(
      padding: EdgeInsets.only(bottom: groupedWithNext ? 3 : 10),
      child: Align(
        alignment: outgoing ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
          child: Column(
            crossAxisAlignment: outgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              GestureDetector(
                onTap: problem ? onFailedTap : null,
                onLongPress: () {
                  Clipboard.setData(ClipboardData(text: text));
                  HapticFeedback.selectionClick();
                  showToast('نُسخ النص');
                },
                child: AnimatedOpacity(
                  duration: const Duration(milliseconds: 200),
                  opacity: status == BubbleStatus.pending ? 0.72 : 1,
                  child: bubble,
                ),
              ),
              if (problem)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: InkWell(
                    onTap: onFailedTap,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                      child: Text(
                        uncertain
                            ? 'غير مؤكّد — ربما وصلت · اضغط للخيارات'
                            : '${errorMessage ?? 'لم تُرسل'} · اضغط للخيارات',
                        textAlign: TextAlign.end,
                        style: TextStyle(fontFamily: kFont, fontSize: 12, color: problemColor, height: 1.4),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SystemLine extends StatelessWidget {
  const _SystemLine({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(color: hc.surface2, borderRadius: BorderRadius.circular(R.sm)),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text2, height: 1.4),
          ),
        ),
      ),
    );
  }
}

/// فاصل التاريخ («اليوم»، «أمس»، «١٢ أيلول»).
class DateChip extends StatelessWidget {
  const DateChip(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: hc.surface2,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: hc.border),
          ),
          child: Text(
            label,
            style: TextStyle(fontFamily: kFont, fontSize: 12, fontWeight: FontWeight.w600, color: hc.text2, height: 1.35),
          ),
        ),
      ),
    );
  }
}
