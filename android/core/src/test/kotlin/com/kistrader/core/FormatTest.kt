package com.kistrader.core

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {

    @Test
    fun `금액은 세 자리마다 끊고 원을 붙인다`() {
        assertEquals("12,345,678원", Format.won(12_345_678))
        assertEquals("0원", Format.won(0))
        assertEquals("-1,000원", Format.won(-1_000))
    }

    @Test
    fun `손익은 부호를 붙이고 0 은 부호가 없다`() {
        assertEquals("+130,000원", Format.signedWon(130_000))
        assertEquals("-22,000원", Format.signedWon(-22_000))
        assertEquals("0원", Format.signedWon(0))
    }

    @Test
    fun `등락률은 소수점 두 자리에 부호를 붙인다`() {
        assertEquals("+1.05%", Format.percent(1.05))
        assertEquals("-3.03%", Format.percent(-3.03))
        assertEquals("0.00%", Format.percent(0.0))
    }

    @Test
    fun `큰 금액은 억 만 단위로 줄인다`() {
        assertEquals("1.2억원", Format.compactWon(124_800_000))
        assertEquals("1,248만원", Format.compactWon(12_480_000))
        assertEquals("8,500원", Format.compactWon(8_500))
    }

    @Test
    fun `서버 시각에서 시분초만 뽑는다`() {
        assertEquals("14:03:11", Format.timeOnly("2026-08-24 14:03:11"))
        assertEquals("짧은값", Format.timeOnly("짧은값"))
    }

    @Test
    fun `저널 시각은 월일 시분으로 줄인다`() {
        assertEquals("08-24 14:03", Format.shortTimestamp("2026-08-24T14:03:11"))
    }

    @Test
    fun `방향은 부호로 결정된다`() {
        assertEquals(Trend.UP, Trend.of(1L))
        assertEquals(Trend.DOWN, Trend.of(-1L))
        assertEquals(Trend.FLAT, Trend.of(0L))
        assertEquals(Trend.UP, Trend.of(0.01))
    }
}
