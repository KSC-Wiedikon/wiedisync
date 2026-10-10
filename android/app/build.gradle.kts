import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: CI passes ANDROID_KEYSTORE / ANDROID_KEYSTORE_PASSWORD /
// ANDROID_KEY_ALIAS as env vars; a local release build falls back to
// ~/.config/wiedisync-android/credentials.env (same keys). Without either — e.g.
// on the F-Droid build server — the release APK is built unsigned.
val signing: Map<String, String> = run {
    val fromEnv = listOf("ANDROID_KEYSTORE", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS")
        .mapNotNull { k -> System.getenv(k)?.takeIf { it.isNotBlank() }?.let { k to it } }
        .toMap()
    if (fromEnv.size == 3) return@run fromEnv
    val file = File(System.getProperty("user.home"), ".config/wiedisync-android/credentials.env")
    if (!file.exists()) return@run emptyMap()
    Properties().apply { file.inputStream().use { load(it) } }
        .entries.associate { (k, v) -> k.toString() to v.toString() }
}

android {
    namespace = "ch.kscw.wiedisync"
    compileSdk = 36

    defaultConfig {
        applicationId = "ch.kscw.wiedisync"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    flavorDimensions += "env"
    productFlavors {
        create("prod") {
            dimension = "env"
            buildConfigField("String", "START_URL", "\"https://wiedisync.kscw.ch/\"")
            buildConfigField("String", "APP_HOSTS", "\"wiedisync.kscw.ch,spielplanung.wiedisync.kscw.ch\"")
            manifestPlaceholders["appHost"] = "wiedisync.kscw.ch"
        }
        // Dev talks to directus-dev through the only dev host where the session
        // cookie sticks (CLAUDE.md → Domains). Installs next to the prod app.
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "START_URL", "\"https://wiedisync-dev.kscw.ch/\"")
            buildConfigField("String", "APP_HOSTS", "\"wiedisync-dev.kscw.ch,spielplanung-dev.kscw.ch\"")
            manifestPlaceholders["appHost"] = "wiedisync-dev.kscw.ch"
        }
    }

    signingConfigs {
        if (signing.isNotEmpty()) {
            create("release") {
                storeFile = file(signing.getValue("ANDROID_KEYSTORE"))
                storePassword = signing.getValue("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signing.getValue("ANDROID_KEY_ALIAS")
                keyPassword = signing.getValue("ANDROID_KEYSTORE_PASSWORD")
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    // F-Droid rejects the Google-encrypted dependency metadata block, and it
    // breaks reproducible builds.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.webkit:webkit:1.17.1")
    // Push without Google: UnifiedPush (Apache-2.0). Endpoints are Web Push
    // (RFC 8030/8291 + VAPID), so the existing kscw-push worker sends to them.
    implementation("org.unifiedpush.android:connector:3.3.5")
}
