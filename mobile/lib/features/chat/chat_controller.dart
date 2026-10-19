import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../../data/outbox/outbox_entry.dart';
import '../conversations/inbox_controller.dart';
import 'outbox_controller.dart';

class ChatState {
  const ChatState({
    this.conversation,
    this.messages = const [],
    this.hasMore = false,
    this.loading = true,
    this.loadingOlder = false,
    this.busy = false,
    this.error,
  });

  final ConversationItem? conversation;

  /// رسائل الخادم من الأقدم للأحدث.
  final List<Message> messages;
  final bool hasMore;
  final bool loading;
  final bool loadingOlder;

  /// استلام/إعادة للوكيل قيد التنفيذ — يعطّل الزر كي لا يُضغط مرتين.
  final bool busy;
  final ApiError? error;

  ChatState copyWith({
    ConversationItem? conversation,
    List<Message>? messages,
    bool? hasMore,
    bool? loading,
    bool? loadingOlder,
    bool? busy,
    ApiError? error,
    bool clearError = false,
  }) =>
      ChatState(
        conversation: conversation ?? this.conversation,
        messages: messages ?? this.messages,
        hasMore: hasMore ?? this.hasMore,
        loading: loading ?? this.loading,
        loadingOlder: loadingOlder ?? this.loadingOlder,
        busy: busy ?? this.busy,
        error: clearError ? null : (error ?? this.error),
      );
}

final chatProvider =
    NotifierProvider.autoDispose.family<ChatController, ChatState, String>(ChatController.new);

class ChatController extends Notifier<ChatState> {
  ChatController(this.conversationId);

  final String conversationId;
  Future<void>? _refreshing;

  @override
  ChatState build() {
    final account = ref.watch(accountKeyProvider);
    if (account == null) return const ChatState(loading: false);
    ref.listen(inboxPulseProvider, (_, _) => unawaited(refresh()));
    ref.listen(conversationPatchProvider, (_, c) {
      if (c != null && c.id == conversationId && ref.mounted) {
        state = state.copyWith(conversation: c);
      }
    });
    // رسالة خرجت من الطابور (أُرسلت) ⇒ صارت في القاعدة؛ نعيد القراءة منها
    // كي تحلّ الرسالة المؤكّدة محلّ المتفائلة دون وميض أو تكرار.
    ref.listen<List<OutboxEntry>>(outboxProvider, (prev, next) {
      final before = prev?.where((e) => e.conversationId == conversationId).map((e) => e.clientId).toSet() ?? {};
      final now = next.where((e) => e.conversationId == conversationId).map((e) => e.clientId).toSet();
      if (before.difference(now).isNotEmpty) unawaited(_reloadCachedMessages());
    });
    unawaited(_init());
    return const ChatState();
  }

  Future<void> _init() async {
    final db = ref.read(databaseProvider);
    try {
      final conv = await db.conversation(conversationId);
      final msgs = await db.messagesFor(conversationId);
      if (!ref.mounted) return;
      if (conv != null || msgs.isNotEmpty) {
        state = state.copyWith(
          conversation: conv,
          messages: msgs,
          hasMore: true,
          loading: false,
        );
      }
    } catch (_) {}
    // refresh يسجّل القراءة إن وُجد غير مقروء — لا نداء ثانٍ هنا.
    await refresh();
  }

  Future<void> _reloadCachedMessages() async {
    final msgs = await ref.read(databaseProvider).messagesFor(conversationId);
    if (!ref.mounted) return;
    state = state.copyWith(messages: _merge(state.messages, msgs));
  }

  Future<void> refresh() => _refreshing ??= _fetchLatest().whenComplete(() => _refreshing = null);

  Future<void> _fetchLatest() async {
    final api = ref.read(apiProvider);
    final db = ref.read(databaseProvider);
    try {
      final results = await Future.wait([
        api.conversation(conversationId),
        api.messages(conversationId),
      ]);
      if (!ref.mounted) return;
      final conv = results[0] as ConversationItem;
      final page = results[1] as MessagePage;
      final hadMessages = state.messages.isNotEmpty;
      final merged = _merge(state.messages, page.items);
      state = state.copyWith(
        conversation: conv,
        messages: merged,
        // مع ذاكرة أطول من الصفحة، «المزيد» يقرّره أقدم ما لدينا لا الصفحة.
        hasMore: hadMessages ? state.hasMore && page.hasMore : page.hasMore,
        loading: false,
        clearError: true,
      );
      await db.putMessages(conversationId, page.items);
      await db.upsertConversations([conv]);
      ref.read(conversationPatchProvider.notifier).publish(conv);
      // رسائل وصلت للخادم وضاع ردّها: تخرج من الطابور بدل أن تُعرض مكرّرة.
      await ref.read(outboxProvider.notifier).reconcile(
            page.items.map((m) => m.clientId).whereType<String>(),
          );
      if (conv.unreadCount > 0) unawaited(markRead());
    } on ApiError catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(loading: false, error: e);
    }
  }

  /// يدمج بالمعرّف ويرتّب بالزمن — يحتمل تداخل الصفحات وتكرار الاستطلاع.
  static List<Message> _merge(List<Message> a, List<Message> b) {
    final byId = <String, Message>{for (final m in a) m.id: m, for (final m in b) m.id: m};
    return byId.values.toList()..sort((x, y) => x.at.compareTo(y.at));
  }

  Future<void> loadOlder() async {
    if (state.loadingOlder || !state.hasMore || state.messages.isEmpty) return;
    state = state.copyWith(loadingOlder: true);
    try {
      final page = await ref.read(apiProvider).messages(conversationId, before: state.messages.first.id);
      if (!ref.mounted) return;
      state = state.copyWith(
        messages: _merge(page.items, state.messages),
        hasMore: page.hasMore,
        loadingOlder: false,
      );
      unawaited(ref.read(databaseProvider).putMessages(conversationId, page.items));
    } on ApiError catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(loadingOlder: false, error: e);
    }
  }

  Future<void> markRead() async {
    final c = state.conversation;
    try {
      await ref.read(apiProvider).markRead(conversationId);
    } on ApiError {
      return; // القراءة ستُسجَّل عند الفتح القادم.
    }
    if (!ref.mounted || c == null) return;
    final hadUnread = c.unreadCount > 0;
    final read = c.copyWith(unreadCount: 0);
    state = state.copyWith(conversation: read);
    ref.read(conversationPatchProvider.notifier).publish(read);
    ref.read(inboxProvider.notifier).applyRead(c.channel, hadUnread: hadUnread);
    unawaited(ref.read(databaseProvider).upsertConversations([read]));
  }

  Future<ApiError?> takeover() => _statusChange(true);

  Future<ApiError?> release() => _statusChange(false);

  Future<ApiError?> _statusChange(bool takeover) async {
    if (state.busy) return null;
    state = state.copyWith(busy: true);
    try {
      final api = ref.read(apiProvider);
      final c = takeover ? await api.takeover(conversationId) : await api.release(conversationId);
      if (!ref.mounted) return null;
      state = state.copyWith(conversation: c, busy: false);
      ref.read(conversationPatchProvider.notifier).publish(c);
      unawaited(ref.read(databaseProvider).upsertConversations([c]));
      unawaited(ref.read(inboxProvider.notifier).refresh());
      return null;
    } on ApiError catch (e) {
      if (ref.mounted) state = state.copyWith(busy: false);
      return e;
    }
  }

  Future<void> sendText(String text) => ref.read(outboxProvider.notifier).sendText(conversationId, text);

  Future<void> sendTemplate(TemplateSelection t) =>
      ref.read(outboxProvider.notifier).sendTemplate(conversationId, t);
}
