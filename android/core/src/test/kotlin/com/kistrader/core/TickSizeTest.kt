package com.kistrader.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** 서버의 `kis/market.py` 와 규칙이 어긋나면 앱이 서버가 거부할 가격을 제안하게 된다. */
class TickSizeTest {

    @Test
    fun `가격대별 호가 단위는 서버 규칙과 같다`() {
        val expected = mapOf(
            500L to 1L, 1_999L to 1L,
            2_000L to 5L, 4_995L to 5L,
            5_000L to 10L, 19_999L to 10L,
            20_000L to 50L, 49_950L to 50L,
            50_000L to 100L, 199_900L to 100L,
            200_000L to 500L, 499_500L to 500L,
            500_000L to 1_000L, 1_000_000L to 1_000L,
        )
        expected.forEach { (price, tick) -> assertEquals("price=$price", tick, TickSize.of(price)) }
    }

    @Test
    fun `매수는 올림 매도는 내림으로 보정한다`() {
        assertEquals(73_200L, TickSize.round(73_123, up = true))
        assertEquals(73_100L, TickSize.round(73_123, up = false))
    }

    @Test
    fun `이미 호가 단위에 맞으면 그대로 둔다`() {
        assertEquals(73_200L, TickSize.round(73_200, up = true))
        assertEquals(73_200L, TickSize.round(73_200, up = false))
    }

    @Test
    fun `증감 버튼은 한 틱씩 움직이고 0 아래로 내려가지 않는다`() {
        assertEquals(73_300L, TickSize.step(73_200, up = true))
        assertEquals(73_100L, TickSize.step(73_200, up = false))
        assertEquals(1L, TickSize.step(1, up = false))
    }
}
