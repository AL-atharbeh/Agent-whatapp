import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../../data/outbox/outbox_entry.dart';
import '../../data/outbox/outbox_processor.dart';

final outboxProvider = NotifierProvider<OutboxController, List<OutboxEntry>>(OutboxController.new);

/// غلاف Riverpod حول [OutboxProcessor] — المنطق كله هناك ومختبَر وحده.
class OutboxController extends Notifier<List<OutboxEntry>> {
  OutboxProcessor? _processor;

  /// يرتفع مع كل بناء (تبدّل حساب). معالج قديم ما زال يُكمل إرسالاً لا
  /// يكتب حالته فوق طابور الحساب الجديد.
  int _generation = 0;

  @override
  List<OutboxEntry> build() {
    final account = ref.watch(accountKeyProvider);
    final gen = ++_generation;
    _processor = null;
    if (account == null) return const [];

    final db = ref.read(databaseProvider);
    final api = ref.read(apiProvider);
    final p = OutboxProcessor(
      store: db,
      sender: (e) {
        final t = e.templateSelection;
        return t != null
            ? api.sendTemplate(e.conversationId, template: t, clientId: e.clientId)
            : api.sendText(e.conversationId, text: e.text, clientId: e.clientId);
      },
      onSent: (e, r) async {
        if (gen != _generation) return;
        final m = r.message;
        if (m != null) await db.putMessages(e.conversationId, [m]);
        final c = r.conversation;
        if (c != null) {
          await db.upsertConversations([c]);
          ref.read(conversationPatchProvider.notifier).publish(c);
        }
      },
      onChanged: (list) {
        if (ref.mounted && gen == _generation) state = list;
      },
      onError: (err) {
        if (gen == _generation && err.code == ApiErrorCode.tenantInactive) {
          ref.read(tenantInactiveProvider.notifier).mark();
        }
      },
    );
    _processor = p;
    unawaited(Future(() async {
      await p.load();
      await p.flush();
    }));
    return const [];
  }

  List<OutboxEntry> forConversation(String id) =>
      state.where((e) => e.conversationId == id).toList();

  Future<void> sendText(String conversationId, String text) async {
    final p = _processor;
    if (p == null || text.trim().isEmpty) return;
    await p.enqueueText(conversationId, text);
    unawaited(p.flush());
  }

  Future<void> sendTemplate(String conversationId, TemplateSelection t) async {
    final p = _processor;
    if (p == null) return;
    await p.enqueueTemplate(conversationId, t);
    unawaited(p.flush());
  }

  /// رفض صريح ⇒ نفس clientId.
  Future<void> retry(String clientId) async => _processor?.retry(clientId);

  /// غير مؤكّد ⇒ clientId جديد بقرار المستخدم.
  Future<void> sendAgain(String clientId) async => _processor?.sendAgain(clientId);

  /// بعد زوال «المتجر غير نشط»: الرسائل المرفوضة بسببه تعود للطابور.
  Future<void> retryTenantBlocked() async {
    for (final e in state.where((e) => e.errorCode == ApiErrorCode.tenantInactive.wire && e.state == OutboxState.failed)) {
      await _processor?.retry(e.clientId);
    }
  }

  Future<bool> discard(String clientId) async => await _processor?.discard(clientId) ?? false;

  /// يُستدعى عند عودة الاتصال، عند العودة للمقدّمة، وبعد كل استطلاع ناجح.
  Future<void> flush() async {
    final p = _processor;
    if (p != null && (p.hasQueued || p.hasInProgress)) await p.flush();
  }

  Future<void> reconcile(Iterable<String> clientIds) async =>
      _processor?.reconcile(clientIds);

  bool isInFlight(String clientId) => _processor?.isInFlight(clientId) ?? false;
}
