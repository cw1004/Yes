package com.kistrader.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 서버 JSON → 모델 변환.
 *
 * 서버가 필드를 하나 빼먹거나 타입이 달라도 앱이 죽지 않도록, 모든 접근을 기본값이 있는
 * 헬퍼로 처리한다. 자동매매 상태를 보는 화면이 파싱 오류로 안 뜨는 것이 가장 나쁘다.
 */
internal object Json {

    fun optLong(obj: JSONObject, key: String, default: Long = 0): Long =
        if (obj.isNull(key)) default else runCatching { obj.getDouble(key).toLong() }.getOrDefault(default)

    fun optInt(obj: JSONObject, key: String, default: Int = 0): Int =
        if (obj.isNull(key)) default else runCatching { obj.getDouble(key).toInt() }.getOrDefault(default)

    fun optDouble(obj: JSONObject, key: String, default: Double = 0.0): Double =
        if (obj.isNull(key)) default else runCatching { obj.getDouble(key) }.getOrDefault(default)

    fun optString(obj: JSONObject, key: String, default: String = ""): String =
        if (obj.isNull(key)) default else obj.optString(key, default)

    fun optBool(obj: JSONObject, key: String, default: Boolean = false): Boolean =
        if (obj.isNull(key)) default else obj.optBoolean(key, default)

    private inline fun <T> mapArray(array: JSONArray?, transform: (JSONObject) -> T): List<T> {
        if (array == null) return emptyList()
        val out = ArrayList<T>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            runCatching { transform(item) }.onSuccess(out::add)
        }
        return out
    }

    fun serverConfig(obj: JSONObject) = ServerConfig(
        service = optString(obj, "service", "kis-trader"),
        version = optString(obj, "version"),
        allowControl = optBool(obj, "allow_control"),
        refreshSeconds = optInt(obj, "refresh_seconds", 10).coerceIn(3, 300),
        env = optString(obj, "env", "paper"),
        isPaper = optBool(obj, "is_paper", true),
        dryRun = optBool(obj, "dry_run", true),
    )

    fun limits(obj: JSONObject?) = Limits(
        maxOrderAmount = obj?.let { optLong(it, "max_order_amount") } ?: 0,
        maxPositionAmount = obj?.let { optLong(it, "max_position_amount") } ?: 0,
        maxOrdersPerDay = obj?.let { optInt(it, "max_orders_per_day") } ?: 0,
        maxDailyLoss = obj?.let { optLong(it, "max_daily_loss") } ?: 0,
        maxPositions = obj?.let { optInt(it, "max_positions") } ?: 0,
    )

    fun summary(obj: JSONObject): Summary {
        val fills = obj.optJSONObject("fills_today")
        return Summary(
            env = optString(obj, "env", "paper"),
            isPaper = optBool(obj, "is_paper", true),
            dryRun = optBool(obj, "dry_run", true),
            account = optString(obj, "account"),
            marketOpen = optBool(obj, "market_open"),
            serverTime = optString(obj, "server_time"),
            halted = optBool(obj, "halted"),
            killSwitch = optBool(obj, "kill_switch"),
            cash = optLong(obj, "cash"),
            availableCash = optLong(obj, "available_cash"),
            totalEval = optLong(obj, "total_eval"),
            totalPurchase = optLong(obj, "total_purchase"),
            totalPnl = optLong(obj, "total_pnl"),
            totalPnlRate = optDouble(obj, "total_pnl_rate"),
            netAsset = optLong(obj, "net_asset"),
            openingEquity = optLong(obj, "opening_equity"),
            dailyPnl = optLong(obj, "daily_pnl"),
            dailyPnlRate = optDouble(obj, "daily_pnl_rate"),
            positionCount = optInt(obj, "position_count"),
            ordersToday = optInt(obj, "orders_today"),
            fillsBuy = fills?.let { optLong(it, "buy") } ?: 0,
            fillsSell = fills?.let { optLong(it, "sell") } ?: 0,
            limits = limits(obj.optJSONObject("limits")),
        )
    }

    fun position(obj: JSONObject) = Position(
        symbol = optString(obj, "symbol"),
        name = optString(obj, "name"),
        quantity = optInt(obj, "quantity"),
        sellable = optInt(obj, "sellable"),
        avgPrice = optDouble(obj, "avg_price"),
        currentPrice = optLong(obj, "current_price"),
        evalAmount = optLong(obj, "eval_amount"),
        purchaseAmount = optLong(obj, "purchase_amount"),
        pnl = optLong(obj, "pnl"),
        pnlRate = optDouble(obj, "pnl_rate"),
    )

    fun openOrder(obj: JSONObject) = OpenOrder(
        orderNo = optString(obj, "order_no"),
        orgNo = optString(obj, "org_no"),
        symbol = optString(obj, "symbol"),
        name = optString(obj, "name"),
        side = Side.fromWire(optString(obj, "side")),
        orderQty = optInt(obj, "order_qty"),
        filledQty = optInt(obj, "filled_qty"),
        remainingQty = optInt(obj, "remaining_qty"),
        orderPrice = optLong(obj, "order_price"),
        orderTime = optString(obj, "order_time"),
        status = optString(obj, "status"),
    )

    fun quote(obj: JSONObject) = QuoteRow(
        symbol = optString(obj, "symbol"),
        name = optString(obj, "name"),
        price = optLong(obj, "price"),
        change = optLong(obj, "change"),
        changeRate = optDouble(obj, "change_rate"),
        volume = optLong(obj, "volume"),
        high = optLong(obj, "high"),
        low = optLong(obj, "low"),
        halted = optBool(obj, "halted"),
        error = if (obj.isNull("error")) null else optString(obj, "error").ifBlank { null },
    )

    fun journalEntry(obj: JSONObject) = JournalEntry(
        timestamp = optString(obj, "ts"),
        symbol = optString(obj, "symbol"),
        side = Side.fromWire(optString(obj, "side")),
        quantity = optInt(obj, "quantity"),
        price = optLong(obj, "price"),
        strategy = optString(obj, "strategy"),
        reason = optString(obj, "reason"),
        // 서버가 SQLite 정수(0/1)로 내려준다.
        success = optInt(obj, "success") != 0,
        dryRun = optInt(obj, "dry_run") != 0,
    )

    fun snapshot(obj: JSONObject) = Snapshot(
        summary = summary(obj.optJSONObject("summary") ?: JSONObject()),
        positions = mapArray(obj.optJSONArray("positions"), ::position),
        orders = mapArray(obj.optJSONArray("orders"), ::openOrder),
        journal = mapArray(obj.optJSONArray("journal"), ::journalEntry),
        quotes = mapArray(obj.optJSONArray("quotes"), ::quote),
    )

    fun haltState(obj: JSONObject) = HaltState(
        halted = optBool(obj, "halted"),
        killSwitch = optBool(obj, "kill_switch"),
    )

    fun actionResult(obj: JSONObject) = ActionResult(
        success = optBool(obj, "success"),
        message = optString(obj, "message").ifBlank { optString(obj, "error") },
        orderNo = optString(obj, "order_no"),
        quantity = optInt(obj, "quantity"),
        price = optLong(obj, "price"),
        dryRun = optBool(obj, "dry_run"),
    )

    /** 전량 취소는 건수만 돌려준다. */
    fun cancelAllResult(obj: JSONObject) = ActionResult(
        success = optBool(obj, "success", true),
        message = "${optInt(obj, "count")}건 취소 요청을 보냈습니다",
        quantity = optInt(obj, "count"),
    )
}
