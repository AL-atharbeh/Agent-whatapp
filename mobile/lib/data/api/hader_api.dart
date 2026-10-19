import '../models.dart';

/// واجهة الخادم كما في docs/mobile-api.md — نقطة لكل دالة.
///
/// للواجهة تنفيذان: [DioHaderApi] للخادم الحقيقي و[FakeHaderApi] للتطوير
/// قبل جاهزية الخادم. كل الدوال ترمي [ApiError] فقط — لا DioException ولا
/// SocketException تتسرّب للواجهات، فمعالجة الخطأ مكتوبة مرة واحدة.
abstract interface class HaderApi {
  Future<LoginResult> login({
    required String email,
    required String password,
    required String deviceName,
    required String platform,
  });

  Future<void> logout();

  Future<MeInfo> me();

  /// الحقلان اختياريان؛ null يعني «لا تغيير».
  Future<void> updateCurrentDevice({String? pushToken, NotifyMode? notify});

  Future<List<DeviceInfo>> devices();

  Future<void> revokeDevice(String id);

  Future<InboxSummary> inboxSummary();

  Future<ConversationPage> conversations(
    Channel channel, {
    String? cursor,
    int limit = 30,
  });

  Future<ConversationItem> conversation(String id);

  Future<MessagePage> messages(String id, {String? before, int limit = 50});

  Future<void> markRead(String id);

  Future<SendResult> sendText(
    String conversationId, {
    required String text,
    required String clientId,
  });

  Future<ConversationItem> takeover(String id);

  Future<ConversationItem> release(String id);

  Future<List<MessageTemplate>> templates();

  Future<SendResult> sendTemplate(
    String conversationId, {
    required TemplateSelection template,
    required String clientId,
  });

  Future<ConversationItem> startConversation({
    required String phone,
    String? name,
    required TemplateSelection template,
    required String clientId,
  });

  Future<LeadPage> leads({String? cursor, int limit = 30});
}
