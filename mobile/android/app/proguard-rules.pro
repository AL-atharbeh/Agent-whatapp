# قواعد R8 لبناء الإصدار.
# Flutter وإضافاته تأتي بقواعدها (consumer rules)؛ هذه للحالات التي تكسر
# فيها الإزالة شيئاً يُستدعى انعكاسياً فيظهر عطلاً في الإصدار وحده.

# flutter_secure_storage يعتمد Tink الذي يشير إلى تعليقات وقت الترجمة فقط.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# Firebase Messaging: خدمة الاستقبال تُنشأ بالاسم من البيان.
-keep class io.flutter.plugins.firebase.messaging.** { *; }

# قناة المنصّة الخاصة بنا تُستدعى من Dart بالاسم.
-keep class com.shifracode.hader.MainActivity { *; }

# Play Core (مكوّنات مؤجّلة) غير مستخدمة؛ إشارات Flutter إليها تُسكَت.
-dontwarn com.google.android.play.core.**
