import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/errors.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/models.dart';
import 'package:hader/data/outbox/outbox_entry.dart';
import 'package:hader/data/outbox/outbox_processor.dart';

/// مُرسِل مُبرمج: يعيد لكل نداء النتيجة التالية من القائمة، ويسجّل clientId.
class ScriptedSender {
  ScriptedSender(this.script);

  final List<Object> script; // SendResult أو ApiError أو Completer
  final List<String> calls = [];

  Future<SendResult> call(OutboxEntry e) async {
    calls.add(e.clientId);
    final next = script.isEmpty ? ok(e) : script.removeAt(0);
    if (next is Completer<SendResult>) return next.future;
    if (next is ApiError) throw next;
    if (next is SendResult) return next;
    if (next is Function) return ok(e);
    throw StateError('bad script');
  }

  static SendResult ok(OutboxEntry e) => SendResult(
        message: Message(id: 'srv_${e.clientId}', role: Role.human, text: e.text, at: DateTime.utc(2026), clientId: e.clientId),
        conversation: null,
      );
}

ApiError err(ApiErrorCode c) => ApiError(c, ApiError.defaultMessage(c));

void main() {
  late InMemoryOutboxStore store;
  late List<SendResult> sent;

  OutboxProcessor make(ScriptedSender s, {DateTime Function()? now, List<ApiError>? errors}) => OutboxProcessor(
        store: store,
        sender: s.call,
        onSent: (e, r) async => sent.add(r),
        onError: errors?.add,
        now: now,
      );

  setUp(() {
    store = InMemoryOutboxStore();
    sent = [];
  });

  test('نجاح: تُرسل مرة واحدة وتخرج من الطابور والتخزين', () async {
    final s = ScriptedSender([]);
    final p = make(s);
    final e = await p.enqueueText('c1', '  مرحبا  ');
    expect(e.text, 'مرحبا');
    expect(store.data.containsKey(e.clientId), isTrue, reason: 'يُخزَّن قبل أي إرسال');
    await p.flush();
    expect(s.calls, [e.clientId]);
    expect(p.entries, isEmpty);
    expect(store.data, isEmpty);
    expect(sent.single.message!.clientId, e.clientId);
  });

  test('كل رسالة بمعرّف مختلف — لا إعادة استخدام بين الرسائل', () async {
    final p = make(ScriptedSender([]));
    final a = await p.enqueueText('c1', 'أ');
    final b = await p.enqueueText('c1', 'أ');
    expect(a.clientId, isNot(b.clientId));
  });

  test('تفريغات متزامنة لا ترسل نفس الرسالة مرتين', () async {
    final gate = Completer<SendResult>();
    final s = ScriptedSender([gate]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    final f1 = p.flush();
    final f2 = p.flush();
    final f3 = p.flush();
    await pumpEventQueue();
    expect(p.isInFlight(e.clientId), isTrue);
    expect(await p.discard(e.clientId), isFalse, reason: 'لا حذف أثناء الإرسال: قد تكون وصلت');
    gate.complete(ScriptedSender.ok(e));
    await Future.wait([f1, f2, f3]);
    expect(s.calls, [e.clientId]);
  });

  test('انقطاع شبكة ⇒ تبقى في الطابور وتُعاد تلقائياً بنفس clientId', () async {
    final s = ScriptedSender([err(ApiErrorCode.network)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    expect(p.entries.single.state, OutboxState.queued);
    expect(p.entries.single.clientId, e.clientId);
    await p.flush();
    expect(s.calls, [e.clientId, e.clientId]);
    expect(p.entries, isEmpty);
  });

  test('مهلة وبوابة بلا رمز تُعاملان كانقطاع', () {
    expect(stateAfterError(err(ApiErrorCode.timeout)), OutboxState.queued);
    expect(stateAfterError(err(ApiErrorCode.serverUnavailable)), OutboxState.queued);
    expect(stateAfterError(err(ApiErrorCode.rateLimited)), OutboxState.queued);
  });

  test('جدول القرار للأخطاء النهائية', () {
    expect(stateAfterError(err(ApiErrorCode.sendFailed)), OutboxState.failed);
    expect(stateAfterError(err(ApiErrorCode.windowClosed)), OutboxState.failed);
    expect(stateAfterError(err(ApiErrorCode.tenantInactive)), OutboxState.failed);
    expect(stateAfterError(err(ApiErrorCode.invalidInput)), OutboxState.failed);
    expect(stateAfterError(err(ApiErrorCode.inProgress)), OutboxState.inProgress);
    expect(stateAfterError(err(ApiErrorCode.deliveryUnknown)), OutboxState.uncertain);
    expect(stateAfterError(err(ApiErrorCode.internal)), OutboxState.uncertain);
  });

  test('فشل انقطاع يوقف ما بعده في نفس المحادثة فقط (الترتيب محفوظ)', () async {
    final s = ScriptedSender([err(ApiErrorCode.network)]);
    final p = make(s);
    final a = await p.enqueueText('c1', 'مرحباً');
    await p.enqueueText('c1', 'وهذا السعر');
    final c = await p.enqueueText('c2', 'محادثة أخرى');
    await p.flush();
    expect(s.calls, [a.clientId, c.clientId]);
    await p.flush();
    expect(p.entries, isEmpty);
    expect(s.calls.length, 4);
    expect(s.calls[2], a.clientId, reason: 'الأولى قبل الثانية دائماً');
  });

  test('SEND_FAILED ⇒ فشل بلا إعادة تلقائية، و«إعادة» يدوية بنفس clientId', () async {
    final s = ScriptedSender([err(ApiErrorCode.sendFailed)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    expect(p.entries.single.state, OutboxState.failed);
    expect(p.entries.single.errorCode, 'SEND_FAILED');
    await p.flush();
    expect(s.calls.length, 1, reason: 'التفريغ لا يلمس الفاشلة');
    expect(await p.retry(e.clientId), isTrue);
    expect(s.calls, [e.clientId, e.clientId]);
    expect(p.entries, isEmpty);
  });

  test('DELIVERY_UNKNOWN ⇒ غير مؤكّد، لا إعادة تلقائية أبداً، و«إعادة» بنفس المعرّف مرفوضة', () async {
    final s = ScriptedSender([err(ApiErrorCode.deliveryUnknown)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    expect(p.entries.single.state, OutboxState.uncertain);
    await p.flush();
    await p.flush();
    expect(await p.retry(e.clientId), isFalse);
    expect(s.calls, [e.clientId], reason: 'لا نداء ثانٍ مهما تكرر التفريغ');
  });

  test('‎500 INTERNAL على إرسال ⇒ غير مؤكّد بلا إعادة تلقائية', () async {
    final s = ScriptedSender([err(ApiErrorCode.internal)]);
    final p = make(s);
    await p.enqueueText('c1', 'x');
    await p.flush();
    await p.flush();
    expect(p.entries.single.state, OutboxState.uncertain);
    expect(s.calls.length, 1);
  });

  test('«أرسل مرة أخرى» بعد غير مؤكّد ⇒ clientId جديد عن قصد، والقديمة تختفي', () async {
    final s = ScriptedSender([err(ApiErrorCode.deliveryUnknown)]);
    final p = make(s);
    final old = await p.enqueueText('c1', 'السعر ٦٠٠');
    await p.flush();
    final fresh = await p.sendAgain(old.clientId);
    expect(fresh, isNotNull);
    expect(fresh!.clientId, isNot(old.clientId));
    expect(fresh.text, old.text);
    expect(s.calls, [old.clientId, fresh.clientId]);
    expect(p.entries, isEmpty);
    expect(store.data.containsKey(old.clientId), isFalse);
  });

  test('«أرسل مرة أخرى» مرفوض لغير المؤكّد فقط', () async {
    final s = ScriptedSender([err(ApiErrorCode.sendFailed)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    expect(await p.sendAgain(e.clientId), isNull, reason: 'الفشل الصريح يُعاد بنفس المعرّف');
  });

  test('IN_PROGRESS ⇒ معلّقة بلا إعادة، وتزول حين تظهر في messages', () async {
    final s = ScriptedSender([err(ApiErrorCode.inProgress)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    expect(p.entries.single.state, OutboxState.inProgress);
    expect(p.entries.single.isPending, isTrue);
    await p.flush();
    expect(s.calls.length, 1, reason: 'لا نعيد إرسالها');
    await p.reconcile([e.clientId]);
    expect(p.entries, isEmpty);
  });

  test('IN_PROGRESS طال انتظاره ⇒ غير مؤكّد (لا ساعة تدور للأبد، ولا إعادة)', () async {
    var t = DateTime.utc(2026, 10, 16, 12);
    final s = ScriptedSender([err(ApiErrorCode.inProgress)]);
    final p = make(s, now: () => t);
    await p.enqueueText('c1', 'x');
    await p.flush();
    t = t.add(const Duration(minutes: 3));
    await p.flush();
    expect(p.entries.single.state, OutboxState.uncertain);
    expect(s.calls.length, 1);
  });

  test('TENANT_INACTIVE ⇒ فشل، ويُبلَّغ المستوى الأعلى لإيقاف المحرّر', () async {
    final errors = <ApiError>[];
    final s = ScriptedSender([err(ApiErrorCode.tenantInactive)]);
    final p = make(s, errors: errors);
    await p.enqueueText('c1', 'x');
    await p.flush();
    expect(p.entries.single.state, OutboxState.failed);
    expect(errors.single.code, ApiErrorCode.tenantInactive);
  });

  test('«sending» من تشغيل قُتل في منتصفه يعود للطابور ويُرسل بنفس المعرّف', () async {
    final orphan = OutboxEntry(
      clientId: 'fixed-id',
      conversationId: 'c1',
      kind: OutboxKind.text,
      text: 'x',
      createdAt: DateTime.utc(2026),
      state: OutboxState.sending,
    );
    await store.put(orphan);
    final s = ScriptedSender([]);
    final p = make(s);
    await p.load();
    expect(p.entries.single.state, OutboxState.queued);
    await p.flush();
    expect(s.calls, ['fixed-id']);
  });

  test('غير المؤكّد يبقى غير مؤكّد بعد إعادة التشغيل', () async {
    await store.put(OutboxEntry(
      clientId: 'u1',
      conversationId: 'c1',
      kind: OutboxKind.text,
      text: 'x',
      createdAt: DateTime.utc(2026),
      state: OutboxState.uncertain,
    ));
    final s = ScriptedSender([]);
    final p = make(s);
    await p.load();
    await p.flush();
    expect(s.calls, isEmpty);
  });

  test('رد مؤكّد وصل عبر الاستطلاع يُسقط النسخة المتفائلة', () async {
    final s = ScriptedSender([err(ApiErrorCode.network)]);
    final p = make(s);
    final e = await p.enqueueText('c1', 'x');
    await p.flush();
    await p.reconcile([e.clientId]);
    expect(p.entries, isEmpty);
    await p.flush();
    expect(s.calls.length, 1, reason: 'لا إرسال لما وصل فعلاً');
  });

  group('مع الخادم الوهمي (دلالات العقد)', () {
    late FakeHaderApi api;

    setUp(() => api = FakeHaderApi(latency: Duration.zero, slowCompletion: const Duration(milliseconds: 30)));
    tearDown(() => api.dispose());

    Future<void> login() => api.login(email: FakeHaderApi.demoEmail, password: FakeHaderApi.demoPassword, deviceName: 't', platform: 'ios');

    OutboxProcessor withApi() => OutboxProcessor(
          store: store,
          sender: (e) => api.sendText(e.conversationId, text: e.text, clientId: e.clientId),
          onSent: (e, r) async => sent.add(r),
        );

    test('تكرار نفس clientId لا يرسل مرتين', () async {
      await login();
      final a = await api.sendText('c_wa_ahmad', text: 'مرحبا', clientId: 'id-1');
      final b = await api.sendText('c_wa_ahmad', text: 'مرحبا', clientId: 'id-1');
      expect(a.message!.id, b.message!.id);
      expect(api.deliveredSends, 1);
    });

    test('نفس clientId لمحتوى مختلف ⇒ ‎400', () async {
      await login();
      await api.sendText('c_wa_ahmad', text: 'أ', clientId: 'id-2');
      expect(
        () => api.sendText('c_wa_ahmad', text: 'ب', clientId: 'id-2'),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ApiErrorCode.invalidInput)),
      );
    });

    test('#slow: IN_PROGRESS ثم تظهر في messages بنفس clientId وتُطابَق', () async {
      await login();
      final p = withApi();
      final e = await p.enqueueText('c_wa_ahmad', 'تأكيد #slow');
      await p.flush();
      expect(p.entries.single.state, OutboxState.inProgress);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      final page = await api.messages('c_wa_ahmad');
      final ids = page.items.map((m) => m.clientId).whereType<String>();
      expect(ids, contains(e.clientId));
      await p.reconcile(ids);
      expect(p.entries, isEmpty);
      expect(api.deliveredSends, 1);
    });

    test('#unknown: غير مؤكّد، ونفس المعرّف يبقى DELIVERY_UNKNOWN', () async {
      await login();
      final p = withApi();
      final e = await p.enqueueText('c_wa_ahmad', 'x #unknown');
      await p.flush();
      expect(p.entries.single.state, OutboxState.uncertain);
      expect(
        () => api.sendText('c_wa_ahmad', text: 'x #unknown', clientId: e.clientId),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ApiErrorCode.deliveryUnknown)),
      );
      expect(api.deliveredSends, 0);
    });

    test('النافذة المغلقة ⇒ WINDOW_CLOSED (فشل صريح)', () async {
      await login();
      final p = withApi();
      await p.enqueueText('c_wa_farah', 'مرحبا');
      await p.flush();
      expect(p.entries.single.errorCode, 'WINDOW_CLOSED');
      expect(p.entries.single.state, OutboxState.failed);
    });

    test('المتجر غير النشط: القراءة تعمل والإرسال ‎403', () async {
      api.tenantInactive = true;
      await login();
      expect((await api.conversations(Channel.whatsapp)).pinned, isNotEmpty);
      final p = withApi();
      await p.enqueueText('c_wa_ahmad', 'x');
      await p.flush();
      expect(p.entries.single.errorCode, 'TENANT_INACTIVE');
    });
  });
}
