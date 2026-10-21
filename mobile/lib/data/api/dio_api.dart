import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../core/errors.dart';
import '../../core/json.dart';
import '../../core/server_clock.dart';
import '../appointments.dart';
import '../models.dart';
import 'hader_api.dart';
import 'retry_policy.dart';

/// تنفيذ [HaderApi] فوق dio للخادم الحقيقي.
class DioHaderApi implements HaderApi {
  DioHaderApi({
    required String baseUrl,
    required String? Function() token,
    required void Function() onUnauthenticated,
    required ServerClock clock,
    RetryPolicy retryPolicy = const RetryPolicy(),
    HttpClientAdapter? adapter,
  }) : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            // مهلات قصيرة نسبياً: شبكة جوال ميتة تُكتشف خلال ثوانٍ فتنتقل
            // الرسالة إلى الطابور، بدل مؤشر يدور دقيقة كاملة.
            connectTimeout: const Duration(seconds: 10),
            sendTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 20),
            contentType: Headers.jsonContentType,
            responseType: ResponseType.json,
            headers: {'Accept': 'application/json'},
          ),
        ) {
    if (adapter != null) _dio.httpClientAdapter = adapter;
    _dio.interceptors.addAll([
      _AuthInterceptor(token),
      _ClockInterceptor(clock),
      _RetryInterceptor(_dio, retryPolicy),
      _ErrorInterceptor(onUnauthenticated),
      if (kDebugMode) _SafeLogInterceptor(),
    ]);
  }

  final Dio _dio;

  static final _idempotent = Options(extra: {RetryPolicy.idempotentKey: true});

  /// كل نداء يمرّ من هنا: الناتج إمّا جسم JSON وإمّا [ApiError] — لا غير.
  Future<JsonMap> _send(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Options? options,
  }) async {
    try {
      final res = await _dio.request<Object?>(
        path,
        data: body,
        queryParameters: query,
        options: (options ?? Options()).copyWith(method: method),
      );
      return asMap(res.data);
    } on DioException catch (e) {
      final err = e.error;
      throw err is ApiError ? err : mapDioException(e);
    } on ApiError {
      rethrow;
    } catch (_) {
      // جسم غير JSON أو خطأ تحليل: لا نُسقط التطبيق، نعيده خطأً مفهوماً.
      throw const ApiError(ApiErrorCode.unknown, 'رد غير متوقّع من الخادم.');
    }
  }

  @override
  Future<LoginResult> login({
    required String email,
    required String password,
    required String deviceName,
    required String platform,
  }) async {
    final j = await _send(
      'POST',
      '/auth/login',
      body: {
        'email': email.trim(),
        'password': password,
        'device': {'name': deviceName, 'platform': platform},
      },
      options: Options(extra: {_noAuthKey: true}),
    );
    final r = LoginResult.fromJson(j);
    if (r.token.isEmpty) {
      throw const ApiError(ApiErrorCode.unknown, 'رد الدخول بلا رمز جلسة.');
    }
    return r;
  }

  @override
  Future<void> logout() => _send('POST', '/auth/logout', options: _idempotent);

  @override
  Future<MeInfo> me() async => MeInfo.fromJson(await _send('GET', '/me'));

  @override
  Future<void> updateCurrentDevice({String? pushToken, NotifyMode? notify}) =>
      _send('PUT', '/devices/current', body: {
        'pushToken': ?pushToken,
        if (notify != null) 'notify': notify.wire,
      });

  @override
  Future<List<DeviceInfo>> devices() async =>
      readList(await _send('GET', '/devices'), 'items', DeviceInfo.fromJson);

  @override
  Future<void> revokeDevice(String id) =>
      _send('DELETE', '/devices/${Uri.encodeComponent(id)}');

  @override
  Future<InboxSummary> inboxSummary() async =>
      InboxSummary.fromJson(await _send('GET', '/inbox/summary'));

  @override
  Future<ConversationPage> conversations(
    Channel channel, {
    String? cursor,
    int limit = 30,
  }) async =>
      ConversationPage.fromJson(
        await _send('GET', '/conversations', query: {
          'channel': channel.wire,
          'cursor': ?cursor,
          'limit': limit.clamp(1, 50),
        }),
      );

  @override
  Future<ConversationItem> conversation(String id) async {
    final j = await _send('GET', '/conversations/${_seg(id)}');
    return _requireConversation(j['conversation']);
  }

  @override
  Future<MessagePage> messages(
    String id, {
    String? before,
    int limit = 50,
  }) async =>
      MessagePage.fromJson(
        await _send('GET', '/conversations/${_seg(id)}/messages', query: {
          'before': ?before,
          'limit': limit.clamp(1, 50),
        }),
      );

  @override
  Future<void> markRead(String id) =>
      _send('POST', '/conversations/${_seg(id)}/read', options: _idempotent);

  @override
  Future<SendResult> sendText(
    String conversationId, {
    required String text,
    required String clientId,
  }) async =>
      SendResult.fromJson(
        await _send(
          'POST',
          '/conversations/${_seg(conversationId)}/messages',
          body: {'text': text, 'clientId': clientId},
          options: _idempotent,
        ),
      );

  @override
  Future<ConversationItem> takeover(String id) async => _requireConversation(
        (await _send('POST', '/conversations/${_seg(id)}/takeover',
                options: _idempotent))['conversation'],
      );

  @override
  Future<ConversationItem> release(String id) async => _requireConversation(
        (await _send('POST', '/conversations/${_seg(id)}/release',
                options: _idempotent))['conversation'],
      );

  @override
  Future<List<MessageTemplate>> templates() async => readList(
        await _send('GET', '/templates'),
        'items',
        MessageTemplate.fromJson,
      );

  @override
  Future<SendResult> sendTemplate(
    String conversationId, {
    required TemplateSelection template,
    required String clientId,
  }) async =>
      SendResult.fromJson(
        await _send(
          'POST',
          '/conversations/${_seg(conversationId)}/template',
          body: {...template.toJson(), 'clientId': clientId},
          options: _idempotent,
        ),
      );

  @override
  Future<ConversationItem> startConversation({
    required String phone,
    String? name,
    required TemplateSelection template,
    required String clientId,
  }) async {
    final trimmedName = name?.trim();
    final j = await _send(
      'POST',
      '/conversations/start',
      body: {
        'phone': phone.trim(),
        if (trimmedName != null && trimmedName.isNotEmpty) 'name': trimmedName,
        'template': template.toJson(),
        'clientId': clientId,
      },
      options: _idempotent,
    );
    return _requireConversation(j['conversation']);
  }

  @override
  Future<LeadPage> leads({String? cursor, int limit = 30}) async =>
      LeadPage.fromJson(
        await _send('GET', '/leads', query: {
          'cursor': ?cursor,
          'limit': limit.clamp(1, 50),
        }),
      );

  // ───────────── المواعيد ─────────────

  @override
  Future<AppointmentDay> appointmentsDay(String date) async =>
      AppointmentDay.fromJson(await _send('GET', '/appointments', query: {'date': date}));

  /// غير مُعلَّم idempotent عمداً: العقد لا يعطي الحجز clientId، فإعادة
  /// تلقائية بعد رد ضائع قد تُرجع SLOT_TAKEN لموعد أُنشئ فعلاً. القرار للمستخدم.
  @override
  Future<Appointment> createAppointment(NewAppointment request) async =>
      _requireAppointment(await _send('POST', '/appointments', body: request.toJson()));

  @override
  Future<Appointment> appointmentAction(
    String id,
    AppointmentAction action, {
    double? finalPrice,
    String? notes,
  }) async {
    final body = action == AppointmentAction.finish
        ? {'finalPrice': ?finalPrice, if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim()}
        : null;
    return _requireAppointment(await _send('POST', '/appointments/${_seg(id)}/${action.wire}', body: body));
  }

  @override
  Future<Appointment> updateAppointment(
    String id, {
    DateTime? startAt,
    String? staffId,
    int? plannedMinutes,
    String? notes,
  }) async =>
      _requireAppointment(await _send('PATCH', '/appointments/${_seg(id)}', body: {
        if (startAt != null) 'startAt': startAt.toUtc().toIso8601String(),
        'staffId': ?staffId,
        'plannedMinutes': ?plannedMinutes,
        'notes': ?notes,
      }));

  @override
  Future<SlotsResult> appointmentSlots({
    required String serviceId,
    String? staffId,
    required String date,
    String? customerId,
  }) async =>
      SlotsResult.fromJson(await _send('GET', '/appointments/slots', query: {
        'serviceId': serviceId,
        'staffId': ?staffId,
        'date': date,
        'customerId': ?customerId,
      }));

  @override
  Future<List<ServiceOffering>> services() async =>
      readList(await _send('GET', '/services'), 'items', ServiceOffering.fromJson);

  @override
  Future<List<StaffMember>> staff() async =>
      readList(await _send('GET', '/staff'), 'items', StaffMember.fromJson);

  @override
  Future<Uint8List?> staffPhoto(String staffId) async {
    try {
      final res = await _dio.get<List<int>>(
        '/staff/${_seg(staffId)}/photo',
        options: Options(responseType: ResponseType.bytes),
      );
      final data = res.data;
      return data == null || data.isEmpty ? null : Uint8List.fromList(data);
    } on DioException catch (e) {
      final err = e.error is ApiError ? e.error! as ApiError : mapDioException(e);
      // لا صورة ليست خطأً يُعرض: الحروف الأولى بديل كامل.
      if (err.code == ApiErrorCode.notFound) return null;
      throw err;
    }
  }

  @override
  Future<List<Customer>> customers(String query) async =>
      readList(await _send('GET', '/customers', query: {'q': query.trim()}), 'items', Customer.fromJson);

  @override
  Future<CustomerProfile> customerProfile(String id) async {
    final p = CustomerProfile.fromJson(await _send('GET', '/customers/${_seg(id)}'));
    if (p == null) throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    return p;
  }

  @override
  Future<Customer> createCustomer({required String phone, String? name, String? notes}) async =>
      _requireCustomer(await _send('POST', '/customers', body: {
        'phone': phone.trim(),
        if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      }));

  @override
  Future<Customer> updateCustomer(
    String id, {
    String? name,
    String? phone,
    String? notes,
    String? preferredStaffId,
  }) async =>
      _requireCustomer(await _send('PATCH', '/customers/${_seg(id)}', body: {
        'name': ?name,
        'phone': ?phone,
        'notes': ?notes,
        'preferredStaffId': ?preferredStaffId,
      }));

  @override
  Future<List<ServiceOffering>> allServices() async =>
      readList(await _send('GET', '/services', query: {'all': '1'}), 'items', ServiceOffering.fromJson);

  @override
  Future<ServiceOffering> saveService(ServiceOffering service, {String? id}) async {
    final j = id == null
        ? await _send('POST', '/services', body: service.toBody())
        : await _send('PATCH', '/services/${_seg(id)}', body: service.toBody());
    final s = ServiceOffering.fromJson(asMap(j['service']));
    if (s == null) throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    return s;
  }

  @override
  Future<List<StaffMember>> allStaff() async =>
      readList(await _send('GET', '/staff', query: {'all': '1'}), 'items', StaffMember.fromJson);

  @override
  Future<StaffMember> saveStaff(StaffMember member, {String? id}) async => _requireStaff(id == null
      ? await _send('POST', '/staff', body: member.toBody())
      : await _send('PATCH', '/staff/${_seg(id)}', body: member.toBody()));

  @override
  Future<StaffMember> uploadStaffPhoto(String staffId, Uint8List bytes, {String mime = 'image/jpeg'}) async =>
      _requireStaff(await _send(
        'PUT',
        '/staff/${_seg(staffId)}/photo',
        // البايتات كما هي (لا تدفّق: PUT يُعاد عند انقطاع، والتدفّق لا يُقرأ مرتين).
        // الخادم يفحص النوع الحقيقي من المحتوى لا من الرأس.
        body: bytes,
        options: Options(contentType: mime),
      ));

  @override
  Future<StaffMember> deleteStaffPhoto(String staffId) async =>
      _requireStaff(await _send('DELETE', '/staff/${_seg(staffId)}/photo'));

  @override
  Future<AppointmentReport> appointmentReport({required String from, required String to}) async =>
      AppointmentReport.fromJson(await _send('GET', '/appointments/reports', query: {'from': from, 'to': to}));

  static StaffMember _requireStaff(JsonMap j) {
    final s = StaffMember.fromJson(asMap(j['staff']));
    if (s == null) throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    return s;
  }

  static Appointment _requireAppointment(JsonMap j) {
    final a = Appointment.fromJson(j);
    if (a == null) throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    return a;
  }

  static Customer _requireCustomer(JsonMap j) {
    final c = Customer.fromJson(j);
    if (c == null) throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    return c;
  }

  /// معرّف من الخادم يدخل المسار كما هو؛ ترميزه يمنع `../` من تغيير النقطة.
  static String _seg(String id) => Uri.encodeComponent(id);

  static ConversationItem _requireConversation(Object? raw) {
    final c = ConversationItem.fromJson(asMap(raw));
    if (c == null) {
      throw const ApiError(ApiErrorCode.unknown, 'رد غير مكتمل من الخادم.');
    }
    return c;
  }
}

const _noAuthKey = 'noAuth';

/// يحوّل أي DioException إلى [ApiError]. عام كي يُختبر وحده.
ApiError mapDioException(DioException e) {
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.transformTimeout:
      return ApiError(
        ApiErrorCode.timeout,
        ApiError.defaultMessage(ApiErrorCode.timeout),
      );
    case DioExceptionType.connectionError:
      return ApiError(
        ApiErrorCode.network,
        ApiError.defaultMessage(ApiErrorCode.network),
      );
    case DioExceptionType.badResponse:
      final r = e.response;
      return ApiError.fromResponse(
        r?.statusCode,
        r?.data,
        retryAfterHeader: r?.headers.value('retry-after'),
      );
    case DioExceptionType.badCertificate:
      // شهادة مزوّرة = اعتراض محتمل. لا نعيد المحاولة ولا نتجاوز.
      return const ApiError(
        ApiErrorCode.network,
        'تعذّر التحقق من هوية الخادم. تأكد من شبكتك.',
      );
    case DioExceptionType.cancel:
      return const ApiError(ApiErrorCode.unknown, 'أُلغي الطلب.');
    case DioExceptionType.unknown:
      if (e.error is SocketException || e.error is HttpException) {
        return ApiError(
          ApiErrorCode.network,
          ApiError.defaultMessage(ApiErrorCode.network),
        );
      }
      return ApiError(
        ApiErrorCode.unknown,
        ApiError.defaultMessage(ApiErrorCode.unknown),
      );
  }
}

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._token);
  final String? Function() _token;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (options.extra[_noAuthKey] != true) {
      final t = _token();
      if (t != null && t.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $t';
      }
    }
    handler.next(options);
  }
}

class _ClockInterceptor extends Interceptor {
  _ClockInterceptor(this._clock);
  final ServerClock _clock;

  void _observe(Headers h) {
    final raw = h.value('date');
    if (raw == null) return;
    try {
      _clock.observe(HttpDate.parse(raw));
    } catch (_) {
      // رأس تاريخ تالف لا يعطّل الطلب.
    }
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler h) {
    _observe(response.headers);
    h.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final r = err.response;
    if (r != null) _observe(r.headers);
    handler.next(err);
  }
}

class _RetryInterceptor extends Interceptor {
  _RetryInterceptor(this._dio, this._policy);
  final Dio _dio;
  final RetryPolicy _policy;

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final delay = _policy.delayFor(err);
    if (delay == null) return handler.next(err);
    await Future<void>.delayed(delay);
    final o = err.requestOptions;
    o.extra[RetryPolicy.attemptKey] =
        ((o.extra[RetryPolicy.attemptKey] as int?) ?? 0) + 1;
    try {
      // نفس الجسم حرفياً — أي نفس clientId — فلا يصل العميل ردّان.
      handler.resolve(await _dio.fetch<Object?>(o));
    } on DioException catch (e) {
      handler.next(e);
    }
  }
}

class _ErrorInterceptor extends Interceptor {
  _ErrorInterceptor(this._onUnauthenticated);
  final void Function() _onUnauthenticated;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiError = err.error is ApiError ? err.error! as ApiError : mapDioException(err);
    // ‎401 من الدخول نفسه (INVALID_CREDENTIALS) ليس انتهاء جلسة؛ فقط
    // UNAUTHENTICATED على طلب يحمل رمزاً يعني «الرمز سُحب أو انتهى».
    if (apiError.code == ApiErrorCode.unauthenticated &&
        err.requestOptions.extra[_noAuthKey] != true) {
      _onUnauthenticated();
    }
    handler.next(err.copyWith(error: apiError));
  }
}

/// سجل تطوير لا يطبع رؤوساً ولا أجساماً: الرمز في الرأس، وكلمة السر ورسائل
/// العملاء في الأجسام — لا مكان لها في سجلات قد تُلصق في تذكرة دعم.
class _SafeLogInterceptor extends Interceptor {
  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler h) {
    debugPrint(
        '[api] ${response.requestOptions.method} ${response.requestOptions.path} → ${response.statusCode}');
    h.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    debugPrint(
        '[api] ${err.requestOptions.method} ${err.requestOptions.path} ✗ ${err.response?.statusCode ?? err.type.name}');
    handler.next(err);
  }
}
