package com.kistrader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNotNull
import org.junit.Before
import org.junit.Test

/**
 * 실제 대시보드 서버에 붙어 계약을 확인하는 통합 테스트.
 *
 * 기본적으로는 건너뛴다. 서버를 띄운 뒤 아래처럼 실행하면 동작한다:
 *
 * ```
 * python -m kis web --allow-control --token TESTTOKEN --watch 005930 &
 * KIS_TEST_SERVER=http://127.0.0.1:8000 KIS_TEST_TOKEN=TESTTOKEN ./gradlew :core:test
 * ```
 *
 * 서버 JSON 의 필드 이름이 바뀌면 여기서 잡힌다 — 가짜 응답으로 하는 단위 테스트가
 * 절대 잡아낼 수 없는 종류의 버그다.
 */
class LiveServerTest {

    private var client: KisClient? = null

    @Before
    fun setUp() {
        val baseUrl = System.getenv("KIS_TEST_SERVER")
        assumeNotNull(baseUrl)
        client = KisClient(baseUrl, System.getenv("KIS_TEST_TOKEN").orEmpty())
    }

    @Test
    fun `health 는 토큰 없이도 응답한다`() {
        val config = client!!.health()
        assertEquals("kis-trader", config.service)
        assertTrue("버전이 비어 있다", config.version.isNotBlank())
    }

    @Test
    fun `토큰이 틀리면 401 로 구분된다`() {
        val baseUrl = System.getenv("KIS_TEST_SERVER")
        val wrong = KisClient(baseUrl, "definitely-wrong-token")
        try {
            wrong.snapshot()
            throw AssertionError("인증이 통과되면 안 된다")
        } catch (expected: ApiException.Unauthorized) {
            // 기대한 동작
        }
    }

    @Test
    fun `스냅샷의 모든 구역이 채워진다`() {
        val snapshot = client!!.snapshot()

        // 서버가 실제로 내려주는 필드를 앱이 읽어내는지 확인한다.
        assertTrue("순자산이 0 이면 파싱이 깨진 것", snapshot.summary.netAsset > 0)
        assertTrue(snapshot.summary.serverTime.isNotBlank())
        assertTrue(snapshot.summary.account.isNotBlank())
        assertTrue("한도가 비어 있다", snapshot.summary.limits.maxOrderAmount > 0)

        assertTrue("보유 종목이 있어야 한다", snapshot.positions.isNotEmpty())
        val position = snapshot.positions.first()
        assertTrue(position.symbol.isNotBlank())
        assertTrue(position.name.isNotBlank())
        assertTrue(position.quantity > 0)

        assertTrue("미체결 주문이 있어야 한다", snapshot.orders.isNotEmpty())
        val order = snapshot.orders.first()
        assertTrue("취소하려면 조직번호가 필요하다", order.orgNo.isNotBlank())
        assertTrue(order.orderNo.isNotBlank())

        assertTrue("관심 종목 시세가 있어야 한다", snapshot.quotes.isNotEmpty())
        assertNotNull(snapshot.quotes.first().name)
    }

    @Test
    fun `매매 중단과 재개가 반영된다`() {
        val api = client!!
        try {
            val halted = api.setHalt(true)
            assertTrue("중단이 반영되지 않았다", halted.halted)
            assertTrue(api.snapshot().summary.halted)

            // 중단 상태에서는 주문이 거부되어야 한다.
            try {
                api.placeOrder(OrderRequest("005930", Side.BUY, 1, 70_000))
                throw AssertionError("중단 상태에서 주문이 나가면 안 된다")
            } catch (expected: ApiException.Rejected) {
                assertTrue(expected.reason.contains("킬 스위치") || expected.reason.contains("중단"))
            }
        } finally {
            val resumed = api.setHalt(false)
            assertEquals(false, resumed.halted)
        }
    }

    @Test
    fun `주문 수량은 서버 리스크 한도에 맞춰 줄어든다`() {
        val api = client!!
        val quote = api.snapshot().quotes.firstOrNull { it.error == null && it.price > 0 }
        assumeNotNull(quote)

        val price = TickSize.round(quote!!.price, up = true)
        val limit = api.snapshot().summary.limits.maxOrderAmount
        val requested = (limit / price * 10).toInt().coerceAtLeast(2)  // 한도의 10배를 일부러 요청

        val result = api.placeOrder(OrderRequest(quote.symbol, Side.BUY, requested, price))
        assertTrue("주문이 접수되어야 한다: ${result.message}", result.success)
        assertTrue(
            "수량이 한도에 맞춰 줄어야 한다 (요청 $requested, 접수 ${result.quantity})",
            result.quantity < requested,
        )
        assertTrue("접수 금액이 1회 한도를 넘었다", result.quantity * price <= limit)
    }
}
