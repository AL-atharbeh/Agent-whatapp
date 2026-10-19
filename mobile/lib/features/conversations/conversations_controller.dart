import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';

class ConversationsState {
  const ConversationsState({
    this.pinned = const [],
    this.items = const [],
    this.nextCursor,
    this.loading = true,
    this.loadingMore = false,
    this.error,
    this.fromCache = false,
  });

  /// محادثات HUMAN — تنتظر المالك، فوق الكل.
  final List<ConversationItem> pinned;
  final List<ConversationItem> items;
  final String? nextCursor;

  /// لا شيء لنعرضه بعد (لا ذاكرة ولا رد). مع وجود ذاكرة يبقى false
  /// والتحديث يجري بصمت تحتها.
  final bool loading;
  final bool loadingMore;
  final ApiError? error;

  /// المعروض من الذاكرة المحلية ولم يؤكّده الخادم بعد.
  final bool fromCache;

  bool get isEmpty => pinned.isEmpty && items.isEmpty;

  ConversationsState copyWith({
    List<ConversationItem>? pinned,
    List<ConversationItem>? items,
    String? nextCursor,
    bool clearCursor = false,
    bool? loading,
    bool? loadingMore,
    ApiError? error,
    bool clearError = false,
    bool? fromCache,
  }) =>
      ConversationsState(
        pinned: pinned ?? this.pinned,
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        error: clearError ? null : (error ?? this.error),
        fromCache: fromCache ?? this.fromCache,
      );
}

final conversationsProvider =
    NotifierProvider.family<ConversationsController, ConversationsState, Channel>(
  ConversationsController.new,
);

/// قائمة قناة واحدة: ذاكرة فورية ثم الخادم، وتحديث عند كل نبضة.
class ConversationsController extends Notifier<ConversationsState> {
  ConversationsController(this.channel);

  final Channel channel;
  Future<void>? _refreshing;

  @override
  ConversationsState build() {
    final account = ref.watch(accountKeyProvider);
    if (account == null) return const ConversationsState(loading: false);
    ref.listen(inboxPulseProvider, (_, _) => unawaited(refresh()));
    ref.listen(conversationPatchProvider, (_, c) {
      if (c != null) _apply(c);
    });
    unawaited(_init());
    return const ConversationsState();
  }

  Future<void> _init() async {
    try {
      final cached = await ref.read(databaseProvider).conversationsFor(channel);
      if (!ref.mounted) return;
      if (cached.isNotEmpty && state.fromCache == false && state.isEmpty) {
        state = state.copyWith(
          pinned: cached.where((c) => c.isHuman).toList(),
          items: cached.where((c) => !c.isHuman).toList(),
          loading: false,
          fromCache: true,
        );
      }
    } catch (_) {
      // ذاكرة غير مقروءة: نكمل من الخادم.
    }
    await refresh();
  }

  Future<void> refresh() => _refreshing ??= _fetchFirst().whenComplete(() => _refreshing = null);

  Future<void> _fetchFirst() async {
    try {
      final page = await ref.read(apiProvider).conversations(channel);
      if (!ref.mounted) return;
      state = ConversationsState(
        pinned: page.pinned,
        items: page.items,
        nextCursor: page.nextCursor,
        loading: false,
      );
      unawaited(ref.read(databaseProvider).replaceChannel(channel, page));
    } on ApiError catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(loading: false, error: e);
    }
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.loadingMore) return;
    state = state.copyWith(loadingMore: true);
    try {
      final page = await ref.read(apiProvider).conversations(channel, cursor: cursor);
      if (!ref.mounted) return;
      final seen = {...state.pinned.map((c) => c.id), ...state.items.map((c) => c.id)};
      state = state.copyWith(
        items: [...state.items, ...page.items.where((c) => !seen.contains(c.id))],
        nextCursor: page.nextCursor,
        clearCursor: page.nextCursor == null,
        loadingMore: false,
      );
      unawaited(ref.read(databaseProvider).upsertConversations(page.items));
    } on ApiError catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(loadingMore: false, error: e);
    }
  }

  /// تحديث صف واحد محلياً: يُنقل بين «المثبّتة» والباقي حسب حالته الجديدة.
  void _apply(ConversationItem c) {
    if (c.channel != channel) return;
    int byRecent(ConversationItem a, ConversationItem b) =>
        (b.lastAt ?? DateTime(0)).compareTo(a.lastAt ?? DateTime(0));
    final pinned = state.pinned.where((x) => x.id != c.id).toList();
    final items = state.items.where((x) => x.id != c.id).toList();
    if (c.isHuman) {
      pinned
        ..add(c)
        ..sort(byRecent);
    } else {
      items
        ..add(c)
        ..sort(byRecent);
    }
    state = state.copyWith(pinned: pinned, items: items);
  }
}
