package com.kistrader.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.item
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kistrader.app.UiState
import com.kistrader.core.Format
import com.kistrader.core.OpenOrder
import com.kistrader.core.OrderRequest
import com.kistrader.core.Snapshot
import com.kistrader.core.Summary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    state: UiState,
    onRefresh: () -> Unit,
    onSetHalt: (Boolean) -> Unit,
    onCancel: (OpenOrder) -> Unit,
    onCancelAll: () -> Unit,
    onOrder: (OrderRequest) -> Unit,
    onDisconnect: () -> Unit,
    onMessageShown: () -> Unit,
) {
    val snackbarHost = remember { SnackbarHostState() }
    val snapshot = state.snapshot

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHost.showSnackbar(it)
            onMessageShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("KIS 대시보드", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    }
                },
                actions = {
                    TextButton(onClick = onRefresh) { Text("새로고침") }
                    TextButton(onClick = onDisconnect) { Text("연결 해제") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { StatusRow(state) }

            if (state.error != null) {
                item { ErrorCard(state.error, onRefresh) }
            }

            if (snapshot == null) {
                item { EmptyHint(if (state.loading) "불러오는 중..." else "표시할 데이터가 없습니다.") }
                return@LazyColumn
            }

            if (snapshot.summary.halted) {
                item { HaltedBanner() }
            }

            item { SummaryCard(snapshot.summary) }
            item {
                ControlCard(
                    summary = snapshot.summary,
                    busy = state.busy,
                    allowControl = state.allowControl,
                    hasOpenOrders = snapshot.orders.isNotEmpty(),
                    onSetHalt = onSetHalt,
                    onCancelAll = onCancelAll,
                )
            }
            item { PositionsCard(snapshot) }
            item {
                OrdersCard(
                    snapshot = snapshot,
                    allowControl = state.allowControl,
                    busy = state.busy,
                    onCancel = onCancel,
                )
            }
            item { QuotesCard(snapshot) }

            if (state.allowControl) {
                item { OrderCard(busy = state.busy, onSubmit = onOrder) }
            }

            item { JournalCard(snapshot) }
        }
    }
}

// ─────────────────────────────────────────────────────────────── 상단 상태
@Composable
private fun StatusRow(state: UiState) {
    val summary = state.snapshot?.summary
    val colors = MaterialTheme.colorScheme

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val isPaper = summary?.isPaper ?: state.config?.isPaper ?: true
        StatusChip(
            text = if (isPaper) "모의투자" else "실전투자",
            background = if (isPaper) colors.primary else colors.error,
            foreground = if (isPaper) colors.onPrimary else colors.onError,
        )
        if (summary?.dryRun == true) {
            StatusChip("DRY-RUN")
        }
        if (!state.allowControl) {
            StatusChip("읽기 전용")
        }
        if (summary != null) {
            StatusChip(if (summary.marketOpen) "장중" else "장 마감")
        }
        Text(
            text = if (state.lastUpdated.isBlank()) "" else "갱신 " + Format.timeOnly(state.lastUpdated),
            style = MaterialTheme.typography.labelSmall,
            color = colors.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

@Composable
private fun HaltedBanner() {
    Text(
        text = "⛔ 매매 중단 상태 — 킬 스위치가 켜져 있습니다",
        color = MaterialTheme.colorScheme.onError,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.error, RoundedCornerShape(10.dp))
            .padding(12.dp),
    )
}

@Composable
private fun ErrorCard(message: String, onRetry: () -> Unit) {
    SectionCard(title = "연결 문제") {
        Text(message, color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onRetry) { Text("다시 시도") }
    }
}

// ─────────────────────────────────────────────────────────────── 요약
@Composable
private fun SummaryCard(summary: Summary) {
    val trend = LocalTrendColors.current

    SectionCard(title = null) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatCell(
                label = "순자산",
                value = Format.won(summary.netAsset),
                sub = summary.account,
                modifier = Modifier.weight(1f),
            )
            StatCell(
                label = "당일 손익",
                value = if (summary.hasDailyBaseline) Format.signedWon(summary.dailyPnl) else "-",
                valueColor = trend.of(summary.dailyPnl),
                sub = if (summary.hasDailyBaseline) {
                    Format.percent(summary.dailyPnlRate) + " · 한도 " + Format.won(summary.limits.maxDailyLoss)
                } else {
                    "기준 순자산 미기록"
                },
                modifier = Modifier.weight(1f),
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatCell(
                label = "평가 손익",
                value = Format.signedWon(summary.totalPnl),
                valueColor = trend.of(summary.totalPnl),
                sub = Format.percent(summary.totalPnlRate),
                modifier = Modifier.weight(1f),
            )
            StatCell(
                label = "주문가능현금",
                value = Format.won(summary.availableCash),
                sub = "예수금 " + Format.won(summary.cash),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────── 비상 제어
@Composable
private fun ControlCard(
    summary: Summary,
    busy: Boolean,
    allowControl: Boolean,
    hasOpenOrders: Boolean,
    onSetHalt: (Boolean) -> Unit,
    onCancelAll: () -> Unit,
) {
    var confirmResume by remember { mutableStateOf(false) }
    var confirmHalt by remember { mutableStateOf(false) }
    var confirmCancelAll by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme

    SectionCard(title = "비상 제어") {
        if (summary.halted) {
            Button(
                onClick = { confirmResume = true },
                // 재개는 서버가 제어를 허용할 때만 가능하다.
                enabled = allowControl && !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
            ) {
                Text("✅ 매매 재개", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            if (!allowControl) {
                Text(
                    "읽기 전용 모드에서는 재개할 수 없습니다. PC 에서 --allow-control 로 실행하세요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceVariant,
                )
            }
        } else {
            // 중단은 위험을 줄이는 방향이므로 읽기 전용 서버에서도 항상 허용된다.
            Button(
                onClick = { confirmHalt = true },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.error,
                    contentColor = colors.onError,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
            ) {
                Text("⛔ 매매 즉시 중단", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(
                onClick = { confirmCancelAll = true },
                enabled = allowControl && !busy && hasOpenOrders,
            ) {
                Text("미체결 전량 취소")
            }
        }

        Text(
            "오늘 주문 ${summary.ordersToday}/${summary.limits.maxOrdersPerDay}건 · " +
                "1회 한도 ${Format.won(summary.limits.maxOrderAmount)}",
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant,
        )
    }

    if (confirmHalt) {
        ConfirmDialog(
            title = "매매 중단",
            message = "자동매매를 즉시 중단합니다. 실행 중인 엔진은 다음 주문 시도부터 차단됩니다.",
            confirmLabel = "중단",
            destructive = true,
            onConfirm = { confirmHalt = false; onSetHalt(true) },
            onDismiss = { confirmHalt = false },
        )
    }
    if (confirmResume) {
        ConfirmDialog(
            title = "매매 재개",
            message = "자동매매가 다시 주문을 낼 수 있게 됩니다.",
            confirmLabel = "재개",
            onConfirm = { confirmResume = false; onSetHalt(false) },
            onDismiss = { confirmResume = false },
        )
    }
    if (confirmCancelAll) {
        ConfirmDialog(
            title = "미체결 전량 취소",
            message = "체결되지 않은 주문을 모두 취소합니다.",
            confirmLabel = "전량 취소",
            destructive = true,
            onConfirm = { confirmCancelAll = false; onCancelAll() },
            onDismiss = { confirmCancelAll = false },
        )
    }
}

// ─────────────────────────────────────────────────────────────── 목록들
@Composable
private fun PositionsCard(snapshot: Snapshot) {
    val trend = LocalTrendColors.current
    val summary = snapshot.summary

    SectionCard(
        title = "보유 종목",
        trailing = {
            Text(
                "${summary.positionCount} / ${summary.limits.maxPositions}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    ) {
        if (snapshot.positions.isEmpty()) {
            EmptyHint("보유 종목이 없습니다.")
            return@SectionCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            snapshot.positions.forEach { position ->
                DataRow(
                    primary = position.name.ifBlank { position.symbol },
                    secondary = "${position.symbol} · ${Format.number(position.avgPrice)}",
                    values = listOf(
                        Format.number(position.quantity) to MaterialTheme.colorScheme.onSurface,
                        Format.number(position.currentPrice) to MaterialTheme.colorScheme.onSurface,
                        Format.signed(position.pnl) to trend.of(position.pnl),
                        Format.percent(position.pnlRate) to trend.of(position.pnlRate),
                    ),
                )
            }
        }
    }
}

@Composable
private fun OrdersCard(
    snapshot: Snapshot,
    allowControl: Boolean,
    busy: Boolean,
    onCancel: (OpenOrder) -> Unit,
) {
    var pendingCancel by remember { mutableStateOf<OpenOrder?>(null) }
    val trend = LocalTrendColors.current

    SectionCard(title = "미체결 주문") {
        if (snapshot.orders.isEmpty()) {
            EmptyHint("미체결 주문이 없습니다.")
            return@SectionCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            snapshot.orders.forEach { order ->
                DataRow(
                    primary = order.name.ifBlank { order.symbol },
                    secondary = "${order.symbol} · ${order.side.korean}",
                    values = listOf(
                        "${Format.number(order.remainingQty)}/${Format.number(order.orderQty)}"
                            to MaterialTheme.colorScheme.onSurface,
                        Format.number(order.orderPrice) to trend.of(if (order.side.wire == "buy") 1L else -1L),
                    ),
                    trailing = {
                        if (allowControl) {
                            TextButton(onClick = { pendingCancel = order }, enabled = !busy) {
                                Text("취소")
                            }
                        }
                    },
                )
            }
        }
    }

    pendingCancel?.let { order ->
        ConfirmDialog(
            title = "주문 취소",
            message = "${order.name.ifBlank { order.symbol }} ${order.side.korean} " +
                "${Format.number(order.remainingQty)}주(주문번호 ${order.orderNo})를 취소합니다.",
            confirmLabel = "취소 요청",
            destructive = true,
            onConfirm = { pendingCancel = null; onCancel(order) },
            onDismiss = { pendingCancel = null },
        )
    }
}

@Composable
private fun QuotesCard(snapshot: Snapshot) {
    val trend = LocalTrendColors.current

    SectionCard(title = "관심 종목") {
        if (snapshot.quotes.isEmpty()) {
            EmptyHint("PC 에서 --watch 옵션으로 관심 종목을 지정하세요.")
            return@SectionCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            snapshot.quotes.forEach { quote ->
                if (quote.error != null) {
                    DataRow(
                        primary = quote.symbol,
                        secondary = quote.error!!,
                        values = emptyList(),
                    )
                } else {
                    DataRow(
                        primary = quote.name.ifBlank { quote.symbol },
                        secondary = quote.symbol,
                        values = listOf(
                            Format.number(quote.price) to MaterialTheme.colorScheme.onSurface,
                            Format.signed(quote.change) to trend.of(quote.change),
                            Format.percent(quote.changeRate) to trend.of(quote.changeRate),
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun JournalCard(snapshot: Snapshot) {
    val trend = LocalTrendColors.current

    SectionCard(title = "최근 주문 기록") {
        if (snapshot.journal.isEmpty()) {
            EmptyHint("기록된 주문이 없습니다.")
            return@SectionCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            snapshot.journal.forEach { entry ->
                val status = buildString {
                    append(if (entry.success) "성공" else "실패")
                    if (entry.dryRun) append("(dry)")
                }
                DataRow(
                    primary = entry.symbol,
                    secondary = Format.shortTimestamp(entry.timestamp) +
                        if (entry.strategy.isBlank()) "" else " · ${entry.strategy}",
                    values = listOf(
                        entry.side.korean to trend.of(if (entry.side.wire == "buy") 1L else -1L),
                        Format.number(entry.quantity) to MaterialTheme.colorScheme.onSurface,
                        Format.number(entry.price) to MaterialTheme.colorScheme.onSurface,
                        status to if (entry.success) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.error
                        },
                    ),
                )
            }
        }
    }
}
