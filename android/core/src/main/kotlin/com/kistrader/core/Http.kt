package com.kistrader.core

import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

/** 한 번의 HTTP 왕복 결과. */
data class HttpResponse(val status: Int, val body: String)

/** 실제 네트워크를 대체할 수 있게 분리한 전송 계층(테스트용 가짜를 끼우기 위함). */
interface HttpTransport {
    /** @param body null 이면 GET, 아니면 POST(JSON). */
    fun send(url: String, method: String, headers: Map<String, String>, body: String?): HttpResponse
}

/**
 * `HttpURLConnection` 기반 기본 구현.
 *
 * 안드로이드와 순수 JVM 양쪽에서 그대로 돌아가므로, 이 파일까지 포함한 통신 계층 전체를
 * PC 에서 실제 서버에 붙여 검증할 수 있다.
 */
class UrlConnectionTransport(
    private val connectTimeoutMs: Int = 4_000,
    private val readTimeoutMs: Int = 8_000,
) : HttpTransport {

    override fun send(url: String, method: String, headers: Map<String, String>, body: String?): HttpResponse {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            instanceFollowRedirects = false
            headers.forEach { (key, value) -> setRequestProperty(key, value) }
        }
        try {
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            // 4xx/5xx 는 errorStream 으로 온다. 서버가 사유를 JSON 으로 주므로 반드시 읽는다.
            val stream = if (status in 200..399) connection.inputStream else connection.errorStream
            val text = stream?.let { input ->
                input.bufferedReader(Charsets.UTF_8).use(BufferedReader::readText)
            }.orEmpty()
            return HttpResponse(status, text)
        } finally {
            connection.disconnect()
        }
    }
}

/** API 호출 실패 원인. 화면에서 사용자에게 다른 안내를 해야 하므로 유형을 나눈다. */
sealed class ApiException(message: String) : Exception(message) {

    /** 서버에 닿지 못했다 — 주소가 틀렸거나, PC 가 꺼졌거나, 다른 와이파이에 있다. */
    class Unreachable(val detail: String) : ApiException("서버에 연결할 수 없습니다 ($detail)")

    /** 응답이 너무 느리다. */
    class Timeout : ApiException("서버 응답이 없습니다. 같은 와이파이에 있는지 확인하세요")

    /** 토큰이 틀렸거나 서버가 재시작되며 토큰이 바뀌었다. */
    class Unauthorized : ApiException("토큰이 올바르지 않습니다")

    /** 서버가 읽기 전용 모드다 — `--allow-control` 없이 실행 중. */
    class Forbidden(val reason: String) : ApiException(reason)

    /** 요청이 거부됐다(리스크 한도, 잘못된 입력 등). 서버가 준 사유를 그대로 보여준다. */
    class Rejected(val reason: String) : ApiException(reason)

    /** 서버 내부 오류. */
    class ServerError(val status: Int, val detail: String) : ApiException("서버 오류 ($status) $detail")

    /** JSON 이 예상과 다르다 — 서버/앱 버전 불일치일 수 있다. */
    class BadResponse(val detail: String) : ApiException("응답을 해석할 수 없습니다 ($detail)")
}

internal fun wrapTransportError(error: Throwable): ApiException = when (error) {
    is ApiException -> error
    is SocketTimeoutException -> ApiException.Timeout()
    else -> ApiException.Unreachable(error.message ?: error::class.java.simpleName)
}
