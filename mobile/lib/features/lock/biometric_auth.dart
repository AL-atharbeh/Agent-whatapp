import 'package:local_auth/local_auth.dart';

/// غلاف local_auth كي يُستبدل في الاختبارات ولا يرمي أبداً.
class BiometricAuth {
  BiometricAuth([LocalAuthentication? auth]) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  /// الجهاز يدعم بصمة أو رمز قفل؟ بلا أيّهما لا معنى لتفعيل القفل.
  Future<bool> isAvailable() async {
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  /// true فقط عند نجاح التحقق. الإلغاء أو الخطأ = false، لا استثناء.
  ///
  /// biometricOnly=false: من فشلت بصمته (يد مبتلّة، كمامة) يدخل برمز الجهاز
  /// بدل أن يُحبس خارج صندوق رسائل متجره.
  Future<bool> authenticate(String reason) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        persistAcrossBackgrounding: true,
      );
    } catch (_) {
      return false;
    }
  }
}
