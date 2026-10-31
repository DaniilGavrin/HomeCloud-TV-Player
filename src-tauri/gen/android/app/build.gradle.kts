import java.io.FileInputStream
import java.security.KeyStore
import java.security.PrivateKey
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("rust")
}

// -----------------------------------------------------------------------------
// Tauri Android metadata
// -----------------------------------------------------------------------------
val tauriProperties = Properties().apply {
  val propFile = file("tauri.properties")
  if (propFile.isFile) {
    propFile.inputStream().use { load(it) }
  }
}

// -----------------------------------------------------------------------------
// ByteWizard release signature: presence AND actual credentials verification
// -----------------------------------------------------------------------------
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreFile = file("C:/Users/user/bytewizard-rs-release.jks")
val keystoreProperties = Properties().apply {
  if (keystorePropertiesFile.isFile) {
    keystorePropertiesFile.inputStream().use { load(it) }
  }
}

val releaseStorePassword = keystoreProperties.getProperty("storePassword").orEmpty()
val releaseKeyAlias = keystoreProperties.getProperty("keyAlias")?.trim().orEmpty()
val releaseKeyPassword = keystoreProperties.getProperty("keyPassword").orEmpty()

println("")
println("========== HOMECLOUD TV PLAYER: RELEASE SIGNING ==========")
println("Android project : ${rootProject.projectDir}")
println("Properties file : ${keystorePropertiesFile.absolutePath}")
println("Properties found: ${if (keystorePropertiesFile.isFile) "OK" else "MISSING"}")
println("JKS file        : ${keystoreFile.absolutePath}")
println("JKS found       : ${if (keystoreFile.isFile) "OK" else "MISSING"}")
println("storePassword   : ${if (releaseStorePassword.isNotBlank()) "LOADED (hidden)" else "MISSING"}")
println("keyAlias        : ${if (releaseKeyAlias.isNotEmpty()) releaseKeyAlias else "MISSING"}")
println("keyPassword     : ${if (releaseKeyPassword.isNotBlank()) "LOADED (hidden)" else "MISSING"}")

if (!keystorePropertiesFile.isFile) {
  throw GradleException("SIGNING ERROR: keystore.properties не найден: ${keystorePropertiesFile.absolutePath}")
}
if (!keystoreFile.isFile) {
  throw GradleException("SIGNING ERROR: JKS не найден: ${keystoreFile.absolutePath}")
}
if (releaseStorePassword.isBlank() || releaseKeyAlias.isEmpty() || releaseKeyPassword.isBlank()) {
  throw GradleException("SIGNING ERROR: в keystore.properties должны быть непустые storePassword, keyAlias, keyPassword")
}

val verifiedKeystore = KeyStore.getInstance("JKS")
try {
  FileInputStream(keystoreFile).use { verifiedKeystore.load(it, releaseStorePassword.toCharArray()) }
} catch (e: Exception) {
  throw GradleException("SIGNING ERROR: не удалось открыть JKS. Проверь storePassword и формат/целостность файла.", e)
}
println("JKS store access: OK (password verified)")

if (!verifiedKeystore.containsAlias(releaseKeyAlias)) {
  throw GradleException("SIGNING ERROR: alias '$releaseKeyAlias' отсутствует в JKS")
}
println("Alias found     : OK")

val verifiedKey = try {
  verifiedKeystore.getKey(releaseKeyAlias, releaseKeyPassword.toCharArray())
} catch (e: Exception) {
  throw GradleException("SIGNING ERROR: ключ '$releaseKeyAlias' не открывается. Проверь keyPassword.", e)
}
if (verifiedKey !is PrivateKey) {
  throw GradleException("SIGNING ERROR: alias '$releaseKeyAlias' не содержит приватного ключа")
}
println("Private key     : OK (keyPassword verified)")
println("RELEASE SIGNING : READY")
println("===========================================================")
println("")

// -----------------------------------------------------------------------------
// Android / Tauri 2
// -----------------------------------------------------------------------------
android {
  compileSdk = 37
  namespace = "rs.bytewizard.hctvplayer"

  defaultConfig {
    manifestPlaceholders["usesCleartextTraffic"] = "true"
    applicationId = "rs.bytewizard.hctvplayer"
    minSdk = 24
    targetSdk = 37
    versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
    versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
  }

  signingConfigs {
    create("release") {
      storeFile = keystoreFile
      storePassword = releaseStorePassword
      keyAlias = releaseKeyAlias
      keyPassword = releaseKeyPassword
    }
  }

  buildTypes {
    getByName("debug") {
      manifestPlaceholders["usesCleartextTraffic"] = "true"
      isDebuggable = true
      isJniDebuggable = true
      isMinifyEnabled = false
      packaging {
        jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
        jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
        jniLibs.keepDebugSymbols.add("*/x86/*.so")
        jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
      }
    }

    getByName("release") {
      manifestPlaceholders["usesCleartextTraffic"] = "true"
      signingConfig = signingConfigs.getByName("release")
      optimization {
        enable = true
      }
      proguardFiles(
        *fileTree(".") {
          include("**/*.pro")
          exclude("build/**")
        }.files.toTypedArray()
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
  }

  buildFeatures {
    buildConfig = true
  }
}

kotlin {
  compilerOptions {
    jvmTarget = JvmTarget.JVM_1_8
  }
}

rust {
  rootDirRel = "../../../"
}

dependencies {
  implementation("androidx.webkit:webkit:1.14.0")
  implementation("androidx.appcompat:appcompat:1.7.1")
  implementation("androidx.activity:activity-ktx:1.10.1")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.lifecycle:lifecycle-process:2.10.0")
  testImplementation("junit:junit:4.13.2")
  androidTestImplementation("androidx.test.ext:junit:1.1.4")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
