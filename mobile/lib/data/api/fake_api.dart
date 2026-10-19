import 'dart:async';
import 'dart:math';

import '../../core/errors.dart';
import '../models.dart';
import 'fake_data.dart';
import 'hader_api.dart';

/// خادم وهمي في الذاكرة يطبّق **نفس دلالات العقد**: النافذة من آخر رسالة
/// USER، تكرار clientId يعيد نفس الرسالة، الرد يحوّل BOT ⇒ HUMAN، الأخطاء
/// بنفس الرموز. الهدف أن يكون كل ما ينجح هنا ناجحاً مع الخادم الحقيقي.
///
/// حساب العرض: [demoEmail] / [demoPassword].
/// كلمات سحرية في نص الإرسال لاختبار المسارات الصعبة يدوياً:
/// - `#fail` ⇒ ‎502 SEND_FAILED (رفض صريح؛ الإعادة بنفس المعرّف تحاول فعلاً)
/// - `#unknown` ⇒ ‎409 DELIVERY_UNKNOWN (ويبقى كذلك لنفس المعرّف إلى الأبد)
/// - `#slow` ⇒ ‎409 IN_PROGRESS ثم تكتمل وحدها بعد ٤ ثوانٍ وتظهر في messages
/// - `#500` ⇒ ‎500 INTERNAL
/// - `#offline` ⇒ انقطاع شبكة قبل أي رد
/// - `#inactive` ⇒ يوقف المتجر (‎403 TENANT_INACTIVE لكل إرسال بعدها)
class FakeHaderApi implements HaderApi {
  FakeHaderApi({
    this.latency = const Duration(milliseconds: 350),
    this.failRate = 0,
    bool liveInbound = false,
    Random? random,
    DateTime Function()? now,
    this.token,
    this.onUnauthenticated,
    this.tenantInactive = false,
    this.slowCompletion = const Duration(seconds: 4),
  })  : _random = random ?? Random(),
        _now = now ?? (() => DateTime.now().toUtc()) {
    _seed();
    if (liveInbound) {
      _live = Timer.periodic(const Duration(seconds: 35), (_) => _simulateInbound());
    }
  }

  static const demoEmail = 'demo@hader.app';
  static const demoPassword = 'hader1234';

  final Duration latency;
  final double failRate;
  final Random _random;
  final DateTime Function() _now;
  /// مصدر رمز الجلسة الحالي (من التطبيق)، و«انتهت الجلسة» كما يفعل dio.
  final String? Function()? token;
  final void Function()? onUnauthenticated;
  Timer? _live;
  bool _expired = false;

  /// عدّاد يرتفع مع كل تغيير — يقابل `version` في الملخّص.
  int _version = 1760622400000;
  int _idSeq = 1000;
  int _failedLogins = 0;
  bool _loggedIn = false;
  String _deviceName = 'iPhone';
  String _platform = 'ios';
  NotifyMode _notify = NotifyMode.all;

  /// مفتوح للاختبارات: يعطّل الشبكة لكل النداءات.
  bool offline = false;

  /// المتجر موقوف: القراءة تعمل، والإرسال ‎403 TENANT_INACTIVE.
  bool tenantInactive;

  /// متى يكتمل إرسال `#slow` بعد أن ردّ IN_PROGRESS.
  final Duration slowCompletion;

  /// مفتوح للاختبارات: كم مرة استُقبل إرسال فعلي (لا تكرار clientId).
  int deliveredSends = 0;

  final Map<String, _FakeConversation> _convs = {};
  /// حجز clientId قبل «Meta» — كما يصف العقد: الطلب الثاني بنفس المعرّف لا
  /// يصل Meta أبداً، ويُردّ عليه حسب حالة الحجز.
  final Map<String, _Reservation> _reservations = {};
  final Map<String, ConversationItem> _startedByClientId = {};
  final List<DeviceInfo> _otherDevices = [];

  void dispose() => _live?.cancel();

  void _seed() {
    final now = _now();
    for (final s in fakeSeeds) {
      final msgs = <Message>[
        for (final (role, text, minsAgo) in s.script)
          Message(
            id: 'm_${_idSeq++}',
            role: role,
            text: text,
            at: now.subtract(Duration(minutes: minsAgo)),
          ),
      ];
      _convs[s.id] = _FakeConversation(
        id: s.id,
        channel: s.channel,
        name: s.name,
        externalUserId: s.externalUserId,
        displayId: s.displayId,
        status: s.status,
        handoffReason: s.handoffReason,
        unread: s.unread,
        messages: msgs,
      );
    }
    _otherDevices.addAll([
      DeviceInfo(
        id: 'd_android',
        name: 'Samsung Galaxy S24',
        platform: 'android',
        lastSeenAt: now.subtract(const Duration(days: 3)),
        createdAt: now.subtract(const Duration(days: 40)),
        current: false,
      ),
      DeviceInfo(
        id: 'd_ipad',
        name: 'iPad Air',
        platform: 'ios',
        lastSeenAt: now.subtract(const Duration(days: 12)),
        createdAt: now.subtract(const Duration(days: 70)),
        current: false,
      ),
    ]);
  }

  // ───────────── أدوات ─────────────

  Future<void> _delay({bool canFail = true}) async {
    if (latency > Duration.zero) {
      final jitter = _random.nextInt(latency.inMilliseconds + 1);
      await Future<void>.delayed(latency * 0.6 + Duration(milliseconds: jitter));
    }
    if (offline) {
      throw ApiError(ApiErrorCode.network, ApiError.defaultMessage(ApiErrorCode.network));
    }
    if (canFail && failRate > 0 && _random.nextDouble() < failRate) {
      throw ApiError(ApiErrorCode.network, ApiError.defaultMessage(ApiErrorCode.network));
    }
  }

  /// مع مصدر رمز (التطبيق): أي رمز `fake_` صالح — كي تبقى الجلسة بعد إعادة
  /// تشغيل التطبيق رغم أن الخادم الوهمي يُنشأ من جديد. بدونه (الاختبارات):
  /// حالة الدخول الداخلية.
  bool get _authed {
    if (_expired) return false;
    final t = token;
    if (t != null) return t()?.startsWith('fake_') ?? false;
    return _loggedIn;
  }

  void _requireAuth() {
    if (!_authed) {
      onUnauthenticated?.call();
      throw ApiError(
        ApiErrorCode.unauthenticated,
        ApiError.defaultMessage(ApiErrorCode.unauthenticated),
        status: 401,
      );
    }
  }

  _FakeConversation _conv(String id) {
    final c = _convs[id];
    if (c == null) {
      throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404);
    }
    return c;
  }

  ConversationItem _item(_FakeConversation c) => c.toItem(_now());

  void _bump() => _version++;

  // ───────────── المصادقة والجهاز ─────────────

  @override
  Future<LoginResult> login({
    required String email,
    required String password,
    required String deviceName,
    required String platform,
  }) async {
    await _delay(canFail: false);
    final e = email.trim().toLowerCase();
    if (_failedLogins >= 5) {
      throw const ApiError(
        ApiErrorCode.rateLimited,
        'محاولات كثيرة. حاول بعد ١٥ دقيقة.',
        status: 429,
        retryAfter: Duration(minutes: 15),
      );
    }
    if (e == 'admin@hader.app') {
      throw ApiError(ApiErrorCode.adminNotSupported,
          ApiError.defaultMessage(ApiErrorCode.adminNotSupported), status: 403);
    }
    if (e != demoEmail || password != demoPassword) {
      _failedLogins++;
      throw ApiError(ApiErrorCode.invalidCredentials,
          ApiError.defaultMessage(ApiErrorCode.invalidCredentials), status: 401);
    }
    _failedLogins = 0;
    _loggedIn = true;
    _expired = false;
    _deviceName = deviceName;
    _platform = platform;
    return LoginResult(
      token: 'fake_${_random.nextInt(1 << 32).toRadixString(16)}',
      expiresAt: _now().add(const Duration(days: 30)),
      user: _user,
      tenant: _tenant,
    );
  }

  static const _user = UserInfo(id: 'u_1', email: demoEmail, name: 'بشار يوسف');
  static const _tenant = TenantInfo(
    id: 't_1',
    slug: 'shifra-code',
    name: 'شيفرة كود',
    agentName: 'ريم',
  );

  /// يحاكي سحب الجلسة من جهاز آخر — يجعل الطلب التالي ‎401.
  void expireSession() {
    _loggedIn = false;
    _expired = true;
  }

  @override
  Future<void> logout() async {
    await _delay(canFail: false);
    _loggedIn = false;
  }

  @override
  Future<MeInfo> me() async {
    await _delay();
    _requireAuth();
    return MeInfo(
      user: _user,
      tenant: _tenant,
      channels: const [
        ChannelConnection(channel: Channel.whatsapp, connected: true),
        ChannelConnection(channel: Channel.instagram, connected: true),
        ChannelConnection(channel: Channel.messenger, connected: true),
      ],
      deviceId: 'd_current',
      notify: _notify,
    );
  }

  @override
  Future<void> updateCurrentDevice({String? pushToken, NotifyMode? notify}) async {
    await _delay();
    _requireAuth();
    if (notify != null) _notify = notify;
  }

  @override
  Future<List<DeviceInfo>> devices() async {
    await _delay();
    _requireAuth();
    final now = _now();
    return [
      DeviceInfo(
        id: 'd_current',
        name: _deviceName,
        platform: _platform,
        lastSeenAt: now,
        createdAt: now.subtract(const Duration(days: 1)),
        current: true,
      ),
      ..._otherDevices,
    ];
  }

  @override
  Future<void> revokeDevice(String id) async {
    await _delay();
    _requireAuth();
    final before = _otherDevices.length;
    _otherDevices.removeWhere((d) => d.id == id);
    if (_otherDevices.length == before) {
      throw ApiError(ApiErrorCode.notFound, ApiError.defaultMessage(ApiErrorCode.notFound), status: 404);
    }
  }

  // ───────────── الصندوق ─────────────

  @override
  Future<InboxSummary> inboxSummary() async {
    await _delay();
    _requireAuth();
    return InboxSummary(
      channels: {
        for (final ch in Channel.rail)
          ch: ChannelSummary(
            channel: ch,
            unread: _convs.values.where((c) => c.channel == ch && c.unread > 0).length,
            handoff: _convs.values
                .where((c) => c.channel == ch && c.status == ConversationStatus.human)
                .length,
          ),
      },
      version: '$_version',
    );
  }

  @override
  Future<ConversationPage> conversations(
    Channel channel, {
    String? cursor,
    int limit = 30,
  }) async {
    await _delay();
    _requireAuth();
    final now = _now();
    int byRecent(_FakeConversation a, _FakeConversation b) =>
        (b.lastAt ?? DateTime(0)).compareTo(a.lastAt ?? DateTime(0));
    final all = _convs.values.where((c) => c.channel == channel).toList()..sort(byRecent);
    final pinned = cursor == null
        ? all.where((c) => c.status == ConversationStatus.human).take(200).toList()
        : <_FakeConversation>[];
    final rest = all.where((c) => c.status != ConversationStatus.human).toList();
    final start = int.tryParse(cursor ?? '0') ?? 0;
    final n = limit.clamp(1, 50);
    final page = rest.skip(start).take(n).toList();
    final next = start + n < rest.length ? '${start + n}' : null;
    return ConversationPage(
      pinned: [for (final c in pinned) c.toItem(now)],
      items: [for (final c in page) c.toItem(now)],
      nextCursor: next,
    );
  }

  @override
  Future<ConversationItem> conversation(String id) async {
    await _delay();
    _requireAuth();
    return _item(_conv(id));
  }

  @override
  Future<MessagePage> messages(String id, {String? before, int limit = 50}) async {
    await _delay();
    _requireAuth();
    final c = _conv(id);
    var end = c.messages.length;
    if (before != null) {
      final i = c.messages.indexWhere((m) => m.id == before);
      end = i < 0 ? 0 : i;
    }
    final n = limit.clamp(1, 50);
    final start = max(0, end - n);
    return MessagePage(items: c.messages.sublist(start, end), hasMore: start > 0);
  }

  @override
  Future<void> markRead(String id) async {
    await _delay();
    _requireAuth();
    final c = _conv(id);
    if (c.unread != 0) {
      c.unread = 0;
      _bump();
    }
  }

  // ───────────── الإرسال ─────────────

  @override
  Future<SendResult> sendText(
    String conversationId, {
    required String text,
    required String clientId,
  }) async {
    await _delay(canFail: false);
    _requireAuth();
    final c = _conv(conversationId);
    final trimmed = text.trim();
    if (trimmed.isEmpty || trimmed.length > 4096) {
      throw const ApiError(ApiErrorCode.invalidInput, 'نص الرسالة فارغ أو أطول من ٤٠٩٦ حرفاً.', status: 400);
    }
    if (trimmed.contains('#offline')) {
      throw ApiError(ApiErrorCode.network, ApiError.defaultMessage(ApiErrorCode.network));
    }
    if (failRate > 0 && _random.nextDouble() < failRate) {
      // انقطاع قبل وصول الطلب — لا حجز، والإعادة بنفس المعرّف آمنة.
      throw ApiError(ApiErrorCode.network, ApiError.defaultMessage(ApiErrorCode.network));
    }
    return _reserveAndSend(c, clientId, 'text|$conversationId|$trimmed', trimmed, checkWindow: true);
  }

  /// نفس منطق الخادم: تحقّق ⇒ حجز ⇒ «Meta» ⇒ تخزين.
  SendResult _reserveAndSend(
    _FakeConversation c,
    String clientId,
    String fingerprint,
    String text, {
    required bool checkWindow,
  }) {
    final r = _reservations[clientId];
    if (r != null) {
      if (r.fingerprint != fingerprint) {
        throw const ApiError(ApiErrorCode.invalidInput, 'معرّف الإرسال مستخدم لرسالة أخرى.', status: 400);
      }
      switch (r.state) {
        case _ResState.done:
          return r.result!;
        case _ResState.inProgress:
          throw ApiError(ApiErrorCode.inProgress, ApiError.defaultMessage(ApiErrorCode.inProgress), status: 409);
        case _ResState.unknown:
          throw ApiError(ApiErrorCode.deliveryUnknown, ApiError.defaultMessage(ApiErrorCode.deliveryUnknown), status: 409);
      }
    }
    if (text.contains('#inactive')) tenantInactive = true;
    if (tenantInactive) {
      throw ApiError(ApiErrorCode.tenantInactive, ApiError.defaultMessage(ApiErrorCode.tenantInactive), status: 403);
    }
    if (checkWindow && !c.windowAt(_now()).isOpenAt(_now())) {
      throw ApiError(ApiErrorCode.windowClosed, ApiError.defaultMessage(ApiErrorCode.windowClosed), status: 409);
    }
    if (text.contains('#fail')) {
      // رفض صريح: لا تخزين ولا حجز باقٍ — الإعادة بنفس المعرّف تحاول فعلاً.
      throw ApiError(ApiErrorCode.sendFailed, ApiError.defaultMessage(ApiErrorCode.sendFailed), status: 502);
    }
    if (text.contains('#500')) {
      _reservations[clientId] = _Reservation(fingerprint, _ResState.unknown);
      throw ApiError(ApiErrorCode.internal, ApiError.defaultMessage(ApiErrorCode.internal), status: 500);
    }
    if (text.contains('#unknown')) {
      _reservations[clientId] = _Reservation(fingerprint, _ResState.unknown);
      throw ApiError(ApiErrorCode.deliveryUnknown, ApiError.defaultMessage(ApiErrorCode.deliveryUnknown), status: 409);
    }
    if (text.contains('#slow')) {
      final res = _Reservation(fingerprint, _ResState.inProgress);
      _reservations[clientId] = res;
      Timer(slowCompletion, () {
        res
          ..result = _deliver(c, text, clientId)
          ..state = _ResState.done;
      });
      throw ApiError(ApiErrorCode.inProgress, ApiError.defaultMessage(ApiErrorCode.inProgress), status: 409);
    }
    final result = _deliver(c, text, clientId);
    _reservations[clientId] = _Reservation(fingerprint, _ResState.done)..result = result;
    return result;
  }

  SendResult _deliver(_FakeConversation c, String text, String clientId) {
    deliveredSends++;
    final msg = Message(
      id: 'm_${_idSeq++}',
      role: Role.human,
      text: text,
      at: _now(),
      clientId: clientId,
    );
    c.messages.add(msg);
    // الرد يعني الاستلام: BOT ⇒ HUMAN في نفس العملية.
    if (c.status != ConversationStatus.human) c.status = ConversationStatus.human;
    _bump();
    return SendResult(message: msg, conversation: _item(c));
  }

  @override
  Future<ConversationItem> takeover(String id) async {
    await _delay();
    _requireAuth();
    final c = _conv(id);
    c.status = ConversationStatus.human;
    _bump();
    return _item(c);
  }

  @override
  Future<ConversationItem> release(String id) async {
    await _delay();
    _requireAuth();
    final c = _conv(id);
    c.status = ConversationStatus.bot;
    c.handoffReason = null;
    _bump();
    return _item(c);
  }

  @override
  Future<List<MessageTemplate>> templates() async {
    await _delay();
    _requireAuth();
    return fakeTemplates;
  }

  MessageTemplate _validTemplate(TemplateSelection t) {
    final tpl = fakeTemplates.where((x) => x.name == t.template.name).firstOrNull;
    if (tpl == null ||
        t.variables.length < tpl.variables ||
        t.variables.take(tpl.variables).any((v) => v.trim().isEmpty)) {
      throw ApiError(ApiErrorCode.templateInvalid,
          ApiError.defaultMessage(ApiErrorCode.templateInvalid), status: 422);
    }
    return tpl;
  }

  @override
  Future<SendResult> sendTemplate(
    String conversationId, {
    required TemplateSelection template,
    required String clientId,
  }) async {
    await _delay(canFail: false);
    _requireAuth();
    final c = _conv(conversationId);
    if (c.channel != Channel.whatsapp) {
      throw const ApiError(ApiErrorCode.invalidInput, 'القوالب لواتساب فقط.', status: 400);
    }
    final tpl = _validTemplate(template);
    final text = tpl.render(template.variables);
    return _reserveAndSend(
      c,
      clientId,
      'tpl|$conversationId|${tpl.name}|${template.variables.join('|')}',
      text,
      checkWindow: false,
    );
  }

  @override
  Future<ConversationItem> startConversation({
    required String phone,
    String? name,
    required TemplateSelection template,
    required String clientId,
  }) async {
    await _delay(canFail: false);
    _requireAuth();
    final dup = _startedByClientId[clientId];
    if (dup != null) return dup;
    if (tenantInactive) {
      throw ApiError(ApiErrorCode.tenantInactive, ApiError.defaultMessage(ApiErrorCode.tenantInactive), status: 403);
    }
    final normalized = normalizePhone(phone);
    if (normalized == null) {
      throw const ApiError(ApiErrorCode.invalidInput, 'رقم الهاتف غير صحيح.', status: 400);
    }
    final tpl = _validTemplate(template);
    final existing = _convs.values
        .where((c) => c.channel == Channel.whatsapp && c.displayId == normalized)
        .firstOrNull;
    final c = existing ??
        _FakeConversation(
          id: 'c_new_${_idSeq++}',
          channel: Channel.whatsapp,
          name: (name?.trim().isEmpty ?? true) ? null : name!.trim(),
          externalUserId: normalized.substring(1),
          displayId: normalized,
          status: ConversationStatus.human,
          messages: [],
        );
    _convs[c.id] = c;
    final r = _deliver(c, tpl.render(template.variables), clientId);
    _reservations[clientId] = _Reservation('start|$normalized|${tpl.name}', _ResState.done)..result = r;
    final item = _item(c);
    _startedByClientId[clientId] = item;
    return item;
  }

  /// توحيد مبسّط كما في `startConversation` بالويب: ٠٧… أردني ⇒ ‎+962.
  static String? normalizePhone(String raw) {
    var d = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (d.startsWith('00')) d = '+${d.substring(2)}';
    if (d.startsWith('07') && d.length == 10) d = '+962${d.substring(1)}';
    if (d.startsWith('7') && d.length == 9) d = '+962$d';
    if (!d.startsWith('+')) d = '+$d';
    final digits = d.substring(1);
    if (!RegExp(r'^\d{8,15}$').hasMatch(digits)) return null;
    return d;
  }

  @override
  Future<LeadPage> leads({String? cursor, int limit = 30}) async {
    await _delay();
    _requireAuth();
    return LeadPage(items: [
      Lead(
        id: 'l_1',
        name: 'أحمد العطاربة',
        phone: '+962770466649',
        channel: Channel.whatsapp,
        interest: 'متجر ملابس ~٣٠٠ منتج',
        notes: 'يطلب خصماً',
        at: _now().subtract(const Duration(hours: 18)),
      ),
    ], nextCursor: null);
  }

  // ───────────── محاكاة الحياة ─────────────

  /// رسالة عميل جديدة في محادثة عشوائية + رد الوكيل بعد ثانيتين.
  void _simulateInbound() {
    if (!_authed) return;
    final candidates = _convs.values
        .where((c) => c.status == ConversationStatus.bot && c.channel != Channel.unknown)
        .toList();
    if (candidates.isEmpty) return;
    final c = candidates[_random.nextInt(candidates.length)];
    final (q, a) = fakeLiveLines[_random.nextInt(fakeLiveLines.length)];
    c.messages.add(Message(id: 'm_${_idSeq++}', role: Role.user, text: q, at: _now()));
    c.unread++;
    _bump();
    Timer(const Duration(seconds: 2), () {
      c.messages.add(Message(id: 'm_${_idSeq++}', role: Role.agent, text: a, at: _now()));
      if (q.contains('رقم حدا')) {
        c.status = ConversationStatus.human;
        c.handoffReason = 'العميل طلب التواصل مع موظف';
      }
      _bump();
    });
  }
}

class _FakeConversation {
  _FakeConversation({
    required this.id,
    required this.channel,
    required this.name,
    required this.externalUserId,
    required this.displayId,
    required this.status,
    this.handoffReason,
    this.unread = 0,
    required this.messages,
  });

  final String id;
  final Channel channel;
  final String? name;
  final String externalUserId;
  final String displayId;
  ConversationStatus status;
  String? handoffReason;
  int unread;
  final List<Message> messages;

  DateTime? get lastAt => messages.isEmpty ? null : messages.last.at;

  /// open = lastInboundAt != null && now < lastInboundAt + 24h — حرفياً من العقد.
  ChatWindow windowAt(DateTime now) {
    final lastInbound = messages.lastWhere(
      (m) => m.role == Role.user,
      orElse: () => Message(id: '', role: Role.unknown, text: '', at: DateTime(0)),
    );
    if (lastInbound.role != Role.user) return ChatWindow.closed;
    final closes = lastInbound.at.add(const Duration(hours: 24));
    return now.isBefore(closes)
        ? ChatWindow(open: true, closesAt: closes)
        : ChatWindow.closed;
  }

  ConversationItem toItem(DateTime now) {
    final last = messages.isEmpty ? null : messages.last;
    return ConversationItem(
      id: id,
      channel: channel,
      customerName: name,
      externalUserId: externalUserId,
      displayId: displayId,
      status: status,
      handoffReason: handoffReason,
      lastMessage: last == null
          ? null
          : LastMessage(text: last.text, role: last.role, at: last.at),
      unreadCount: unread,
      window: windowAt(now),
    );
  }
}

enum _ResState { inProgress, done, unknown }

class _Reservation {
  _Reservation(this.fingerprint, this.state);

  final String fingerprint;
  _ResState state;
  SendResult? result;
}
