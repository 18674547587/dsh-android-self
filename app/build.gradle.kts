plugins { id("com.android.application") }

android {
    namespace = "dev.self.dsh"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.self.dsh"
        minSdk = 26
        // 关键：targetSdk 28 —— Android 10 起 targetSdk>=29 会禁止从可写数据目录 exec，
        // 而 proot + node 必须能 exec，故锁 28。
        targetSdk = 28
        versionCode = 1
        versionName = "0.1.0"
    }

    // assets 里是已压缩的 rootfs.tar.gz，禁止二次压缩（省构建内存与时间）
    androidResources { noCompress += listOf("gz") }

    // release 不跑 lint（arm64 runner 上也不需要额外 SDK 组件，且省时间）
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        jniLibs { useLegacyPackaging = true }
    }
}
