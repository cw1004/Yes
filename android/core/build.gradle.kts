import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

/*
 * 안드로이드에 의존하지 않는 순수 Kotlin 모듈.
 *
 * 모델 · JSON 파싱 · HTTP 클라이언트 · 표시 포맷이 여기에 있다. 덕분에 PC 에서
 * `./gradlew :core:test` 만으로 통신 계층까지 검증할 수 있고, 안드로이드 모듈은
 * 화면 그리는 일만 맡는다.
 *
 * org.json 은 안드로이드 플랫폼에 기본 포함되어 있으므로 compileOnly 로 둔다.
 * (JVM 테스트에서만 실제 구현이 필요하다)
 */
dependencies {
    compileOnly(libs.json)
    testImplementation(libs.json)
    testImplementation(libs.junit)
}

/*
 * 툴체인을 고정하지 않고 바이트코드 타깃만 지정한다. jvmToolchain(17) 을 쓰면
 * JDK 17 이 설치돼 있지 않은 PC 에서 빌드가 통째로 실패한다 — Android Studio 가
 * 번들한 JBR(17 또는 21)로 그대로 빌드되게 두는 편이 안전하다.
 */
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test {
    testLogging {
        events("passed", "failed", "skipped")
    }
}
