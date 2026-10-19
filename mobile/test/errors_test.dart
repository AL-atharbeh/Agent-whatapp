import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hader/core/errors.dart';
import 'package:hader/data/api/dio_api.dart';
import 'package:hader/data/api/retry_policy.dart';

Map<String, dynamic> body(String code, [String? message]) => {
      'error': {'code': code, 'message': ?message},
    };

DioException bad(int status, Object? data, {String method = 'GET', Map<String, dynamic>? extra, Map<String, List<String>>? headers}) {
  final o = RequestOptions(path: '/x', method: method, extra: extra);
  return DioException(
    requestOptions: o,
    type: DioExceptionType.badResponse,
    response: Response<Object?>(requestOptions: o, statusCode: status, data: data, headers: Headers.fromMap(headers ?? {})),
  );
}

DioException net(DioExceptionType t, {String method = 'GET', Map<String, dynamic>? extra}) =>
    DioException(requestOptions: RequestOptions(path: '/x', method: method, extra: extra), type: t);

void main() {
  group('ApiError.fromResponse', () {
    test('الرمز والرسالة من جسم العقد', () {
      final e = ApiError.fromResponse(409, body('WINDOW_CLOSED', 'انتهت النافذة'));
      expect(e.code, ApiErrorCode.windowClosed);
      expect(e.message, 'انتهت النافذة');
      expect(e.status, 409);
    });

    test('رسالة فارغة ⇒ رسالة عربية افتراضية', () {
      final e = ApiError.fromResponse(401, body('INVALID_CREDENTIALS', '  '));
      expect(e.code, ApiErrorCode.invalidCredentials);
      expect(e.message, ApiError.defaultMessage(ApiErrorCode.invalidCredentials));
    });

    test('كل رموز العقد معروفة', () {
      for (final wire in [
        'INVALID_INPUT', 'UNAUTHENTICATED', 'INVALID_CREDENTIALS', 'ADMIN_NOT_SUPPORTED', 'NOT_FOUND',
        'TENANT_INACTIVE', 'WINDOW_CLOSED', 'IN_PROGRESS', 'DELIVERY_UNKNOWN', 'CHANNEL_NOT_CONNECTED',
        'TEMPLATE_INVALID', 'RATE_LIMITED', 'SEND_FAILED', 'INTERNAL',
      ]) {
        expect(ApiErrorCode.fromWire(wire), isNotNull, reason: wire);
      }
    });

    test('بلا جسم: يُستنتج من رقم الحالة', () {
      expect(ApiError.fromResponse(401, null).code, ApiErrorCode.unauthenticated);
      expect(ApiError.fromResponse(404, '<html>').code, ApiErrorCode.notFound);
      expect(ApiError.fromResponse(500, null).code, ApiErrorCode.internal);
      expect(ApiError.fromResponse(418, null).code, ApiErrorCode.unknown);
    });

    test('‎502 بلا رمز = بوابة (مؤقت)، و502 SEND_FAILED = رفض (غير مؤقت)', () {
      final gateway = ApiError.fromResponse(502, '<html>Bad Gateway</html>');
      expect(gateway.code, ApiErrorCode.serverUnavailable);
      expect(gateway.isTransient, isTrue);
      final rejected = ApiError.fromResponse(502, body('SEND_FAILED'));
      expect(rejected.code, ApiErrorCode.sendFailed);
      expect(rejected.isTransient, isFalse);
    });

    test('DELIVERY_UNKNOWN وIN_PROGRESS وTENANT_INACTIVE ليست مؤقتة', () {
      expect(ApiError.fromResponse(409, body('DELIVERY_UNKNOWN')).isTransient, isFalse);
      expect(ApiError.fromResponse(409, body('IN_PROGRESS')).isTransient, isFalse);
      expect(ApiError.fromResponse(403, body('TENANT_INACTIVE')).code, ApiErrorCode.tenantInactive);
    });

    test('رمز مجهول من خادم أحدث لا ينهار', () {
      final e = ApiError.fromResponse(409, body('SOMETHING_NEW', 'رسالة'));
      expect(e.code, ApiErrorCode.unknown);
      expect(e.message, 'رسالة');
    });

    test('Retry-After بالثواني مع سقف دفاعي', () {
      expect(ApiError.fromResponse(429, body('RATE_LIMITED'), retryAfterHeader: '7').retryAfter, const Duration(seconds: 7));
      expect(ApiError.fromResponse(429, null, retryAfterHeader: '999999').retryAfter, const Duration(hours: 1));
      expect(ApiError.fromResponse(429, null, retryAfterHeader: 'abc').retryAfter, isNull);
    });
  });

  group('mapDioException', () {
    test('انقطاع ومهلة', () {
      expect(mapDioException(net(DioExceptionType.connectionError)).code, ApiErrorCode.network);
      expect(mapDioException(net(DioExceptionType.receiveTimeout)).code, ApiErrorCode.timeout);
      expect(mapDioException(net(DioExceptionType.connectionTimeout)).isOffline, isTrue);
    });

    test('SocketException داخل unknown', () {
      final e = DioException(
        requestOptions: RequestOptions(path: '/x'),
        error: const SocketException('down'),
      );
      expect(mapDioException(e).code, ApiErrorCode.network);
    });

    test('رد سيئ يمرّ بجسم العقد', () {
      final e = mapDioException(bad(422, body('TEMPLATE_INVALID', 'متغيّر ناقص')));
      expect(e.code, ApiErrorCode.templateInvalid);
      expect(e.message, 'متغيّر ناقص');
    });
  });

  group('RetryPolicy', () {
    const p = RetryPolicy();
    final idem = {RetryPolicy.idempotentKey: true};

    test('GET يُعاد عند الانقطاع', () {
      expect(p.delayFor(net(DioExceptionType.connectionError)), isNotNull);
    });

    test('POST بلا علامة (مثل الدخول) لا يُعاد أبداً', () {
      expect(p.delayFor(net(DioExceptionType.connectionError, method: 'POST')), isNull);
    });

    test('POST بـclientId (idempotent) يُعاد عند الانقطاع', () {
      expect(p.delayFor(net(DioExceptionType.connectionTimeout, method: 'POST', extra: idem)), isNotNull);
    });

    test('سقف المحاولات', () {
      final e = net(DioExceptionType.connectionError, extra: {RetryPolicy.attemptKey: 2});
      expect(p.delayFor(e), isNull);
    });

    test('لا إعادة لـSEND_FAILED ولا DELIVERY_UNKNOWN ولا INTERNAL', () {
      expect(p.delayFor(bad(502, body('SEND_FAILED'), method: 'POST', extra: idem)), isNull);
      expect(p.delayFor(bad(409, body('DELIVERY_UNKNOWN'), method: 'POST', extra: idem)), isNull);
      expect(p.delayFor(bad(409, body('IN_PROGRESS'), method: 'POST', extra: idem)), isNull);
      expect(p.delayFor(bad(500, body('INTERNAL'), method: 'POST', extra: idem)), isNull);
    });

    test('بوابة ‎502/503 بلا رمز تُعاد', () {
      expect(p.delayFor(bad(503, '<html>', method: 'POST', extra: idem)), isNotNull);
    });

    test('‎429: ينتظر Retry-After القصير، ويترك الطويل للمستوى الأعلى', () {
      expect(
        p.delayFor(bad(429, null, headers: {'retry-after': ['2']})),
        const Duration(seconds: 2),
      );
      expect(p.delayFor(bad(429, null, headers: {'retry-after': ['60']})), isNull);
    });
  });
}
