import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firebase اختياري: بلا google-services.json يُبنى التطبيق ويعمل، والإشعارات
// تصبح بلا أثر ويغطّيها الاستطلاع. تطبيق الإضافة دون الملف يكسر البناء كله،
// فلا نطبّقها إلا إن وُجد. انظر mobile/README.md.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// توقيع الإصدار من key.properties (خارج git). بدونه نوقّع بمفتاح debug كي
// يعمل `flutter run --release` محلياً — لكن هذا لا يصلح للرفع إلى المتجر.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    namespace = "com.shifracode.hader"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.shifracode.hader"
        // ٢٤: الحدّ الأدنى لـflutter_secure_storage وlocal_auth الحاليين.
        minSdk = maxOf(flutter.minSdkVersion, 24)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            // تصغير وإزالة الموارد غير المستخدمة: حجم أصغر، وكود أصعب قراءةً
            // لمن يفكّ الـAPK. القواعد في proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
