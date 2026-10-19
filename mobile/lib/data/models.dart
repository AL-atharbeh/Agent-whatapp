import '../core/json.dart';

/// كائنات العقد (docs/mobile-api.md — «الكائنات»).
///
/// كل `fromJson` متسامح: قيمة enum لم نعرفها بعد تصبح `unknown` بدل أن
/// ترمي، فإضافة قناة أو حالة جديدة في الخادم لا تكسر نسخاً قديمة من التطبيق
/// على هواتف لم تُحدَّث. و`toJson` يعيد نفس شكل السلك كي تُخزَّن الذاكرة
/// المحلية بالشكل نفسه وتُقرأ بالقارئ نفسه.

enum Channel {
  whatsapp('WHATSAPP', 'واتساب'),
  instagram('INSTAGRAM', 'إنستغرام'),
  messenger('MESSENGER', 'ماسنجر'),
  unknown('UNKNOWN', 'قناة');

  const Channel(this.wire, this.label);
  final String wire;
  final String label;

  /// القنوات الظاهرة في الشريط، بالترتيب الذي طلبه صاحب المتجر.
  static const rail = [Channel.whatsapp, Channel.instagram, Channel.messenger];

  static Channel fromWire(String? s) =>
      values.firstWhere((c) => c.wire == s, orElse: () => Channel.unknown);

  /// القوالب و«محادثة جديدة» لواتساب وحده (العقد: «واتساب فقط»).
  bool get supportsTemplates => this == Channel.whatsapp;
}

enum ConversationStatus {
  bot('BOT'),
  human('HUMAN'),
  closed('CLOSED'),
  unknown('UNKNOWN');

  const ConversationStatus(this.wire);
  final String wire;

  static ConversationStatus fromWire(String? s) => values
      .firstWhere((c) => c.wire == s, orElse: () => ConversationStatus.unknown);
}

enum Role {
  user('USER'),
  agent('AGENT'),
  human('HUMAN'),
  system('SYSTEM'),
  unknown('UNKNOWN');

  const Role(this.wire);
  final String wire;

  static Role fromWire(String? s) =>
      values.firstWhere((c) => c.wire == s, orElse: () => Role.unknown);

  /// من جهتنا (وكيل أو موظف) — يحدّد جانب الفقاعة.
  bool get isOutgoing => this == Role.agent || this == Role.human;
}

enum NotifyMode {
  all('all', 'كل الرسائل', 'إشعار لكل رسالة عميل جديدة'),
  handoff('handoff', 'التحويلات فقط', 'فقط حين يحوّل الوكيل محادثة إليك'),
  off('off', 'بلا إشعارات', 'لا شيء — تفتح التطبيق بنفسك');

  const NotifyMode(this.wire, this.label, this.hint);
  final String wire;
  final String label;
  final String hint;

  static NotifyMode fromWire(String? s) =>
      values.firstWhere((c) => c.wire == s, orElse: () => NotifyMode.all);
}

class ChatWindow {
  const ChatWindow({required this.open, this.closesAt});

  factory ChatWindow.fromJson(JsonMap m) => ChatWindow(
        open: readBool(m, 'open'),
        closesAt: readDateOrNull(m, 'closesAt'),
      );

  static const closed = ChatWindow(open: false);

  final bool open;
  final DateTime? closesAt;

  /// مفتوحة الآن فعلاً؟ الخادم قال «مفتوحة» عند آخر تحميل، لكن الشاشة قد
  /// تبقى مفتوحة ساعات؛ فنتحقق من `closesAt` مقابل الساعة المصحّحة كي يتحوّل
  /// المحرّر إلى «أرسل قالب» لحظة الإغلاق بدل انتظار ‎409 من الخادم.
  bool isOpenAt(DateTime now) {
    if (!open) return false;
    final c = closesAt;
    return c == null || c.isAfter(now);
  }

  JsonMap toJson() => {
        'open': open,
        'closesAt': closesAt?.toIso8601String(),
      };
}

class LastMessage {
  const LastMessage({required this.text, required this.role, required this.at});

  static LastMessage? fromJson(JsonMap m) {
    if (m.isEmpty) return null;
    final at = readDateOrNull(m, 'at');
    if (at == null) return null;
    return LastMessage(
      text: readString(m, 'text'),
      role: Role.fromWire(readStringOrNull(m, 'role')),
      at: at,
    );
  }

  final String text;
  final Role role;
  final DateTime at;

  JsonMap toJson() =>
      {'text': text, 'role': role.wire, 'at': at.toIso8601String()};
}

class ConversationItem {
  const ConversationItem({
    required this.id,
    required this.channel,
    required this.customerName,
    required this.externalUserId,
    required this.displayId,
    required this.status,
    required this.handoffReason,
    required this.lastMessage,
    required this.unreadCount,
    required this.window,
  });

  /// null إن غاب `id`: محادثة بلا معرّف لا يمكن فتحها ولا تحديثها.
  static ConversationItem? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    final external = readString(m, 'externalUserId');
    return ConversationItem(
      id: id,
      channel: Channel.fromWire(readStringOrNull(m, 'channel')),
      customerName: readNonEmptyOrNull(m, 'customerName'),
      externalUserId: external,
      displayId: readNonEmptyOrNull(m, 'displayId') ?? external,
      status: ConversationStatus.fromWire(readStringOrNull(m, 'status')),
      handoffReason: readNonEmptyOrNull(m, 'handoffReason'),
      lastMessage: LastMessage.fromJson(asMap(m['lastMessage'])),
      unreadCount: readInt(m, 'unreadCount').clamp(0, 1 << 30),
      window: ChatWindow.fromJson(asMap(m['window'])),
    );
  }

  final String id;
  final Channel channel;
  final String? customerName;
  final String externalUserId;
  final String displayId;
  final ConversationStatus status;
  final String? handoffReason;
  final LastMessage? lastMessage;
  final int unreadCount;
  final ChatWindow window;

  bool get isHuman => status == ConversationStatus.human;

  DateTime? get lastAt => lastMessage?.at;

  ConversationItem copyWith({
    ConversationStatus? status,
    String? handoffReason,
    bool clearHandoffReason = false,
    LastMessage? lastMessage,
    int? unreadCount,
    ChatWindow? window,
  }) =>
      ConversationItem(
        id: id,
        channel: channel,
        customerName: customerName,
        externalUserId: externalUserId,
        displayId: displayId,
        status: status ?? this.status,
        handoffReason:
            clearHandoffReason ? null : (handoffReason ?? this.handoffReason),
        lastMessage: lastMessage ?? this.lastMessage,
        unreadCount: unreadCount ?? this.unreadCount,
        window: window ?? this.window,
      );

  JsonMap toJson() => {
        'id': id,
        'channel': channel.wire,
        'customerName': customerName,
        'externalUserId': externalUserId,
        'displayId': displayId,
        'status': status.wire,
        'handoffReason': handoffReason,
        'lastMessage': lastMessage?.toJson(),
        'unreadCount': unreadCount,
        'window': window.toJson(),
      };
}

class Message {
  const Message({
    required this.id,
    required this.role,
    required this.text,
    required this.at,
    this.clientId,
  });

  static Message? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return Message(
      id: id,
      role: Role.fromWire(readStringOrNull(m, 'role')),
      text: readString(m, 'text'),
      // تاريخ مفقود: نضعه «الآن» بدل إسقاط رسالة حقيقية من المحادثة.
      at: readDateOrNull(m, 'at') ?? DateTime.now().toUtc(),
      clientId: readNonEmptyOrNull(m, 'clientId'),
    );
  }

  final String id;
  final Role role;
  final String text;
  final DateTime at;
  final String? clientId;

  JsonMap toJson() => {
        'id': id,
        'role': role.wire,
        'text': text,
        'at': at.toIso8601String(),
        'clientId': clientId,
      };
}

class MessageTemplate {
  const MessageTemplate({
    required this.name,
    required this.language,
    required this.category,
    required this.body,
    required this.variables,
  });

  static MessageTemplate? fromJson(JsonMap m) {
    final name = readNonEmptyOrNull(m, 'name');
    if (name == null) return null;
    final body = readString(m, 'body');
    final declared = readInt(m, 'variables', fallback: -1);
    return MessageTemplate(
      name: name,
      language: readString(m, 'language', fallback: 'ar'),
      category: readString(m, 'category'),
      body: body,
      // إن غاب العدد نستنتجه من أعلى {{n}} في النص: نقص متغيّر واحد يعني
      // ‎422 TEMPLATE_INVALID من Meta بعد أن ضغط المستخدم «أرسل».
      variables: declared >= 0 ? declared : highestPlaceholder(body),
    );
  }

  final String name;
  final String language;
  final String category;
  final String body;
  final int variables;

  static final _placeholder = RegExp(r'\{\{\s*(\d+)\s*\}\}');

  static int highestPlaceholder(String body) {
    var max = 0;
    for (final m in _placeholder.allMatches(body)) {
      final n = int.tryParse(m.group(1)!) ?? 0;
      if (n > max) max = n;
    }
    return max;
  }

  /// النص بعد التعبئة — للمعاينة الحيّة، ولعرض الرسالة المتفائلة قبل رد
  /// الخادم. متغيّر فارغ يبقى ظاهراً كـ{{n}} كي يرى المستخدم ما ينقص.
  String render(List<String> values) =>
      body.replaceAllMapped(_placeholder, (m) {
        final i = (int.tryParse(m.group(1)!) ?? 0) - 1;
        if (i >= 0 && i < values.length && values[i].trim().isNotEmpty) {
          return values[i].trim();
        }
        return m.group(0)!;
      });

  String get displayName => name.replaceAll('_', ' ');
}

class UserInfo {
  const UserInfo({required this.id, required this.email, required this.name});

  factory UserInfo.fromJson(JsonMap m) => UserInfo(
        id: readString(m, 'id'),
        email: readString(m, 'email'),
        name: readNonEmptyOrNull(m, 'name'),
      );

  final String id;
  final String email;
  final String? name;

  String get displayName => name ?? email;

  JsonMap toJson() => {'id': id, 'email': email, 'name': name};
}

class TenantInfo {
  const TenantInfo({
    required this.id,
    required this.slug,
    required this.name,
    required this.agentName,
  });

  factory TenantInfo.fromJson(JsonMap m) => TenantInfo(
        id: readString(m, 'id'),
        slug: readString(m, 'slug'),
        name: readString(m, 'name', fallback: 'متجري'),
        agentName: readNonEmptyOrNull(m, 'agentName'),
      );

  final String id;
  final String slug;
  final String name;
  final String? agentName;

  JsonMap toJson() =>
      {'id': id, 'slug': slug, 'name': name, 'agentName': agentName};
}

class LoginResult {
  const LoginResult({
    required this.token,
    required this.expiresAt,
    required this.user,
    required this.tenant,
  });

  factory LoginResult.fromJson(JsonMap m) => LoginResult(
        token: readString(m, 'token'),
        expiresAt: readDateOrNull(m, 'expiresAt'),
        user: UserInfo.fromJson(asMap(m['user'])),
        tenant: TenantInfo.fromJson(asMap(m['tenant'])),
      );

  final String token;
  final DateTime? expiresAt;
  final UserInfo user;
  final TenantInfo tenant;
}

class ChannelConnection {
  const ChannelConnection({required this.channel, required this.connected});

  static ChannelConnection? fromJson(JsonMap m) {
    final c = Channel.fromWire(readStringOrNull(m, 'channel'));
    if (c == Channel.unknown) return null;
    return ChannelConnection(channel: c, connected: readBool(m, 'connected'));
  }

  final Channel channel;
  final bool connected;

  JsonMap toJson() => {'channel': channel.wire, 'connected': connected};
}

class MeInfo {
  const MeInfo({
    required this.user,
    required this.tenant,
    required this.channels,
    required this.deviceId,
    required this.notify,
  });

  factory MeInfo.fromJson(JsonMap m) {
    final device = asMap(m['device']);
    return MeInfo(
      user: UserInfo.fromJson(asMap(m['user'])),
      tenant: TenantInfo.fromJson(asMap(m['tenant'])),
      channels: readList(m, 'channels', ChannelConnection.fromJson),
      deviceId: readNonEmptyOrNull(device, 'id'),
      notify: NotifyMode.fromWire(readStringOrNull(device, 'notify')),
    );
  }

  final UserInfo user;
  final TenantInfo tenant;
  final List<ChannelConnection> channels;
  final String? deviceId;
  final NotifyMode notify;

  bool isConnected(Channel c) =>
      channels.any((x) => x.channel == c && x.connected);

  JsonMap toJson() => {
        'user': user.toJson(),
        'tenant': tenant.toJson(),
        'channels': [for (final c in channels) c.toJson()],
        'device': {'id': deviceId, 'notify': notify.wire},
      };
}

class DeviceInfo {
  const DeviceInfo({
    required this.id,
    required this.name,
    required this.platform,
    required this.lastSeenAt,
    required this.createdAt,
    required this.current,
  });

  static DeviceInfo? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return DeviceInfo(
      id: id,
      name: readNonEmptyOrNull(m, 'name') ?? 'جهاز',
      platform: readString(m, 'platform'),
      lastSeenAt: readDateOrNull(m, 'lastSeenAt'),
      createdAt: readDateOrNull(m, 'createdAt'),
      current: readBool(m, 'current'),
    );
  }

  final String id;
  final String name;
  final String platform;
  final DateTime? lastSeenAt;
  final DateTime? createdAt;
  final bool current;
}

class ChannelSummary {
  const ChannelSummary({
    required this.channel,
    required this.unread,
    required this.handoff,
  });

  static ChannelSummary? fromJson(JsonMap m) {
    final c = Channel.fromWire(readStringOrNull(m, 'channel'));
    if (c == Channel.unknown) return null;
    return ChannelSummary(
      channel: c,
      unread: readInt(m, 'unread').clamp(0, 1 << 30),
      handoff: readInt(m, 'handoff').clamp(0, 1 << 30),
    );
  }

  final Channel channel;
  final int unread;
  final int handoff;

  JsonMap toJson() =>
      {'channel': channel.wire, 'unread': unread, 'handoff': handoff};
}

class InboxSummary {
  const InboxSummary({required this.channels, required this.version});

  factory InboxSummary.fromJson(JsonMap m) {
    final list = readList(m, 'channels', ChannelSummary.fromJson);
    return InboxSummary(
      channels: {for (final c in list) c.channel: c},
      version: readString(m, 'version'),
    );
  }

  static const empty = InboxSummary(channels: {}, version: '');

  final Map<Channel, ChannelSummary> channels;
  final String version;

  ChannelSummary of(Channel c) =>
      channels[c] ?? ChannelSummary(channel: c, unread: 0, handoff: 0);

  JsonMap toJson() => {
        'channels': [for (final c in channels.values) c.toJson()],
        'version': version,
      };
}

class ConversationPage {
  const ConversationPage({
    required this.pinned,
    required this.items,
    required this.nextCursor,
  });

  factory ConversationPage.fromJson(JsonMap m) => ConversationPage(
        pinned: readList(m, 'pinned', ConversationItem.fromJson),
        items: readList(m, 'items', ConversationItem.fromJson),
        nextCursor: readNonEmptyOrNull(m, 'nextCursor'),
      );

  final List<ConversationItem> pinned;
  final List<ConversationItem> items;
  final String? nextCursor;
}

class MessagePage {
  const MessagePage({required this.items, required this.hasMore});

  factory MessagePage.fromJson(JsonMap m) => MessagePage(
        items: readList(m, 'items', Message.fromJson),
        hasMore: readBool(m, 'hasMore'),
      );

  final List<Message> items;
  final bool hasMore;
}

/// رد الإرسال: الرسالة كما خُزّنت + المحادثة بعد تحوّلها (BOT ⇒ HUMAN).
class SendResult {
  const SendResult({required this.message, required this.conversation});

  factory SendResult.fromJson(JsonMap m) => SendResult(
        message: Message.fromJson(asMap(m['message'])),
        conversation: ConversationItem.fromJson(asMap(m['conversation'])),
      );

  /// قد يكون null إن جاء الرد ناقصاً — الإرسال نجح على أي حال (‎201).
  final Message? message;
  final ConversationItem? conversation;
}

class Lead {
  const Lead({
    required this.id,
    required this.name,
    required this.phone,
    required this.channel,
    required this.interest,
    required this.notes,
    required this.at,
  });

  static Lead? fromJson(JsonMap m) {
    final id = readNonEmptyOrNull(m, 'id');
    if (id == null) return null;
    return Lead(
      id: id,
      name: readNonEmptyOrNull(m, 'name'),
      phone: readNonEmptyOrNull(m, 'phone'),
      channel: Channel.fromWire(readStringOrNull(m, 'channel')),
      interest: readNonEmptyOrNull(m, 'interest'),
      notes: readNonEmptyOrNull(m, 'notes'),
      at: readDateOrNull(m, 'at'),
    );
  }

  final String id;
  final String? name;
  final String? phone;
  final Channel channel;
  final String? interest;
  final String? notes;
  final DateTime? at;
}

class LeadPage {
  const LeadPage({required this.items, required this.nextCursor});

  factory LeadPage.fromJson(JsonMap m) => LeadPage(
        items: readList(m, 'items', Lead.fromJson),
        nextCursor: readNonEmptyOrNull(m, 'nextCursor'),
      );

  final List<Lead> items;
  final String? nextCursor;
}

/// قالب مختار مع متغيّراته — جسم `template` في الإرسال وبدء المحادثة.
class TemplateSelection {
  const TemplateSelection({required this.template, required this.variables});

  final MessageTemplate template;
  final List<String> variables;

  String get renderedText => template.render(variables);

  JsonMap toJson() => {
        'name': template.name,
        'language': template.language,
        'variables': variables.map((v) => v.trim()).toList(),
      };
}
