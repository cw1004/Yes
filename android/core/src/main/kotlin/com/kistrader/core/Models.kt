package com.kistrader.core

/**
 * 서버(`kis web`)가 돌려주는 JSON 을 그대로 옮긴 모델.
 *
 * 필드 이름과 단위는 파이썬 쪽 `kis/web/service.py` 와 1:1 로 대응한다.
 * 금액은 모두 원(KRW) 단위 정수, 비율은 퍼센트 실수다.
 */

/** 서버 기본 정보. 앱 설정 화면에서 주소·토큰을 확인할 때 쓴다. */
data class ServerConfig(
    val service: String,
    val version: String,
    val allowControl: Boolean,
    val refreshSeconds: Int,
    val env: String,
    val isPaper: Boolean,
    val dryRun: Boolean,
) {
    /** 실전 계좌에 붙어 있고 주문까지 가능한 상태 — 화면에서 강하게 경고해야 한다. */
    val isLiveAndControllable: Boolean get() = !isPaper && !dryRun && allowControl
}

data class Limits(
    val maxOrderAmount: Long,
    val maxPositionAmount: Long,
    val maxOrdersPerDay: Int,
    val maxDailyLoss: Long,
    val maxPositions: Int,
)

data class Summary(
    val env: String,
    val isPaper: Boolean,
    val dryRun: Boolean,
    val account: String,
    val marketOpen: Boolean,
    val serverTime: String,
    val halted: Boolean,
    val killSwitch: Boolean,
    val cash: Long,
    val availableCash: Long,
    val totalEval: Long,
    val totalPurchase: Long,
    val totalPnl: Long,
    val totalPnlRate: Double,
    val netAsset: Long,
    val openingEquity: Long,
    val dailyPnl: Long,
    val dailyPnlRate: Double,
    val positionCount: Int,
    val ordersToday: Int,
    val fillsBuy: Long,
    val fillsSell: Long,
    val limits: Limits,
) {
    /** 기준 순자산이 아직 기록되지 않았으면 당일 손익은 의미가 없다. */
    val hasDailyBaseline: Boolean get() = openingEquity > 0

    /** 일일 손실 한도까지 남은 여유. 이미 넘었으면 0. */
    val remainingLossRoom: Long
        get() = if (dailyPnl >= 0) limits.maxDailyLoss else (limits.maxDailyLoss + dailyPnl).coerceAtLeast(0)
}

data class Position(
    val symbol: String,
    val name: String,
    val quantity: Int,
    val sellable: Int,
    val avgPrice: Double,
    val currentPrice: Long,
    val evalAmount: Long,
    val purchaseAmount: Long,
    val pnl: Long,
    val pnlRate: Double,
)

data class OpenOrder(
    val orderNo: String,
    val orgNo: String,
    val symbol: String,
    val name: String,
    val side: Side,
    val orderQty: Int,
    val filledQty: Int,
    val remainingQty: Int,
    val orderPrice: Long,
    val orderTime: String,
    val status: String,
)

data class QuoteRow(
    val symbol: String,
    val name: String,
    val price: Long,
    val change: Long,
    val changeRate: Double,
    val volume: Long,
    val high: Long,
    val low: Long,
    val halted: Boolean,
    /** 시세를 못 받아온 경우의 사유. 정상이면 null. */
    val error: String? = null,
)

data class JournalEntry(
    val timestamp: String,
    val symbol: String,
    val side: Side,
    val quantity: Int,
    val price: Long,
    val strategy: String,
    val reason: String,
    val success: Boolean,
    val dryRun: Boolean,
)

data class Snapshot(
    val summary: Summary,
    val positions: List<Position>,
    val orders: List<OpenOrder>,
    val journal: List<JournalEntry>,
    val quotes: List<QuoteRow>,
)

enum class Side(val wire: String, val korean: String) {
    BUY("buy", "매수"),
    SELL("sell", "매도");

    companion object {
        fun fromWire(value: String?): Side = if (value?.lowercase() == "sell") SELL else BUY
    }
}

/** 킬 스위치 조작 결과. */
data class HaltState(val halted: Boolean, val killSwitch: Boolean)

/** 주문/취소 요청 결과. */
data class ActionResult(
    val success: Boolean,
    val message: String,
    val orderNo: String = "",
    /** 리스크 한도로 수량이 줄어든 경우 실제 접수된 수량. */
    val quantity: Int = 0,
    val price: Long = 0,
    val dryRun: Boolean = false,
)

/** 수동 주문 요청. */
data class OrderRequest(
    val symbol: String,
    val side: Side,
    val quantity: Int,
    val price: Long = 0,
    val market: Boolean = false,
) {
    /** 서버에 보내기 전 앱에서 먼저 거르는 검증. 문제가 없으면 null. */
    fun validate(): String? = when {
        symbol.isBlank() -> "종목코드를 입력하세요"
        !symbol.matches(Regex("\\d{6}")) -> "종목코드는 숫자 6자리입니다"
        quantity <= 0 -> "수량은 1주 이상이어야 합니다"
        !market && price <= 0 -> "지정가 주문에는 가격이 필요합니다"
        else -> null
    }
}
