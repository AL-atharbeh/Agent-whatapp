import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../chat/outbox_controller.dart';

class InboxState {
  const InboxState({
    this.summary = InboxSummary.empty,
    this.online = true,
    this.lastSyncAt,
  });

  final InboxSummary summary;

  /// آخر استطلاع نجح؟ يقود شريط «بلا اتصال».
  final bool online;
  final DateTime? lastSyncAt;

  InboxState copyWith({InboxSummary? summary, bool? online, DateTime? lastSyncAt}) => InboxState(
        summary: summary ?? this.summary,
        online: online ?? this.online,
        lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      );
}

final inboxProvider = NotifierProvider<InboxController, InboxState>(InboxController.new);

/// استطلاع `/inbox/summary` في المقدّمة، بسرعة تتبع ما ينظر إليه المستخدم.
///
/// هذا احتياط الإشعارات لا بديلها: إشعار قد يتأخر أو يُحجب، لكن من فتح
/// التطبيق يجب أن يرى الجديد خلال ثوانٍ. في الخلفية يتوقف تماماً — لا بطارية
/// ولا بيانات تُصرف على شاشة لا يراها أحد.
///
/// كان ثابتاً كل ٨ ثوانٍ، والخادم يحفظ الرسالة خلال أقل من ثانية — فيرى
/// الموظف داخل محادثة جارية ردّ العميل متأخراً حتى ثماني ثوانٍ، ويظن التطبيق
/// بطيئاً. داخل المحادثة المفتوحة كل ثانيتين، وعلى القائمة كل أربع.
class InboxController extends Notifier<InboxState> {
  static const focused = Duration(seconds: 2);
  static const idle = Duration(seconds: 4);

  Duration get interval => ref.read(openConversationProvider) != null ? focused : idle;
  static const _cacheKey = 'inbox.summary';

  Timer? _timer;
  Future<void>? _inFlight;

  /// أول ملخّص حيّ لا يُطلق نبضة: القوائم تحمّل نفسها عند الفتح أصلاً،
  /// ونبضة هنا تعني طلباً مكرّراً لكل قائمة لحظة التشغيل.
  bool _hasLive = false;

  @override
  InboxState build() {
    final account = ref.watch(accountKeyProvider);
    ref.onDispose(stop);
    // فتح محادثة أو إغلاقها يغيّر السرعة فوراً، مع استطلاع فوري عند الفتح.
    ref.listen(openConversationProvider, (prev, next) {
      if (!isPolling || (prev == null) == (next == null)) return;
      start();
    });
    _hasLive = false;
    if (account == null) return const InboxState();
    unawaited(_loadCached());
    return const InboxState();
  }

  Future<void> _loadCached() async {
    final j = await ref.read(databaseProvider).getJson(_cacheKey);
    if (j == null || !ref.mounted) return;
    // لا نكتب فوق ملخّص حيّ وصل قبل الذاكرة.
    if (state.summary.version.isEmpty) {
      state = state.copyWith(summary: InboxSummary.fromJson(j));
    }
  }

  bool get isPolling => _timer != null;

  void start() {
    if (ref.read(accountKeyProvider) == null) return;
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => unawaited(refresh()));
    unawaited(refresh());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// استطلاع واحد. متزامنان (المؤقت + عودة الاتصال) يشتركان في نفس الطلب.
  Future<void> refresh() => _inFlight ??= _poll().whenComplete(() => _inFlight = null);

  Future<void> _poll() async {
    if (ref.read(accountKeyProvider) == null) return;
    try {
      final s = await ref.read(apiProvider).inboxSummary();
      if (!ref.mounted) return;
      // عودة من انقطاع تُطلق نبضة أيضاً: القوائم فشلت في التحميل حينها.
      final changed = (_hasLive && s.version != state.summary.version) || !state.online;
      _hasLive = true;
      state = state.copyWith(summary: s, online: true, lastSyncAt: DateTime.now());
      if (changed) ref.read(inboxPulseProvider.notifier).bump();
      unawaited(ref.read(databaseProvider).setJson(_cacheKey, s.toJson()));
      // الاتصال يعمل ⇒ فرصة لإفراغ ما علق في الطابور.
      unawaited(ref.read(outboxProvider.notifier).flush());
    } on ApiError catch (e) {
      if (!ref.mounted) return;
      if (e.isOffline) state = state.copyWith(online: false);
    } catch (_) {
      // خطأ غير متوقّع في استطلاع خلفي لا يستحق إزعاج المستخدم.
    }
  }

  /// بعد قراءة محادثة: الشارة تنقص فوراً دون انتظار الاستطلاع التالي.
  void applyRead(Channel channel, {required bool hadUnread}) {
    if (!hadUnread) return;
    final cur = state.summary.of(channel);
    final next = ChannelSummary(
      channel: channel,
      unread: (cur.unread - 1).clamp(0, 1 << 30),
      handoff: cur.handoff,
    );
    state = state.copyWith(
      summary: InboxSummary(
        channels: {...state.summary.channels, channel: next},
        version: state.summary.version,
      ),
    );
  }
}
