package com.shifracode.hader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * FlutterFragmentActivity لا FlutterActivity: local_auth يعرض BiometricPrompt
 * كـFragment، ومع FlutterActivity يفشل قفل التطبيق بصمت على أندرويد.
 */
class MainActivity : FlutterFragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ensureNotificationChannel()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // إخفاء لقطة التطبيق في شاشة «التطبيقات الأخيرة» حين يكون
                    // القفل مفعّلاً: بلا هذا يرى أي شخص يمسك الهاتف آخر محادثة
                    // مفتوحة دون أن يمرّ بالبصمة.
                    "setSecureRecents" -> {
                        val enabled = call.argument<Boolean>("enabled") ?: false
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            setRecentsScreenshotEnabled(!enabled)
                        }
                        result.success(null)
                    }
                    // نسخ احتياطي معطّل كلياً من البيان؛ لا شيء يُفعل هنا.
                    "excludeFromBackup" -> result.success(true)
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * قناة الإشعارات يجب أن توجد قبل أول إشعار، وإلا وضع FCM الإشعار في
     * قناة احتياطية بأهمية افتراضية لا تظهر فوق الشاشة.
     */
    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(NOTIFICATION_CHANNEL) != null) return
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL,
            "رسائل العملاء",
            NotificationManager.IMPORTANCE_HIGH,
        )
        channel.description = "رسائل جديدة ومحادثات تحتاج تدخّلك"
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL = "hader/platform"
        private const val NOTIFICATION_CHANNEL = "hader_inbox"
    }
}
