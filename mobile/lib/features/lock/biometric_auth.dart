import 'package:local_auth/local_auth.dart';
import 'package:local_auth_darwin/local_auth_darwin.dart';

/// نوع البصمة المسجّلة على الجهاز — للأيقونة والنص («بصمة الوجه» لا «بصمة»).
enum BiometricKind { face, fingerprint, none }

/// غلاف local_auth كي يُستبدل في الاختبارات ولا يرمي أبداً.
class BiometricAuth {
  BiometricAuth([LocalAuthentication? auth]) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  /// بصمة **مسجّلة** فعلاً — لا مجرد جهاز يدعمها. هاتف بلا وجه مسجّل كان
  /// يقفز مباشرة لرمز iPhone في نافذة النظام بدل رمز حاضر.
  Future<BiometricKind> kind() async {
    try {
      final types = await _auth.getAvailableBiometrics();
      if (types.contains(BiometricType.face)) return BiometricKind.face;
      if (types.isNotEmpty) return BiometricKind.fingerprint;
      return BiometricKind.none;
    } catch (_) {
      return BiometricKind.none;
    }
  }

  /// بصمة الوجه أو الإصبع وحدها. true فقط عند النجاح؛ الإلغاء أو الخطأ =
  /// false. البديل رمز حاضر على شاشتنا، لا رمز iPhone في نافذة النظام —
  /// فزرّ «أدخل الرمز» في نافذة iOS يُخفى.
  Future<bool> authenticate(String reason) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
        authMessages: const [IOSAuthMessages(localizedFallbackTitle: '', cancelButton: 'إلغاء')],
      );
    } catch (_) {
      return false;
    }
  }

  /// رمز قفل الجهاز — فقط لمن فعّل القفل قبل أن يكون لحاضر رمزه الخاص ولا
  /// بصمة عنده؛ بدونه يُحبس خارج تطبيقه.
  Future<bool> authenticateWithDevice(String reason) async {
    try {
      return await _auth.authenticate(localizedReason: reason, persistAcrossBackgrounding: true);
    } catch (_) {
      return false;
    }
  }
}
