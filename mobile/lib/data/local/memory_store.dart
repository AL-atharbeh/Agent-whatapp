import 'dart:convert';

import '../../core/json.dart';
import '../models.dart';
import '../outbox/outbox_entry.dart';
import 'app_database.dart';

/// ذاكرة في RAM بنفس سلوك [AppDatabase].
///
/// تُستخدم في الاختبارات، وكبديل طارئ إن فشل فتح sqflite حتى بعد حذفها
/// (قرص ممتلئ مثلاً): يعمل التطبيق متصلاً، ويفقد فقط الفتح الفوري بلا اتصال.
class InMemoryLocalStore implements LocalStore {
  final Map<String, ConversationItem> _convs = {};
  final Map<String, Map<String, Message>> _msgs = {};
  final Map<String, OutboxEntry> _outbox = {};
  final Map<String, String> _kv = {};

  @override
  Future<void> replaceChannel(Channel channel, ConversationPage page) async {
    _convs.removeWhere((_, c) => c.channel == channel);
    for (final c in [...page.pinned, ...page.items]) {
      _convs[c.id] = c;
    }
  }

  @override
  Future<void> upsertConversations(Iterable<ConversationItem> items) async {
    for (final c in items) {
      _convs[c.id] = c;
    }
  }

  @override
  Future<List<ConversationItem>> conversationsFor(Channel channel) async =>
      _convs.values.where((c) => c.channel == channel).toList()
        ..sort((a, b) => (b.lastAt ?? DateTime(0)).compareTo(a.lastAt ?? DateTime(0)));

  @override
  Future<ConversationItem?> conversation(String id) async => _convs[id];

  @override
  Future<void> putMessages(String conversationId, Iterable<Message> msgs) async {
    final m = _msgs.putIfAbsent(conversationId, () => {});
    for (final x in msgs) {
      m[x.id] = x;
    }
    if (m.length > AppDatabase.maxMessagesPerConversation) {
      final sorted = m.values.toList()..sort((a, b) => a.at.compareTo(b.at));
      for (final old in sorted.take(m.length - AppDatabase.maxMessagesPerConversation)) {
        m.remove(old.id);
      }
    }
  }

  @override
  Future<List<Message>> messagesFor(String conversationId) async =>
      (_msgs[conversationId]?.values.toList() ?? <Message>[])..sort((a, b) => a.at.compareTo(b.at));

  @override
  Future<List<OutboxEntry>> loadAll() async => _outbox.values.toList();

  @override
  Future<void> put(OutboxEntry entry) async => _outbox[entry.clientId] = entry;

  @override
  Future<void> remove(String clientId) async => _outbox.remove(clientId);

  @override
  Future<String?> getValue(String key) async => _kv[key];

  @override
  Future<void> setValue(String key, String value) async => _kv[key] = value;

  @override
  Future<JsonMap?> getJson(String key) async {
    final s = _kv[key];
    if (s == null) return null;
    try {
      return asMap(jsonDecode(s));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> setJson(String key, JsonMap value) async => _kv[key] = jsonEncode(value);

  @override
  Future<void> wipeAccountData() async {
    _convs.clear();
    _msgs.clear();
    _outbox.clear();
    _kv.removeWhere((k, _) => k != AppDatabase.installMarkerKey);
  }
}
