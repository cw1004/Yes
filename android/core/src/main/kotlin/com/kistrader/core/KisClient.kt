package com.kistrader.core

import org.json.JSONException
import org.json.JSONObject

/**
 * 대시보드 서버(`python -m kis web`)에 붙는 클라이언트.
 *
 * 모든 메서드는 **블로킹**이다. 안드로이드에서는 반드시 IO 디스패처에서 호출한다.
 * 인증은 `X-Auth-Token` 헤더로만 보낸다 — 쿠키를 쓰지 않으므로 CSRF 가 성립하지 않고,
 * 토큰이 URL 이나 서버 접근 로그에 남지 않는다.
 */
class KisClient(
    baseUrl: String,
    private val token: String,
    private val transport: HttpTransport = UrlConnectionTransport(),
) {
    /** 끝의 슬래시를 없애 `//api/...` 같은 주소가 만들어지지 않게 한다. */
    val baseUrl: String = baseUrl.trim().trimEnd('/')

    // ------------------------------------------------------------------ 조회
    /** 인증 없이 서버가 살아 있는지 확인한다. 설정 화면에서 주소 검증에 쓴다. */
    fun health(): ServerConfig = Json.serverConfig(get("/api/health", authenticated = false))

    /** 토큰까지 맞는지 확인하고 서버 설정을 받아온다. */
    fun config(): ServerConfig = Json.serverConfig(get("/api/config"))

    /** 화면 한 장에 필요한 데이터를 한 번에 받는다. */
    fun snapshot(): Snapshot = Json.snapshot(get("/api/snapshot"))

    fun quotes(symbols: List<String>): List<QuoteRow> {
        val query = symbols.joinToString(",")
        val payload = getRaw("/api/quotes?symbols=$query")
        return runCatching {
            val array = org.json.JSONArray(payload)
            (0 until array.length()).mapNotNull { index ->
                array.optJSONObject(index)?.let(Json::quote)
            }
        }.getOrElse { throw ApiException.BadResponse(it.message ?: "quotes") }
    }

    // ------------------------------------------------------------------ 제어
    /**
     * 매매 중단/재개.
     *
     * 중단(`halt = true`)은 읽기 전용 서버에서도 언제나 허용된다.
     * 재개는 서버가 `--allow-control` 로 떠 있어야 한다.
     */
    fun setHalt(halt: Boolean): HaltState =
        Json.haltState(post("/api/halt", JSONObject().put("on", halt)))

    fun cancel(order: OpenOrder): ActionResult = cancel(orderNo = order.orderNo, orgNo = order.orgNo)

    fun cancel(orderNo: String, orgNo: String): ActionResult = Json.actionResult(
        post("/api/cancel", JSONObject().put("order_no", orderNo).put("org_no", orgNo))
    )

    fun cancelAll(): ActionResult = Json.cancelAllResult(post("/api/cancel-all", JSONObject()))

    /**
     * 수동 주문.
     *
     * 서버가 리스크 한도로 수량을 줄일 수 있으므로, 접수된 수량은 응답의 [ActionResult.quantity]
     * 를 봐야 한다. 앱이 보낸 수량과 다를 수 있다.
     */
    fun placeOrder(request: OrderRequest): ActionResult {
        request.validate()?.let { throw ApiException.Rejected(it) }
        val body = JSONObject()
            .put("symbol", request.symbol)
            .put("side", request.side.wire)
            .put("quantity", request.quantity)
            .put("price", request.price)
            .put("market", request.market)
        return Json.actionResult(post("/api/order", body))
    }

    // ------------------------------------------------------------------ 내부
    private fun headers(authenticated: Boolean): Map<String, String> = buildMap {
        put("Accept", "application/json")
        if (authenticated) put("X-Auth-Token", token)
    }

    private fun get(path: String, authenticated: Boolean = true): JSONObject =
        parseObject(getRaw(path, authenticated))

    private fun getRaw(path: String, authenticated: Boolean = true): String =
        execute(path, "GET", null, authenticated)

    private fun post(path: String, body: JSONObject): JSONObject =
        parseObject(execute(path, "POST", body.toString(), authenticated = true))

    private fun execute(path: String, method: String, body: String?, authenticated: Boolean): String {
        val response = try {
            transport.send(baseUrl + path, method, headers(authenticated), body)
        } catch (error: Throwable) {
            throw wrapTransportError(error)
        }

        if (response.status in 200..299) return response.body

        val reason = extractError(response.body)
        throw when (response.status) {
            401 -> ApiException.Unauthorized()
            403 -> ApiException.Forbidden(reason ?: "이 서버는 읽기 전용 모드입니다")
            400, 404, 409, 422 -> ApiException.Rejected(reason ?: "요청이 거부되었습니다 (${response.status})")
            else -> ApiException.ServerError(response.status, reason.orEmpty())
        }
    }

    /** 오류 응답의 `error` 또는 `message` 를 꺼낸다. JSON 이 아니면 null. */
    private fun extractError(body: String): String? = runCatching {
        val obj = JSONObject(body)
        val text = obj.optString("error").ifBlank { obj.optString("message") }
        text.ifBlank { null }
    }.getOrNull()

    private fun parseObject(body: String): JSONObject = try {
        JSONObject(body)
    } catch (error: JSONException) {
        throw ApiException.BadResponse(error.message ?: "JSON")
    }

    companion object {
        /**
         * 사용자가 입력한 주소를 정규화한다.
         * `192.168.0.5` → `http://192.168.0.5:8000`
         */
        fun normalizeBaseUrl(input: String, defaultPort: Int = 8000): String {
            var text = input.trim().trimEnd('/')
            if (text.isEmpty()) return ""
            if (!text.startsWith("http://") && !text.startsWith("https://")) text = "http://$text"
            val afterScheme = text.substringAfter("://")
            val hostPart = afterScheme.substringBefore('/')
            // IPv6 대괄호 표기가 아니면서 포트가 없으면 기본 포트를 붙인다.
            val hasPort = if (hostPart.startsWith("[")) hostPart.contains("]:") else hostPart.contains(':')
            if (!hasPort) {
                val scheme = text.substringBefore("://")
                val rest = afterScheme.substringAfter('/', "")
                text = "$scheme://$hostPart:$defaultPort" + if (rest.isEmpty()) "" else "/$rest"
            }
            return text
        }
    }
}
