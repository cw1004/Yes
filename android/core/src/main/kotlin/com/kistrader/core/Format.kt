package com.kistrader.core

import java.text.NumberFormat
import java.util.Locale

/**
 * 화면 표시용 포맷.
 *
 * 국내 관례를 따른다 — 상승은 빨강 `+`, 하락은 파랑 `-`. 색은 UI 가 [Trend] 를 보고 정한다.
 */
object Format {
    private val korean = NumberFormat.getIntegerInstance(Locale.KOREA)

    fun number(value: Long): String = korean.format(value)
    fun number(value: Int): String = korean.format(value.toLong())
    fun number(value: Double): String = korean.format(Math.round(value))

    /** 12,345원 */
    fun won(value: Long): String = number(value) + "원"

    /** +12,345 / -12,345 (0 이면 부호 없음) */
    fun signed(value: Long): String = if (value > 0) "+${number(value)}" else number(value)

    fun signedWon(value: Long): String = signed(value) + "원"

    /** +1.25% */
    fun percent(value: Double, decimals: Int = 2): String {
        val text = String.format(Locale.KOREA, "%.${decimals}f", value)
        return if (value > 0) "+$text%" else "$text%"
    }

    /** 1,234만원 처럼 큰 금액을 짧게. 위젯이나 좁은 칸에서 쓴다. */
    fun compactWon(value: Long): String {
        val abs = kotlin.math.abs(value)
        return when {
            abs >= 100_000_000 -> String.format(Locale.KOREA, "%.1f억원", value / 100_000_000.0)
            abs >= 10_000 -> "${number(value / 10_000)}만원"
            else -> won(value)
        }
    }

    /** "2026-08-24 14:03:11" 에서 "14:03:11" 만. 형식이 다르면 원본 그대로. */
    fun timeOnly(serverTime: String): String =
        if (serverTime.length >= 19) serverTime.substring(11, 19) else serverTime

    /** 저널의 ISO 시각을 "08-24 14:03" 로. */
    fun shortTimestamp(timestamp: String): String =
        if (timestamp.length >= 16) timestamp.substring(5, 16).replace('T', ' ') else timestamp
}

/** 값의 방향. UI 가 색을 고를 때 쓴다. */
enum class Trend { UP, DOWN, FLAT;
    companion object {
        fun of(value: Long): Trend = when {
            value > 0 -> UP
            value < 0 -> DOWN
            else -> FLAT
        }

        fun of(value: Double): Trend = when {
            value > 0 -> UP
            value < 0 -> DOWN
            else -> FLAT
        }
    }
}

/**
 * 호가 단위 — 서버의 `kis/market.py` 와 같은 규칙(2023년 개편 기준).
 * 주문 화면에서 가격을 올리고 내리는 버튼에 쓴다.
 */
object TickSize {
    fun of(price: Long): Long = when {
        price < 2_000 -> 1
        price < 5_000 -> 5
        price < 20_000 -> 10
        price < 50_000 -> 50
        price < 200_000 -> 100
        price < 500_000 -> 500
        else -> 1_000
    }

    /** 매수는 위로, 매도는 아래로 붙여 체결 가능성을 높인다(서버와 같은 규칙). */
    fun round(price: Long, up: Boolean): Long {
        if (price <= 0) return 0
        val tick = of(price)
        if (price % tick == 0L) return price
        return if (up) (price / tick + 1) * tick else (price / tick) * tick
    }

    fun step(price: Long, up: Boolean): Long {
        val tick = of(price)
        return (price + if (up) tick else -tick).coerceAtLeast(tick)
    }
}
