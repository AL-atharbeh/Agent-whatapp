import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../../core/json.dart';
import '../../core/platform_bridge.dart';
import '../models.dart';
import '../outbox/outbox_entry.dart';
import '../outbox/outbox_processor.dart';

/// واجهة الذاكرة المحلية — تنفيذان: [AppDatabase] (sqflite) و
/// [InMemoryLocalStore] (اختبارات، وبديل طارئ إن تعذّر فتح القاعدة أصلاً:
/// تطبيق بلا ذاكرة دائمة أفضل من تطبيق لا يفتح).
abstract interface class LocalStore implements OutboxStore {
  Future<void> replaceChannel(Channel channel, ConversationPage page);
  Future<void> upsertConversations(Iterable<ConversationItem> items);
  Future<List<ConversationItem>> conversationsFor(Channel channel);
  Future<ConversationItem?> conversation(String id);
  Future<void> putMessages(String conversationId, Iterable<Message> msgs);
  Future<List<Message>> messagesFor(String conversationId);
  Future<String?> getValue(String key);
  Future<void> setValue(String key, String value);
  Future<JsonMap?> getJson(String key);
  Future<void> setJson(String key, JsonMap value);
  Future<void> wipeAccountData();
}

/// الذاكرة المحلية: آخر ما رأيناه من الخادم + طابور الإرسال.
///
/// sqflite لا drift: لا توليد كود ولا build_runner، والجداول بسيطة —
/// الكائن يُخزَّن JSON بشكل السلك نفسه ويُقرأ بالقارئ المتسامح نفسه، فلا
/// يوجد «مخطط ثانٍ» قد يختلف عن العقد.
///
/// هي **ذاكرة** لا مصدر حقيقة: أي تلف أو ترقية فاشلة ⇒ نحذفها ونعيد
/// التحميل من الخادم. الاستثناء الوحيد هو `outbox` (رسائل لم تصل بعد).
class AppDatabase implements LocalStore {
  AppDatabase._(this._db);

  final Database _db;

  static const _version = 1;

  /// كم رسالة نحتفظ بها لكل محادثة: تكفي لفتح فوري وقراءة بلا اتصال،
  /// دون أن تكبر القاعدة بلا حدّ على هاتف صاحب متجر نشط.
  static const maxMessagesPerConversation = 200;

  static Future<AppDatabase> open({
    String? path,
    PlatformBridge bridge = const PlatformBridge(),
  }) async {
    final dbPath = path ?? await _defaultPath(bridge);
    try {
      return AppDatabase._(await _openAt(dbPath));
    } catch (_) {
      // قاعدة تالفة: نبدأ من جديد بدل حلقة انهيار عند كل فتح.
      await deleteDatabase(dbPath);
      return AppDatabase._(await _openAt(dbPath));
    }
  }

  static Future<String> _defaultPath(PlatformBridge bridge) async {
    final dir = Directory(p.join(await getDatabasesPath(), 'hader'));
    await dir.create(recursive: true);
    // مجلد خاص بنا كي نستثنيه من iCloud دون أن نلمس بقية Documents.
    await bridge.excludeFromBackup(dir.path);
    return p.join(dir.path, 'hader.db');
  }

  static Future<Database> _openAt(String path) => openDatabase(
        path,
        version: _version,
        onConfigure: (db) async {
          // WAL: القراءة لا تنتظر الكتابة — القائمة تُرسم بينما الاستطلاع يحفظ.
          await db.rawQuery('PRAGMA journal_mode=WAL');
        },
        onCreate: (db, _) async {
          final b = db.batch();
          b.execute('''
            CREATE TABLE conversations (
              id TEXT PRIMARY KEY,
              channel TEXT NOT NULL,
              last_at INTEGER NOT NULL DEFAULT 0,
              json TEXT NOT NULL
            )''');
          b.execute('CREATE INDEX conv_channel ON conversations(channel, last_at)');
          b.execute('''
            CREATE TABLE messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              at INTEGER NOT NULL,
              json TEXT NOT NULL
            )''');
          b.execute('CREATE INDEX msg_conv ON messages(conversation_id, at)');
          b.execute('''
            CREATE TABLE outbox (
              client_id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              json TEXT NOT NULL
            )''');
          b.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
          await b.commit(noResult: true);
        },
        onUpgrade: (db, from, to) async {
          // لا ترقيات بعد. عند أول ترقية: ما عدا outbox يُحذف ويُعاد بناؤه.
        },
      );

  Future<void> close() => _db.close();

  // ───────────── المحادثات ─────────────

  /// الصفحة الأولى تستبدل ما لدينا لهذه القناة: محادثة أُغلقت أو انتقلت لا
  /// تبقى «شبحاً» في الذاكرة.
  @override
  Future<void> replaceChannel(Channel channel, ConversationPage page) =>
      _db.transaction((tx) async {
        await tx.delete('conversations', where: 'channel = ?', whereArgs: [channel.wire]);
        final b = tx.batch();
        for (final c in [...page.pinned, ...page.items]) {
          _putConversation(b, c);
        }
        await b.commit(noResult: true);
      });

  @override
  Future<void> upsertConversations(Iterable<ConversationItem> items) async {
    final b = _db.batch();
    for (final c in items) {
      _putConversation(b, c);
    }
    await b.commit(noResult: true);
  }

  void _putConversation(Batch b, ConversationItem c) => b.insert(
        'conversations',
        {
          'id': c.id,
          'channel': c.channel.wire,
          'last_at': c.lastAt?.millisecondsSinceEpoch ?? 0,
          'json': jsonEncode(c.toJson()),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  @override
  Future<List<ConversationItem>> conversationsFor(Channel channel) async {
    final rows = await _db.query(
      'conversations',
      where: 'channel = ?',
      whereArgs: [channel.wire],
      orderBy: 'last_at DESC',
    );
    return [
      for (final r in rows)
        ?_decode(r['json'], ConversationItem.fromJson),
    ];
  }

  @override
  Future<ConversationItem?> conversation(String id) async {
    final rows = await _db.query('conversations', where: 'id = ?', whereArgs: [id], limit: 1);
    if (rows.isEmpty) return null;
    return _decode(rows.first['json'], ConversationItem.fromJson);
  }

  // ───────────── الرسائل ─────────────

  @override
  Future<void> putMessages(String conversationId, Iterable<Message> msgs) async {
    final b = _db.batch();
    for (final m in msgs) {
      b.insert(
        'messages',
        {
          'id': m.id,
          'conversation_id': conversationId,
          'at': m.at.millisecondsSinceEpoch,
          'json': jsonEncode(m.toJson()),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    // تقليم الأقدم بعد الحد.
    b.rawDelete('''
      DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (
        SELECT id FROM messages WHERE conversation_id = ?
        ORDER BY at DESC LIMIT $maxMessagesPerConversation
      )''', [conversationId, conversationId]);
    await b.commit(noResult: true);
  }

  /// من الأقدم للأحدث، كما يعيدها الخادم.
  @override
  Future<List<Message>> messagesFor(String conversationId) async {
    final rows = await _db.query(
      'messages',
      where: 'conversation_id = ?',
      whereArgs: [conversationId],
      orderBy: 'at ASC',
    );
    return [
      for (final r in rows)
        ?_decode(r['json'], Message.fromJson),
    ];
  }

  // ───────────── الطابور (OutboxStore) ─────────────

  @override
  Future<List<OutboxEntry>> loadAll() async {
    final rows = await _db.query('outbox', orderBy: 'created_at ASC');
    return [
      for (final r in rows)
        ?_decode(r['json'], OutboxEntry.fromJson),
    ];
  }

  @override
  Future<void> put(OutboxEntry entry) => _db.insert(
        'outbox',
        {
          'client_id': entry.clientId,
          'conversation_id': entry.conversationId,
          'created_at': entry.createdAt.millisecondsSinceEpoch,
          'json': jsonEncode(entry.toJson()),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  @override
  Future<void> remove(String clientId) =>
      _db.delete('outbox', where: 'client_id = ?', whereArgs: [clientId]);

  // ───────────── مفتاح/قيمة ─────────────

  @override
  Future<String?> getValue(String key) async {
    final rows = await _db.query('kv', where: 'key = ?', whereArgs: [key], limit: 1);
    final v = rows.isEmpty ? null : rows.first['value'];
    return v is String ? v : null;
  }

  @override
  Future<void> setValue(String key, String value) => _db.insert(
        'kv',
        {'key': key, 'value': value},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  @override
  Future<JsonMap?> getJson(String key) async {
    final s = await getValue(key);
    if (s == null) return null;
    try {
      return asMap(jsonDecode(s));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> setJson(String key, JsonMap value) => setValue(key, jsonEncode(value));

  /// عند الخروج أو تبدّل الحساب: محادثات متجر لا تبقى على هاتف خرج منه.
  /// مفتاح `install` يبقى — هو علامة أن التثبيت نفسه لم يتغيّر.
  @override
  Future<void> wipeAccountData() => _db.transaction((tx) async {
        await tx.delete('conversations');
        await tx.delete('messages');
        await tx.delete('outbox');
        await tx.delete('kv', where: 'key != ?', whereArgs: [installMarkerKey]);
      });

  static const installMarkerKey = 'install';

  static T? _decode<T>(Object? raw, T? Function(JsonMap) parse) {
    if (raw is! String) return null;
    try {
      return parse(asMap(jsonDecode(raw)));
    } catch (_) {
      return null;
    }
  }
}
