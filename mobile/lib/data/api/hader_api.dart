import 'dart:typed_data';

import '../appointments.dart';
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

  // ───────────── المواعيد (docs/appointments.md) — 404 لمتجر غير مفعّل ─────────────

  /// [date] بصيغة `YYYY-MM-DD`.
  Future<AppointmentDay> appointmentsDay(String date);

  Future<Appointment> createAppointment(NewAppointment request);

  /// `finish` وحده يقبل السعر والملاحظات.
  Future<Appointment> appointmentAction(
    String id,
    AppointmentAction action, {
    double? finalPrice,
    String? notes,
  });

  Future<Appointment> updateAppointment(
    String id, {
    DateTime? startAt,
    String? staffId,
    int? plannedMinutes,
    String? notes,
  });

  Future<SlotsResult> appointmentSlots({
    required String serviceId,
    String? staffId,
    required String date,
    String? customerId,
  });

  Future<List<ServiceOffering>> services();

  Future<List<StaffMember>> staff();

  /// null = لا صورة (404) — الواجهة تعرض الحروف الأولى.
  Future<Uint8List?> staffPhoto(String staffId);

  Future<List<Customer>> customers(String query);

  Future<CustomerProfile> customerProfile(String id);

  Future<Customer> createCustomer({required String phone, String? name, String? notes});

  Future<Customer> updateCustomer(
    String id, {
    String? name,
    String? phone,
    String? notes,
    String? preferredStaffId,
  });

  // ───────────── الإدارة: الخدمات والفريق والتقارير ─────────────

  /// كل الخدمات، والموقوفة معها — لشاشة الإدارة وحدها.
  Future<List<ServiceOffering>> allServices();

  /// [id] null ⇒ إنشاء، وإلا تعديل.
  Future<ServiceOffering> saveService(ServiceOffering service, {String? id});

  /// كل الفريق، والموقوفون معه.
  Future<List<StaffMember>> allStaff();

  Future<StaffMember> saveStaff(StaffMember member, {String? id});

  /// [bytes] صورة JPEG/PNG/WebP حتى ١٥٠ كيلوبايت.
  Future<StaffMember> uploadStaffPhoto(String staffId, Uint8List bytes, {String mime = 'image/jpeg'});

  Future<StaffMember> deleteStaffPhoto(String staffId);

  /// [from] و[to] بصيغة `YYYY-MM-DD` شاملتين.
  Future<AppointmentReport> appointmentReport({required String from, required String to});
}
