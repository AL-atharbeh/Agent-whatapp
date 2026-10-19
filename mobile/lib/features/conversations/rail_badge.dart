import '../../data/models.dart';

enum RailBadgeKind { none, unread, handoff }

/// شارة أيقونة القناة في الشريط.
///
/// الأحمر (تحويل ينتظر المالك) يتقدّم دائماً على الرمادي (غير مقروء): هو
/// الفعل المطلوب الآن. لو عرضنا مجموع الاثنين برقم واحد لما عرف المالك إن
/// كان أحد ينتظره فعلاً أم أنها رسائل تولّاها الوكيل. فإن وُجد الاثنان:
/// رقم أحمر للتحويلات + نقطة رمادية صغيرة تقول «وهناك غير مقروء أيضاً».
class RailBadge {
  const RailBadge(this.kind, this.count, {this.unreadDot = false});

  static const none = RailBadge(RailBadgeKind.none, 0);

  final RailBadgeKind kind;
  final int count;
  final bool unreadDot;

  factory RailBadge.of(ChannelSummary s) {
    if (s.handoff > 0) return RailBadge(RailBadgeKind.handoff, s.handoff, unreadDot: s.unread > 0);
    if (s.unread > 0) return RailBadge(RailBadgeKind.unread, s.unread);
    return none;
  }

  /// للقارئ الصوتي: الشارة وحدها لون، والكفيف لا يرى اللون.
  String semantics(Channel c) => switch (kind) {
        RailBadgeKind.none => c.label,
        RailBadgeKind.unread => '${c.label}، $count محادثة غير مقروءة',
        RailBadgeKind.handoff =>
          '${c.label}، $count محادثة تنتظرك${unreadDot ? '، وأخرى غير مقروءة' : ''}',
      };

  @override
  bool operator ==(Object other) =>
      other is RailBadge && other.kind == kind && other.count == count && other.unreadDot == unreadDot;

  @override
  int get hashCode => Object.hash(kind, count, unreadDot);

  @override
  String toString() => 'RailBadge($kind, $count, dot: $unreadDot)';
}
