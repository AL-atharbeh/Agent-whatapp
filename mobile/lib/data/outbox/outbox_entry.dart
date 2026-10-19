import '../../core/json.dart';
import '../models.dart';

enum OutboxState {
  /// ينتظر الإرسال (أول مرة، أو بعد انقطاع) — يُعاد تلقائياً.
  queued,

  /// في الطريق الآن. إن قُتل التطبيق هنا يعود queued عند الفتح؛ هذا آمن
  /// لأن الخادم يتعرّف على clientId ولا يرسل مرتين.
  sending,

  /// الخادم قال IN_PROGRESS: طلب سابق بنفس المعرّف ما زال جارياً. لا نعيد
  /// الإرسال؛ ننتظر ظهورها في GET messages (مطابقة بـclientId). إن طال
  /// الانتظار تصبح [uncertain] — لا نعرف مصيرها، ونقول ذلك بصدق.
  inProgress,

  /// رفض صريح (SEND_FAILED، WINDOW_CLOSED، TENANT_INACTIVE، …) — لم تصل.
  /// «إعادة المحاولة» بيد المستخدم وبنفس clientId (آمن).
  failed,

  /// DELIVERY_UNKNOWN أو INTERNAL: **ربما وصلت**. لا إعادة تلقائية أبداً،
  /// و«أرسل مرة أخرى» يولّد clientId جديداً عن قصد — المستخدم وحده يقبل
  /// احتمال أن يصل العميل ردّان.
  uncertain;

  static OutboxState fromWire(String? s) =>
      values.firstWhere((v) => v.name == s, orElse: () => OutboxState.queued);
}

enum OutboxKind {
  text,
  template;

  static OutboxKind fromWire(String? s) =>
      values.firstWhere((v) => v.name == s, orElse: () => OutboxKind.text);
}

/// رسالة لم يؤكّدها الخادم بعد.
///
/// [clientId] يولد مرة واحدة عند الكتابة ولا يتغيّر أبداً — لا عند إعادة
/// المحاولة ولا بعد إعادة تشغيل التطبيق. هذا وحده ما يضمن ألّا يصل العميل
/// نفس الرد مرتين مهما تقطّعت الشبكة.
class OutboxEntry {
  const OutboxEntry({
    required this.clientId,
    required this.conversationId,
    required this.kind,
    required this.text,
    required this.createdAt,
    this.state = OutboxState.queued,
    this.templateName,
    this.templateLanguage,
    this.variables = const [],
    this.errorCode,
    this.errorMessage,
    this.attempts = 0,
    this.lastAttemptAt,
  });

  static OutboxEntry? fromJson(JsonMap m) {
    final clientId = readNonEmptyOrNull(m, 'clientId');
    final conv = readNonEmptyOrNull(m, 'conversationId');
    if (clientId == null || conv == null) return null;
    return OutboxEntry(
      clientId: clientId,
      conversationId: conv,
      kind: OutboxKind.fromWire(readStringOrNull(m, 'kind')),
      text: readString(m, 'text'),
      createdAt: readDateOrNull(m, 'createdAt') ?? DateTime.now().toUtc(),
      state: OutboxState.fromWire(readStringOrNull(m, 'state')),
      templateName: readNonEmptyOrNull(m, 'templateName'),
      templateLanguage: readNonEmptyOrNull(m, 'templateLanguage'),
      variables: readStringList(m, 'variables'),
      errorCode: readNonEmptyOrNull(m, 'errorCode'),
      errorMessage: readNonEmptyOrNull(m, 'errorMessage'),
      attempts: readInt(m, 'attempts'),
      lastAttemptAt: readDateOrNull(m, 'lastAttemptAt'),
    );
  }

  final String clientId;
  final String conversationId;
  final OutboxKind kind;

  /// نص الرسالة، أو نص القالب بعد التعبئة (للعرض المتفائل).
  final String text;
  final DateTime createdAt;
  final OutboxState state;
  final String? templateName;
  final String? templateLanguage;
  final List<String> variables;
  final String? errorCode;
  final String? errorMessage;
  final int attempts;
  final DateTime? lastAttemptAt;

  /// ما زالت «في الطريق» من وجهة نظر المستخدم (ساعة لا علامة خطأ).
  bool get isPending =>
      state == OutboxState.queued || state == OutboxState.sending || state == OutboxState.inProgress;

  TemplateSelection? get templateSelection {
    if (kind != OutboxKind.template || templateName == null) return null;
    return TemplateSelection(
      template: MessageTemplate(
        name: templateName!,
        language: templateLanguage ?? 'ar',
        category: '',
        body: text,
        variables: variables.length,
      ),
      variables: variables,
    );
  }

  OutboxEntry copyWith({
    OutboxState? state,
    String? errorCode,
    String? errorMessage,
    bool clearError = false,
    int? attempts,
    DateTime? lastAttemptAt,
  }) =>
      OutboxEntry(
        clientId: clientId,
        conversationId: conversationId,
        kind: kind,
        text: text,
        createdAt: createdAt,
        state: state ?? this.state,
        templateName: templateName,
        templateLanguage: templateLanguage,
        variables: variables,
        errorCode: clearError ? null : (errorCode ?? this.errorCode),
        errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
        attempts: attempts ?? this.attempts,
        lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      );

  /// نسخة بمعرّف جديد ونفس المحتوى — لـ«أرسل مرة أخرى» بعد DELIVERY_UNKNOWN.
  OutboxEntry resendAs(String newClientId, DateTime now) => OutboxEntry(
        clientId: newClientId,
        conversationId: conversationId,
        kind: kind,
        text: text,
        createdAt: now,
        templateName: templateName,
        templateLanguage: templateLanguage,
        variables: variables,
      );

  JsonMap toJson() => {
        'clientId': clientId,
        'conversationId': conversationId,
        'kind': kind.name,
        'text': text,
        'createdAt': createdAt.toIso8601String(),
        'state': state.name,
        'templateName': templateName,
        'templateLanguage': templateLanguage,
        'variables': variables,
        'errorCode': errorCode,
        'errorMessage': errorMessage,
        'attempts': attempts,
        'lastAttemptAt': lastAttemptAt?.toIso8601String(),
      };
}
