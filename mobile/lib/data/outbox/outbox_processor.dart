import 'dart:async';

import 'package:uuid/uuid.dart';

import '../../core/errors.dart';
import '../models.dart';
import 'outbox_entry.dart';

/// تخزين الطابور. التنفيذ الحقيقي في sqflite، وفي الاختبارات في الذاكرة.
abstract interface class OutboxStore {
  Future<List<OutboxEntry>> loadAll();
  Future<void> put(OutboxEntry entry);
  Future<void> remove(String clientId);
}

class InMemoryOutboxStore implements OutboxStore {
  final Map<String, OutboxEntry> data = {};

  @override
  Future<List<OutboxEntry>> loadAll() async => data.values.toList();

  @override
  Future<void> put(OutboxEntry entry) async => data[entry.clientId] = entry;

  @override
  Future<void> remove(String clientId) async => data.remove(clientId);
}

typedef OutboxSender = Future<SendResult> Function(OutboxEntry entry);
typedef OutboxSentCallback = Future<void> Function(
  OutboxEntry entry,
  SendResult result,
);

/// ما يُفعل بالرسالة بعد خطأ — مفصول ونقيّ كي يُختبر جدول القرار وحده.
///
/// الجدول من العقد («ما يفعله الجهاز»):
/// | الخطأ                              | الحالة      | إعادة تلقائية؟ |
/// |------------------------------------|-------------|----------------|
/// | شبكة/مهلة/بوابة بلا رمز/‎429        | queued      | نعم، نفس clientId |
/// | IN_PROGRESS                        | inProgress  | لا — ننتظر ظهورها |
/// | DELIVERY_UNKNOWN، INTERNAL         | uncertain   | **أبداً**      |
/// | SEND_FAILED وبقية الرفض الصريح     | failed      | لا — يدوياً بنفس clientId |
OutboxState stateAfterError(ApiError e) {
  if (e.isTransient) return OutboxState.queued;
  return switch (e.code) {
    ApiErrorCode.inProgress => OutboxState.inProgress,
    // ‎500 على إرسال: لا نعرف إن وصل الطلب لـMeta قبل الانهيار. نعامله
    // كـDELIVERY_UNKNOWN — التكرار الصامت أسوأ من سؤال المستخدم.
    ApiErrorCode.deliveryUnknown || ApiErrorCode.internal => OutboxState.uncertain,
    _ => OutboxState.failed,
  };
}

/// طابور الإرسال المتفائل.
///
/// ضمانات، كلٌّ منها يمنع عطلاً محدداً:
/// - **لا إرسال مزدوج محلياً:** تفريغ واحد في كل لحظة ([flush] يعيد نفس
///   الـFuture إن كان يعمل)، ومجموعة `_inFlight` تمنع أخذ نفس الرسالة
///   مرتين حتى لو استُدعي التفريغ من الاستطلاع والاتصال في نفس اللحظة.
/// - **لا إرسال مزدوج عبر الشبكة:** نفس clientId في كل إعادة تلقائية؛ الخادم
///   يحجزه قبل Meta. والحالات التي قد تكون وصلت فيها الرسالة (uncertain) لا
///   تُعاد آلياً أبداً.
/// - **لا إعادة استخدام لمعرّف:** «أرسل مرة أخرى» يولّد معرّفاً جديداً، ولا
///   يُعطى معرّف رسالة لرسالة أخرى (الخادم يردّ ‎400 على ذلك).
/// - **الترتيب محفوظ:** داخل المحادثة الواحدة بالترتيب، وفشل مؤقت يوقف ما
///   بعده في نفس المحادثة — وإلا وصلت «وهذا السعر» قبل «مرحباً».
/// - **لا ضياع:** كل حالة تُكتب للتخزين قبل الانتقال، فقتل التطبيق في أي
///   لحظة يترك الرسالة إمّا في الطابور وإمّا مؤكّدة.
class OutboxProcessor {
  OutboxProcessor({
    required this.store,
    required this.sender,
    required this.onSent,
    this.onChanged,
    this.onError,
    this.inProgressTimeout = const Duration(minutes: 2),
    Uuid? uuid,
    DateTime Function()? now,
  })  : _uuid = uuid ?? const Uuid(),
        _now = now ?? (() => DateTime.now().toUtc());

  final OutboxStore store;
  final OutboxSender sender;
  final OutboxSentCallback onSent;

  /// يُستدعى بعد كل تغيير في الطابور (لتحديث الواجهة).
  final void Function(List<OutboxEntry> entries)? onChanged;

  /// كل خطأ من الخادم — مثلاً لرفع لافتة «المتجر غير نشط».
  final void Function(ApiError error)? onError;

  /// IN_PROGRESS لا يُعاد إرساله؛ إن لم تظهر الرسالة خلال هذه المدة نصارح
  /// المستخدم بأننا لا نعرف مصيرها بدل ساعة تدور إلى الأبد.
  final Duration inProgressTimeout;

  final Uuid _uuid;
  final DateTime Function() _now;

  final Map<String, OutboxEntry> _entries = {};
  final Set<String> _inFlight = {};
  Future<void>? _running;
  bool _rerun = false;
  bool _loaded = false;

  List<OutboxEntry> get entries {
    final list = _entries.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return List.unmodifiable(list);
  }

  bool get hasQueued => _entries.values.any((e) => e.state == OutboxState.queued);

  bool get hasInProgress => _entries.values.any((e) => e.state == OutboxState.inProgress);

  bool isInFlight(String clientId) => _inFlight.contains(clientId);

  /// يحمّل الطابور المحفوظ. `sending` من تشغيل سابق قُتل في منتصفه يعود
  /// `queued` — آمن: الخادم حجز المعرّف، فالإعادة ترجع 201 أو IN_PROGRESS أو
  /// DELIVERY_UNKNOWN، ولا تصل Meta مرتين.
  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    for (final e in await store.loadAll()) {
      final fixed = e.state == OutboxState.sending ? e.copyWith(state: OutboxState.queued) : e;
      _entries[fixed.clientId] = fixed;
      if (!identical(fixed, e)) await store.put(fixed);
    }
    _notify();
  }

  Future<OutboxEntry> enqueueText(String conversationId, String text) => _enqueue(OutboxEntry(
        clientId: _uuid.v4(),
        conversationId: conversationId,
        kind: OutboxKind.text,
        text: text.trim(),
        createdAt: _now(),
      ));

  Future<OutboxEntry> enqueueTemplate(String conversationId, TemplateSelection t) => _enqueue(OutboxEntry(
        clientId: _uuid.v4(),
        conversationId: conversationId,
        kind: OutboxKind.template,
        text: t.renderedText,
        createdAt: _now(),
        templateName: t.template.name,
        templateLanguage: t.template.language,
        variables: t.variables.map((v) => v.trim()).toList(),
      ));

  Future<OutboxEntry> _enqueue(OutboxEntry e) async {
    // التخزين أولاً: إن مات التطبيق بعد هذا السطر فالرسالة محفوظة.
    await store.put(e);
    _entries[e.clientId] = e;
    _notify();
    return e;
  }

  /// يرسل كل ما في الطابور (queued فقط). متزامنان يشتركان في نفس التفريغ.
  Future<void> flush() {
    final running = _running;
    if (running != null) {
      _rerun = true;
      return running;
    }
    final f = _drain().whenComplete(() => _running = null);
    _running = f;
    return f;
  }

  Future<void> _drain() async {
    await _expireStaleInProgress();
    do {
      _rerun = false;
      final blocked = <String>{};
      final queued = entries.where((e) => e.state == OutboxState.queued).toList();
      for (final e in queued) {
        if (blocked.contains(e.conversationId)) continue;
        if (_inFlight.contains(e.clientId)) continue;
        // ربما حُذفت أو تغيّرت أثناء انتظار ما قبلها.
        final current = _entries[e.clientId];
        if (current == null || current.state != OutboxState.queued) continue;
        final ok = await _sendOne(current);
        if (!ok) blocked.add(e.conversationId);
      }
    } while (_rerun);
  }

  /// true = انتهت (نجاحاً أو بحالة تنتظر المستخدم)؛ false = فشل مؤقت، أوقف المحادثة.
  Future<bool> _sendOne(OutboxEntry e) async {
    _inFlight.add(e.clientId);
    final sending = e.copyWith(
      state: OutboxState.sending,
      attempts: e.attempts + 1,
      lastAttemptAt: _now(),
    );
    await _update(sending);
    try {
      final result = await sender(sending);
      try {
        await onSent(sending, result);
      } catch (_) {
        // فشل حفظ النتيجة محلياً لا يعني فشل الإرسال؛ الاستطلاع سيجلبها.
      }
      _entries.remove(e.clientId);
      await store.remove(e.clientId);
      _notify();
      return true;
    } on ApiError catch (err) {
      onError?.call(err);
      final next = stateAfterError(err);
      await _update(sending.copyWith(
        state: next,
        errorCode: err.code.wire,
        errorMessage: err.message,
      ));
      return next != OutboxState.queued;
    } catch (_) {
      // استثناء غير متوقّع بعد أن خرج الطلب: لا نعرف إن وصل. أمانُ المستخدم
      // من رد مكرّر أهم — «غير مؤكّد»، لا إعادة تلقائية.
      await _update(sending.copyWith(
        state: OutboxState.uncertain,
        errorCode: ApiErrorCode.unknown.wire,
        errorMessage: ApiError.defaultMessage(ApiErrorCode.deliveryUnknown),
      ));
      return true;
    } finally {
      _inFlight.remove(e.clientId);
    }
  }

  Future<void> _expireStaleInProgress() async {
    final now = _now();
    for (final e in entries.where((e) => e.state == OutboxState.inProgress)) {
      final since = e.lastAttemptAt ?? e.createdAt;
      if (now.difference(since) >= inProgressTimeout) {
        await _update(e.copyWith(
          state: OutboxState.uncertain,
          errorCode: ApiErrorCode.deliveryUnknown.wire,
          errorMessage: ApiError.defaultMessage(ApiErrorCode.deliveryUnknown),
        ));
      }
    }
  }

  Future<void> _update(OutboxEntry e) async {
    // لا نعيد إحياء رسالة حذفها المستخدم أثناء الإرسال.
    if (!_entries.containsKey(e.clientId)) return;
    _entries[e.clientId] = e;
    await store.put(e);
    _notify();
  }

  /// إعادة محاولة يدوية لرفض صريح (failed) — **بنفس clientId**، فهي آمنة.
  ///
  /// مرفوضة لـuncertain: نفس المعرّف سيعيد DELIVERY_UNKNOWN فقط، والإرسال
  /// الفعلي هناك قرار مختلف تماماً ([sendAgain]).
  Future<bool> retry(String clientId) async {
    final e = _entries[clientId];
    if (e == null || _inFlight.contains(clientId) || e.state != OutboxState.failed) return false;
    await _update(e.copyWith(state: OutboxState.queued, clearError: true));
    await flush();
    return true;
  }

  /// «أرسل مرة أخرى» لرسالة غير مؤكّدة: معرّف **جديد** عن قصد — قد يصل
  /// العميلَ ردّان، والمستخدم هو من قبِل ذلك. القديمة تُحذف من الطابور.
  Future<OutboxEntry?> sendAgain(String clientId) async {
    final e = _entries[clientId];
    if (e == null || _inFlight.contains(clientId) || e.state != OutboxState.uncertain) return null;
    final fresh = e.resendAs(_uuid.v4(), _now());
    _entries.remove(clientId);
    await store.remove(clientId);
    await _enqueue(fresh);
    await flush();
    return fresh;
  }

  /// حذف رسالة لم تُرسل. ممنوع أثناء الإرسال: قد تكون وصلت فعلاً.
  Future<bool> discard(String clientId) async {
    if (_inFlight.contains(clientId)) return false;
    if (_entries.remove(clientId) == null) return false;
    await store.remove(clientId);
    _notify();
    return true;
  }

  /// الخادم أعاد رسائل تحمل هذه المعرّفات ⇒ وصلت فعلاً (ربما ضاع الرد، أو
  /// اكتمل IN_PROGRESS). نحذفها من الطابور بدل عرضها مكرّرة أو إرسالها.
  Future<void> reconcile(Iterable<String> serverClientIds) async {
    var changed = false;
    for (final id in serverClientIds) {
      if (_inFlight.contains(id)) continue;
      if (_entries.remove(id) == null) continue;
      await store.remove(id);
      changed = true;
    }
    if (changed) _notify();
  }

  /// عند الخروج: الطابور يخص حساباً، ولا يُرسل باسم مستخدم آخر.
  Future<void> clear() async {
    for (final id in _entries.keys.toList()) {
      await store.remove(id);
    }
    _entries.clear();
    _notify();
  }

  void _notify() => onChanged?.call(entries);
}
