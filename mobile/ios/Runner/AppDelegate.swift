import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    let channel = FlutterMethodChannel(
      name: "hader/platform",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "excludeFromBackup":
        // ذاكرة المحادثات المحلية في Documents، وiOS ينسخ Documents إلى iCloud
        // افتراضياً. رسائل العملاء لا يجوز أن تخرج إلى نسخة احتياطية لا يسيطر
        // عليها صاحب المتجر، فنستثني مجلدها صراحةً.
        guard let args = call.arguments as? [String: Any],
          let path = args["path"] as? String
        else {
          result(false)
          return
        }
        var url = URL(fileURLWithPath: path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
          try url.setResourceValues(values)
          result(true)
        } catch {
          result(false)
        }
      case "setSecureRecents":
        // على iOS يغطّي Flutter المحتوى بنفسه عند inactive؛ لا شيء هنا.
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
