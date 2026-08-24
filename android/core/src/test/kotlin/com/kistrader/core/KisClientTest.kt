package com.kistrader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** 서버 응답을 흉내 내는 전송 계층. 요청 내용도 기록해 검증한다. */
class FakeTransport(private val responder: (String, String, String?) -> HttpResponse) : HttpTransport {
    val requests = mutableListOf<Triple<String, String, String?>>()
    var lastHeaders: Map<String, String> = emptyMap()

    override fun send(url: String, method: String, headers: Map<String, String>, body: String?): HttpResponse {
        requests += Triple(url, method, body)
        lastHeaders = headers
        return responder(url, method, body)
    }
}

private fun ok(body: String) = HttpResponse(200, body)

class KisClientTest {

    // 실제 서버가 내려주는 형태 그대로
    private val snapshotJson = """
    {
      "summary": {
        "env": "paper", "is_paper": true, "dry_run": false, "account": "1234****-01",
        "market_open": true, "server_time": "2026-08-24 14:03:11",
        "halted": false, "kill_switch": false,
        "cash": 10064500, "available_cash": 9980000, "total_eval": 2415500,
        "total_purchase": 2388000, "total_pnl": 27500, "total_pnl_rate": 1.15,
        "net_asset": 12480000, "opening_equity": 12350000,
        "daily_pnl": 130000, "daily_pnl_rate": 1.05,
        "position_count": 3, "orders_today": 4,
        "fills_today": {"buy": 730000, "sell": 618000},
        "limits": {"max_order_amount": 1000000, "max_position_amount": 3000000,
                   "max_orders_per_day": 50, "max_daily_loss": 300000, "max_positions": 5}
      },
      "positions": [
        {"symbol": "005930", "name": "삼성전자", "quantity": 15, "sellable": 15,
         "avg_price": 71200.0, "current_price": 73400, "eval_amount": 1101000,
         "purchase_amount": 1068000, "pnl": 33000, "pnl_rate": 3.09}
      ],
      "orders": [
        {"order_no": "0000117057", "org_no": "91252", "symbol": "005930", "name": "삼성전자",
         "side": "buy", "side_ko": "매수", "order_qty": 10, "filled_qty": 3,
         "remaining_qty": 7, "order_price": 73000, "order_time": "095210", "status": "접수"}
      ],
      "journal": [
        {"ts": "2026-08-24T09:52:10", "symbol": "005930", "side": "buy", "quantity": 10,
         "price": 73000, "strategy": "sma_cross", "reason": "골든크로스",
         "success": 1, "dry_run": 0}
      ],
      "quotes": [
        {"symbol": "005930", "name": "삼성전자", "price": 73400, "change": 800,
         "change_rate": 1.10, "volume": 11482310, "high": 73900, "low": 72100, "halted": false}
      ]
    }
    """.trimIndent()

    private fun client(responder: (String, String, String?) -> HttpResponse) =
        KisClient("http://192.168.0.5:8000", "TOKEN", FakeTransport(responder))

    // ------------------------------------------------------------------ 파싱
    @Test
    fun `스냅샷을 모델로 옮긴다`() {
        val snapshot = client { _, _, _ -> ok(snapshotJson) }.snapshot()

        assertEquals(12_480_000L, snapshot.summary.netAsset)
        assertEquals(130_000L, snapshot.summary.dailyPnl)
        assertEquals(5, snapshot.summary.limits.maxPositions)
        assertEquals(730_000L, snapshot.summary.fillsBuy)

        assertEquals(1, snapshot.positions.size)
        assertEquals("삼성전자", snapshot.positions[0].name)
        assertEquals(3.09, snapshot.positions[0].pnlRate, 0.001)

        assertEquals(Side.BUY, snapshot.orders[0].side)
        assertEquals(7, snapshot.orders[0].remainingQty)
        assertEquals("91252", snapshot.orders[0].orgNo)

        // 저널의 success/dry_run 은 SQLite 정수(0/1)로 온다
        assertTrue(snapshot.journal[0].success)
        assertEquals(false, snapshot.journal[0].dryRun)

        assertEquals(1.10, snapshot.quotes[0].changeRate, 0.001)
        assertNull(snapshot.quotes[0].error)
    }

    @Test
    fun `필드가 빠져도 기본값으로 살아남는다`() {
        val snapshot = client { _, _, _ -> ok("""{"summary": {}}""") }.snapshot()
        assertEquals(0L, snapshot.summary.netAsset)
        assertTrue(snapshot.positions.isEmpty())
        assertEquals(0, snapshot.summary.limits.maxPositions)
    }

    @Test
    fun `배열 안에 깨진 항목이 있어도 나머지는 살린다`() {
        val json = """{"summary":{},"quotes":[{"symbol":"005930","price":100}, 42, {"symbol":"000660","price":200}]}"""
        val snapshot = client { _, _, _ -> ok(json) }.snapshot()
        assertEquals(listOf("005930", "000660"), snapshot.quotes.map { it.symbol })
    }

    @Test
    fun `시세 조회 실패는 error 로 전달된다`() {
        val json = """{"summary":{},"quotes":[{"symbol":"005930","error":"모의투자 미지원"}]}"""
        val snapshot = client { _, _, _ -> ok(json) }.snapshot()
        assertEquals("모의투자 미지원", snapshot.quotes[0].error)
    }

    @Test
    fun `기준 순자산이 없으면 당일 손익 표시를 숨길 수 있다`() {
        val json = """{"summary":{"opening_equity":0,"daily_pnl":0}}"""
        assertEquals(false, client { _, _, _ -> ok(json) }.snapshot().summary.hasDailyBaseline)
    }

    @Test
    fun `일일 손실 한도까지 남은 여유를 계산한다`() {
        fun summary(dailyPnl: Long) = Json.summary(
            org.json.JSONObject("""{"daily_pnl":$dailyPnl,"limits":{"max_daily_loss":300000}}""")
        )
        assertEquals(300_000L, summary(50_000).remainingLossRoom)
        assertEquals(200_000L, summary(-100_000).remainingLossRoom)
        assertEquals(0L, summary(-400_000).remainingLossRoom)
    }

    // ------------------------------------------------------------------ 인증
    @Test
    fun `요청에 토큰 헤더를 싣는다`() {
        val transport = FakeTransport { _, _, _ -> ok(snapshotJson) }
        KisClient("http://192.168.0.5:8000", "SECRET", transport).snapshot()
        assertEquals("SECRET", transport.lastHeaders["X-Auth-Token"])
        assertEquals("http://192.168.0.5:8000/api/snapshot", transport.requests[0].first)
    }

    @Test
    fun `health 는 토큰을 보내지 않는다`() {
        val transport = FakeTransport { _, _, _ -> ok("""{"service":"kis-trader","version":"0.1.0"}""") }
        val config = KisClient("http://192.168.0.5:8000", "SECRET", transport).health()
        assertEquals("kis-trader", config.service)
        assertNull(transport.lastHeaders["X-Auth-Token"])
    }

    // ------------------------------------------------------------------ 오류
    @Test
    fun `401 은 토큰 오류로 구분된다`() {
        try {
            client { _, _, _ -> HttpResponse(401, """{"error":"인증이 필요합니다"}""") }.snapshot()
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.Unauthorized) {
            assertTrue(error.message!!.contains("토큰"))
        }
    }

    @Test
    fun `403 은 서버가 준 사유를 그대로 보여준다`() {
        try {
            client { _, _, _ ->
                HttpResponse(403, """{"error":"읽기 전용 모드입니다. 제어하려면 --allow-control 로 다시 실행하세요."}""")
            }.cancelAll()
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.Forbidden) {
            assertTrue(error.reason.contains("--allow-control"))
        }
    }

    @Test
    fun `400 은 거부 사유로 전달된다`() {
        try {
            client { _, _, _ -> HttpResponse(400, """{"message":"리스크 한도: 주문가능현금 부족"}""") }
                .placeOrder(OrderRequest("005930", Side.BUY, 1, 70000))
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.Rejected) {
            assertTrue(error.reason.contains("주문가능현금"))
        }
    }

    @Test
    fun `JSON 이 아닌 응답은 BadResponse 로 감싼다`() {
        try {
            client { _, _, _ -> ok("<html>not json</html>") }.snapshot()
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.BadResponse) {
            assertTrue(error.message!!.contains("해석할 수 없습니다"))
        }
    }

    @Test
    fun `네트워크 오류는 Unreachable 로 감싼다`() {
        try {
            client { _, _, _ -> throw java.net.ConnectException("Connection refused") }.snapshot()
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.Unreachable) {
            assertTrue(error.detail.contains("refused"))
        }
    }

    @Test
    fun `타임아웃은 별도 유형으로 구분된다`() {
        try {
            client { _, _, _ -> throw java.net.SocketTimeoutException("timeout") }.snapshot()
            fail("예외가 발생해야 한다")
        } catch (error: ApiException.Timeout) {
            assertTrue(error.message!!.contains("와이파이"))
        }
    }

    // ------------------------------------------------------------------ 제어
    @Test
    fun `매매 중단 요청은 on 필드를 보낸다`() {
        val transport = FakeTransport { _, _, _ -> ok("""{"halted":true,"kill_switch":true}""") }
        val state = KisClient("http://h:8000", "T", transport).setHalt(true)
        assertTrue(state.halted)
        assertEquals("POST", transport.requests[0].second)
        assertTrue(transport.requests[0].third!!.contains("\"on\":true"))
    }

    @Test
    fun `주문은 서버가 줄인 수량을 돌려준다`() {
        val transport = FakeTransport { _, _, _ ->
            ok("""{"success":true,"order_no":"0000117099","quantity":13,"price":73200,"message":"정상"}""")
        }
        val result = KisClient("http://h:8000", "T", transport)
            .placeOrder(OrderRequest("005930", Side.BUY, 100, 73_200))

        assertTrue(result.success)
        assertEquals(13, result.quantity)  // 앱이 보낸 100주가 아니다
        assertEquals(73_200L, result.price)

        val body = transport.requests[0].third!!
        assertTrue(body.contains("\"side\":\"buy\""))
        assertTrue(body.contains("\"symbol\":\"005930\""))
    }

    @Test
    fun `취소는 주문번호와 조직번호를 함께 보낸다`() {
        val transport = FakeTransport { _, _, _ -> ok("""{"success":true,"message":"취소 완료"}""") }
        val order = Json.openOrder(org.json.JSONObject("""{"order_no":"111","org_no":"222"}"""))
        KisClient("http://h:8000", "T", transport).cancel(order)

        val body = transport.requests[0].third!!
        assertTrue(body.contains("\"order_no\":\"111\""))
        assertTrue(body.contains("\"org_no\":\"222\""))
    }

    @Test
    fun `전량 취소는 건수를 메시지로 만든다`() {
        val result = client { _, _, _ -> ok("""{"count":3,"success":true}""") }.cancelAll()
        assertTrue(result.message.contains("3건"))
    }

    // ------------------------------------------------------------------ 입력 검증
    @Test
    fun `잘못된 주문은 서버에 보내기 전에 막는다`() {
        val transport = FakeTransport { _, _, _ -> ok("{}") }
        val api = KisClient("http://h:8000", "T", transport)

        val invalid = listOf(
            OrderRequest("", Side.BUY, 1, 100) to "종목코드",
            OrderRequest("12345", Side.BUY, 1, 100) to "6자리",
            OrderRequest("005930", Side.BUY, 0, 100) to "수량",
            OrderRequest("005930", Side.BUY, 1, 0) to "가격",
        )
        invalid.forEach { (request, hint) ->
            try {
                api.placeOrder(request)
                fail("$request 는 거부되어야 한다")
            } catch (error: ApiException.Rejected) {
                assertTrue("'$hint' 안내가 있어야 한다: ${error.reason}", error.reason.contains(hint))
            }
        }
        assertTrue("서버로 요청이 나가면 안 된다", transport.requests.isEmpty())
    }

    @Test
    fun `시장가 주문은 가격 없이도 통과한다`() {
        assertNull(OrderRequest("005930", Side.BUY, 1, market = true).validate())
    }

    // ------------------------------------------------------------------ 주소 정규화
    @Test
    fun `주소는 스킴과 기본 포트를 채워 넣는다`() {
        assertEquals("http://192.168.0.5:8000", KisClient.normalizeBaseUrl("192.168.0.5"))
        assertEquals("http://192.168.0.5:9000", KisClient.normalizeBaseUrl("192.168.0.5:9000"))
        assertEquals("http://192.168.0.5:8000", KisClient.normalizeBaseUrl("http://192.168.0.5/"))
        assertEquals("https://home.example:8000", KisClient.normalizeBaseUrl("https://home.example"))
        assertEquals("", KisClient.normalizeBaseUrl("   "))
    }

    @Test
    fun `클라이언트는 주소 끝 슬래시를 정리한다`() {
        assertEquals("http://h:8000", KisClient("http://h:8000/", "T").baseUrl)
    }
}
